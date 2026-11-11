// A minimal MCP server over HTTP that requires an OAuth sign-in, with its own tiny authorization
// server, for the tests. The "sign-in page" approves at once and redirects back with a code.
import http from 'node:http'

export async function startOAuthServer() {
  const seen = { registered: 0, tokens: 0 }
  const server = http.createServer(async (req, res) => {
    const base = `http://127.0.0.1:${server.address().port}`
    const url = new URL(req.url, base)
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
      res.end(JSON.stringify(body))
    }
    let raw = ''
    for await (const chunk of req) raw += chunk

    if (url.pathname === '/redirect') {
      res.writeHead(302, { Location: url.searchParams.get('to') })
      return res.end()
    }
    if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      return json(200, { resource: `${base}/mcp`, authorization_servers: [base] })
    }
    if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
      return json(200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      })
    }
    if (url.pathname === '/register') {
      seen.registered++
      return json(201, { ...JSON.parse(raw), client_id: `client-${seen.registered}` })
    }
    if (url.pathname === '/authorize') {
      const back = new URL(url.searchParams.get('redirect_uri'))
      back.searchParams.set('code', 'the-code')
      back.searchParams.set('state', url.searchParams.get('state'))
      res.writeHead(302, { Location: String(back) })
      return res.end()
    }
    if (url.pathname === '/token') {
      const form = new URLSearchParams(raw)
      if (form.get('grant_type') === 'authorization_code' && (form.get('code') !== 'the-code' || !form.get('code_verifier'))) {
        return json(400, { error: 'invalid_grant' })
      }
      seen.tokens++
      return json(200, { access_token: `token-${seen.tokens}`, token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh' })
    }
    if (url.pathname === '/mcp') {
      const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
      if (!/^token-\d+$/.test(token)) {
        return json(401, { error: 'unauthorized' }, { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` })
      }
      if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
      const msg = JSON.parse(raw)
      if (msg.id === undefined) {
        res.writeHead(202)
        return res.end()
      }
      const reply = (result) => json(200, { jsonrpc: '2.0', id: msg.id, result })
      if (msg.method === 'initialize') {
        return reply({ protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'vault', version: '1.0.0' } })
      }
      if (msg.method === 'tools/list') {
        return reply({ tools: [{ name: 'whoami', description: 'Which account is signed in', inputSchema: { type: 'object', properties: {} } }] })
      }
      if (msg.method === 'tools/call') return reply({ content: [{ type: 'text', text: `signed in with ${token}` }] })
      return json(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } })
    }
    json(404, { error: 'not found' })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${server.address().port}/mcp`, seen, close: () => new Promise((resolve) => server.close(resolve)) }
}
