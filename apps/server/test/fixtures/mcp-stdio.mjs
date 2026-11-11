// A minimal MCP server over stdio for the tests: one tool that echoes its input.
import readline from 'node:readline'

const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let msg
  try {
    msg = JSON.parse(line)
  } catch {
    return
  }
  if (msg.id === undefined) return // a notification
  const { id, method, params } = msg
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1.0.0' } } })
  } else if (method === 'tools/list') {
    send({
      id,
      result: {
        tools: [
          {
            name: 'say',
            description: 'Repeat the given text',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
          },
        ],
      },
    })
  } else if (method === 'tools/call') {
    send({ id, result: { content: [{ type: 'text', text: `said: ${params.arguments?.text} (cwd ${process.cwd().split('/').slice(-2).join('/')})` }] } })
  } else if (method === 'ping') {
    send({ id, result: {} })
  } else {
    send({ id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
})
