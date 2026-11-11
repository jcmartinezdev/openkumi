// End-to-end tests against a real server process, using the scripted mock provider so no model
// account is needed. The browser test launches a real (headless) Chrome.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { startOAuthServer } from './fixtures/mcp-oauth.mjs'

const PORT = 4400 + Math.floor(Math.random() * 500)
const BASE = `http://127.0.0.1:${PORT}`
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openbot-test-'))
let server
let bot
/** The server's access code, which every request has to carry. */
let token
const auth = () => ({ Authorization: `Bearer ${token}` })

async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...auth() },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${url}: ${json.error}`)
  return json
}

/** Sends a message and resolves with the thread's items once it is idle again. */
async function say(threadId, text, timeoutMs = 30_000) {
  await api('POST', `/api/threads/${threadId}/messages`, { text })
  return settle(threadId, timeoutMs)
}

async function settle(threadId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { thread, items } = await api('GET', `/api/threads/${threadId}`)
    if (thread.status !== 'running') return items.map((i) => i.data)
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('Thread did not settle in time')
}

const lastText = (items) => items.findLast((d) => d.type === 'message' && d.role === 'assistant')?.text
const newThread = async (botId = bot.id) => (await api('POST', `/api/bots/${botId}/threads`)).id
const botPath = (...parts) => path.join(home, 'bots', bot.id, ...parts)

/** Calls one tool through the scripted model and returns what the tool gave back. */
async function tool(name, args, botId = bot.id) {
  const items = await say(await newThread(botId), `!tool ${name} ${JSON.stringify(args)}`)
  return items.findLast((d) => d.type === 'function_call_output').output
}

/** What the model is told (its system prompt) or offered (its tool names) for a bot right now. */
const told = async (what = '!system', botId = bot.id) => lastText(await say(await newThread(botId), what))

async function until(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('Condition was not met in time')
    await new Promise((r) => setTimeout(r, 50))
  }
}

before(async () => {
  server = spawn(process.execPath, ['src/index.ts'], {
    env: {
      ...process.env,
      OPENBOT_HOME: home,
      OPENBOT_PORT: String(PORT),
      OPENBOT_MOCK: '1',
      // Scripted stand-ins for the Claude Code and Codex programs.
      OPENBOT_CLAUDE_BIN: path.resolve('test/fixtures/fake-claude.mjs'),
      OPENBOT_CODEX_BIN: path.resolve('test/fixtures/fake-codex.mjs'),
      OPENBOT_GROK_BIN: path.resolve('test/fixtures/fake-grok.mjs'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('running at') && resolve())
    server.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
  token = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).accessToken
  bot = await api('POST', '/api/bots', { name: 'Tester', provider: 'mock' })
})

after(async () => {
  server.kill('SIGTERM')
  await new Promise((r) => server.on('exit', r))
  fs.rmSync(home, { recursive: true, force: true })
})

test('seeds a default bot', async () => {
  const state = await api('GET', '/api/state')
  assert.ok(state.bots.some((b) => b.name === 'Assistant'))
})

test('every request needs the access code, also from this computer, and there are no pages', async () => {
  const get = (url, headers = {}) => fetch(BASE + url, { headers })
  assert.equal((await get('/api/state')).status, 401, 'being on this computer is not enough')
  assert.equal((await get('/api/state', { Authorization: 'Bearer wrong' })).status, 401)
  assert.equal((await get(`/api/state?token=${token}`)).status, 401, 'the code is only read from the address for the event stream')
  assert.equal((await get('/api/state', { Cookie: `openbot_token=${token}` })).status, 401, 'cookies mean nothing')
  assert.equal((await get('/api/state', auth())).status, 200)

  // Anyone may ask who is here; only the app on this computer is told where the data folder is.
  const hello = await (await get('/api/hello')).json()
  assert.deepEqual([hello.app, hello.authorized, hello.home], ['open-bot', false, home])
  // ...and not a web page whose own name has been pointed at this computer.
  const renamed = await new Promise((resolve, reject) =>
    http.get({ host: '127.0.0.1', port: PORT, path: '/api/hello', headers: { host: `evil.example:${PORT}` } }, (res) => {
      let body = ''
      res.on('data', (d) => (body += d)).on('end', () => resolve(JSON.parse(body)))
    }).on('error', reject),
  )
  assert.deepEqual([renamed.app, 'home' in renamed], ['open-bot', false])
  assert.equal((await (await get('/api/hello', auth())).json()).authorized, true)

  // The app on this computer can check it is talking to the server its access code belongs to,
  // before it sends the code: the server signs a value the app chooses with the code.
  const proven = await (await get('/api/hello?challenge=abc123')).json()
  assert.equal(proven.proof, crypto.createHmac('sha256', token).update('abc123').digest('hex'))

  // An address that cannot be read is refused; it does not bring the server down.
  const odd = (path) =>
    new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: PORT, path }, (res) => (res.resume(), resolve(res.statusCode))).on('error', reject))
  assert.equal(await odd('//'), 400)
  const oddSocket = new WebSocket(`ws://127.0.0.1:${PORT}//`)
  await new Promise((resolve) => (oddSocket.onerror = oddSocket.onclose = resolve))
  assert.equal((await get('/api/state', auth())).status, 200, 'the server is still running')

  // The interface is part of the desktop app. Opening the server in a browser explains that.
  const page = await get('/')
  assert.match(page.headers.get('content-type'), /^text\/plain/)
  assert.match(await page.text(), /no page of its own/)
  assert.equal((await get('/index.html')).status, 404)
  assert.equal((await get('/assets/app.js', auth())).status, 404)

  // Only the desktop app's own pages may read answers; a web page in a browser may not.
  const from = async (origin) => (await get('/api/hello', { Origin: origin })).headers.get('access-control-allow-origin')
  assert.equal(await from('openbot://app'), 'openbot://app')
  assert.equal(await from('https://evil.example'), null)
  const preflight = await fetch(`${BASE}/api/state`, { method: 'OPTIONS', headers: { Origin: 'openbot://app', 'Access-Control-Request-Headers': 'authorization' } })
  assert.equal(preflight.status, 204)
  assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/)

  // The event stream takes the code in its address, because a WebSocket cannot send a header.
  const opens = (url) =>
    new Promise((resolve) => {
      const socket = new WebSocket(url)
      socket.onopen = () => (socket.close(), resolve(true))
      socket.onerror = () => resolve(false)
    })
  assert.equal(await opens(`ws://127.0.0.1:${PORT}/ws`), false)
  assert.equal(await opens(`ws://127.0.0.1:${PORT}/ws?token=wrong`), false)
  assert.equal(await opens(`ws://127.0.0.1:${PORT}/ws?token=${token}`), true)
})

test('chat: streams a reply and titles the thread', async () => {
  const id = await newThread()
  const items = await say(id, 'hello there')
  assert.equal(lastText(items), 'Echo: hello there')
  const { thread } = await api('GET', `/api/threads/${id}`)
  assert.equal(thread.title, 'hello there')
})

test('bots can be created from chat', async () => {
  const id = await newThread()
  const items = await say(id, '!tool create_bot {"name":"Researcher","instructions":"Dig deep.","emoji":"🔎"}')
  assert.match(lastText(items), /Created bot/)
  const { bots } = await api('GET', '/api/state')
  const made = bots.find((b) => b.name === 'Researcher')
  assert.equal(made.emoji, '🔎')
  assert.equal(made.provider, 'mock', 'inherits the creating bot\'s provider')
  assert.equal(made.id, 'researcher', 'the folder is named after the bot')
  assert.match(fs.readFileSync(path.join(home, 'bots', 'researcher', 'workspace', 'AGENTS.md'), 'utf8'), /Dig deep\./, 'the instructions start its own file')
})

test('a bot is a folder: bot.md holds the owner\'s settings and rules', async () => {
  await api('PATCH', `/api/bots/${bot.id}`, { rules: 'Never email anyone without asking first.', emoji: '🧪' })
  const file = fs.readFileSync(botPath('bot.md'), 'utf8')
  assert.match(file, /^---\nname: Tester\n/)
  assert.match(file, /Never email anyone without asking first\./)
  const prompt = await told()
  assert.match(prompt, /# Rules from your owner[\s\S]*Never email anyone without asking first\./)
  assert.match(prompt, /# Your instructions \(AGENTS\.md\)\n# Tester/)

  // The file is the truth: an edit made by hand shows up without going through the app.
  fs.writeFileSync(botPath('bot.md'), file.replace('name: Tester', 'name: "Tester: two"'))
  const { bots } = await api('GET', '/api/state')
  assert.equal(bots.find((b) => b.id === bot.id).name, 'Tester: two')
  await api('PATCH', `/api/bots/${bot.id}`, { name: 'Tester' })
})

test('file tools stay inside the workspace', async () => {
  assert.equal(await tool('write_file', { path: 'memory/people.md', content: '# People\nAda likes tea.\n' }), 'Saved memory/people.md.')
  assert.equal(fs.readFileSync(botPath('workspace', 'memory', 'people.md'), 'utf8'), '# People\nAda likes tea.\n')
  assert.equal(await tool('read_file', { path: '/memory/people.md' }), '# People\nAda likes tea.\n', 'a leading slash still means the workspace')
  assert.match(await tool('list_files', {}), /AGENTS\.md[\s\S]*memory\//)
  assert.match(await tool('search_files', { query: 'TEA' }), /memory\/people\.md:2: Ada likes tea\./)
  assert.match(await told(), /# Your notes \(memory\/\)\n- memory\/people\.md: People/, 'notes are listed in the prompt')

  // Nothing outside the workspace can be read or written: not the owner's files, not git's.
  fs.writeFileSync(path.join(home, 'secret.txt'), 'top secret')
  fs.symlinkSync(path.join(home, 'secret.txt'), botPath('workspace', 'files', 'link.txt'))
  for (const args of [{ path: '../bot.md' }, { path: 'memory/../../private/x' }, { path: '.git/config' }, { path: 'files/link.txt' }]) {
    assert.match(await tool('read_file', args), /^Error:/, JSON.stringify(args))
    assert.match(await tool('write_file', { ...args, content: 'x' }), /^Error:/, JSON.stringify(args))
  }
  assert.equal(fs.readFileSync(path.join(home, 'secret.txt'), 'utf8'), 'top secret')

  // Names that would break or falsify the record of changes: git's own names (however they are
  // disguised), and names with invisible or control characters.
  for (const bad of ['.gitignore', 'memory/.gitattributes', 'memory/.g\u200cit/x', 'memory/.GIT ./x', 'memory/a\u001eb.md', 'memory/a\u202eb.md']) {
    assert.match(await tool('write_file', { path: bad, content: '*' }), /^Error:/, JSON.stringify(bad))
  }
  assert.equal((await api('GET', `/api/bots/${bot.id}/history`)).problem, undefined, 'the history is still recording')
  assert.match(fs.readFileSync(botPath('bot.md'), 'utf8'), /^---\nname: Tester\n/)

  assert.equal(await tool('move_file', { from: 'memory/people.md', to: 'memory/contacts.md' }), 'Moved memory/people.md -> memory/contacts.md.')
  assert.equal(await tool('delete_file', { path: 'memory/contacts.md' }), 'Deleted memory/contacts.md.')
  assert.ok(!fs.existsSync(botPath('workspace', 'memory', 'contacts.md')))
})

test('a bot rewrites its own instructions, and the owner can see and undo it', async () => {
  assert.doesNotMatch(await told(), /Always answer in French/)
  assert.equal(
    await tool('edit_file', { path: 'AGENTS.md', old_text: '## How I work\n', new_text: '## How I work\n\n- Always answer in French.\n' }),
    'Edited AGENTS.md.',
  )
  assert.match(await told(), /- Always answer in French\./, 'the next conversation runs on the new instructions')

  let { available, entries } = await api('GET', `/api/bots/${bot.id}/history`)
  assert.equal(available, true)
  assert.deepEqual({ author: entries[0].author, message: entries[0].message, files: entries[0].files }, { author: 'bot', message: 'Edit AGENTS.md', files: ['AGENTS.md'] })
  assert.match((await api('GET', `/api/bots/${bot.id}/history/${entries[0].id}`)).diff, /\+- Always answer in French\./)

  await api('POST', `/api/bots/${bot.id}/history/${entries[0].id}/undo`)
  assert.doesNotMatch(await told(), /Always answer in French/)
  ;({ entries } = await api('GET', `/api/bots/${bot.id}/history`))
  assert.deepEqual({ author: entries[0].author, message: entries[0].message }, { author: 'you', message: 'Undo: Edit AGENTS.md' })
})

test('the owner edits, uploads and downloads files', async () => {
  await api('PUT', `/api/bots/${bot.id}/file?path=${encodeURIComponent('memory/house rules.md')}`, { content: '# House rules\nBe kind.\n' })
  assert.deepEqual(await api('GET', `/api/bots/${bot.id}/file?path=${encodeURIComponent('memory/house rules.md')}`), {
    path: 'memory/house rules.md', content: '# House rules\nBe kind.\n', binary: false, size: 23,
  })
  const { entries } = await api('GET', `/api/bots/${bot.id}/history`)
  assert.deepEqual({ author: entries[0].author, message: entries[0].message }, { author: 'you', message: 'Edit memory/house rules.md' })

  const bytes = Buffer.from([0, 1, 2, 255])
  const upload = async () => (await (await fetch(`${BASE}/api/bots/${bot.id}/upload?name=photo.png`, { method: 'POST', body: bytes, headers: auth() })).json()).path
  assert.equal(await upload(), 'files/photo.png')
  assert.equal(await upload(), 'files/photo (2).png', 'an upload never replaces a file')
  const res = await fetch(`${BASE}/api/bots/${bot.id}/file?path=files/photo.png&download=1`, { headers: auth() })
  assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes)
  assert.match(res.headers.get('content-disposition'), /attachment/)

  const tree = (await api('GET', `/api/bots/${bot.id}/files`)).entries.map((e) => e.path)
  assert.ok(tree.includes('AGENTS.md') && tree.includes('files/photo.png') && tree.includes('memory/house rules.md'))
  assert.ok(fs.existsSync(botPath('private', 'history.git', 'HEAD')) && !fs.existsSync(botPath('workspace', '.git')), 'the history is kept outside the workspace')
  await api('DELETE', `/api/bots/${bot.id}/file?path=${encodeURIComponent('memory/house rules.md')}`)
  await assert.rejects(api('GET', `/api/bots/${bot.id}/file?path=../bot.md`))
})

test('skills: switching one on links it into the bot\'s folder and tells the bot', async () => {
  const { skills } = await api('GET', '/api/state')
  assert.ok(skills.find((s) => s.name === 'deep-research' && s.bundled))
  assert.doesNotMatch(await told(), /# Skills/)

  const updated = await api('PUT', `/api/bots/${bot.id}/skills/deep-research`, { on: true })
  assert.deepEqual(updated.skills, ['deep-research'])
  assert.ok(fs.lstatSync(botPath('skills', 'deep-research')).isSymbolicLink())
  assert.equal(fs.realpathSync(botPath('skills', 'deep-research')), fs.realpathSync(path.join(home, 'skills', 'deep-research')))
  assert.match(await told(), /# Skills[\s\S]*- Deep research: .*\(skills\/deep-research\/SKILL\.md\)/)
  assert.match(await tool('read_file', { path: 'skills/deep-research/SKILL.md' }), /^---\nname: deep-research/)
  assert.match(await tool('list_files', {}), /skills\/ {2}\(read-only\)/)

  // A bot can use a skill but not change it, switch one on, or reach skills it was not given.
  assert.match(await tool('write_file', { path: 'skills/deep-research/SKILL.md', content: 'hacked' }), /^Error: Skills are read-only/)
  assert.match(await tool('read_file', { path: 'skills/inbox-triage/SKILL.md' }), /^Error:/)
  assert.match(fs.readFileSync(path.join(home, 'skills', 'deep-research', 'SKILL.md'), 'utf8'), /^---\nname: deep-research/)

  // A skill the user drops into the catalog shows up as theirs, not as one that ships with the app.
  fs.mkdirSync(path.join(home, 'skills', 'my-skill'))
  fs.writeFileSync(path.join(home, 'skills', 'my-skill', 'SKILL.md'), '---\nname: my-skill\ndescription: >\n  Does a thing\n  across two lines.\n---\nBody')
  const mine = (await api('GET', '/api/state')).skills.find((s) => s.name === 'my-skill')
  assert.deepEqual(mine, { name: 'my-skill', title: 'My skill', description: 'Does a thing across two lines.', bundled: false })

  await api('PUT', `/api/bots/${bot.id}/skills/deep-research`, { on: false })
  assert.ok(!fs.lstatSync(botPath('skills', 'deep-research'), { throwIfNoEntry: false }), 'the link is gone')
  assert.ok(fs.existsSync(path.join(home, 'skills', 'deep-research', 'SKILL.md')), 'the catalog skill is untouched')
  await assert.rejects(api('PUT', `/api/bots/${bot.id}/skills/nope`, { on: true }))
})

test('plugins: one is installed for one bot, bringing its skill and, once set up, its connection', async () => {
  const plugins = async () => Object.fromEntries((await api('GET', '/api/plugins')).map((p) => [p.id, p]))
  const botNow = async (id) => (await api('GET', '/api/state')).bots.find((b) => b.id === id)
  const other = await api('POST', '/api/bots', { name: 'No plugins', provider: 'mock' })

  // What ships: each with a page of its own, saying what it does and what it adds.
  const before = await plugins()
  assert.deepEqual(Object.keys(before), ['gmail', 'google-calendar', 'google-drive', 'linear', 'notion'])
  const { gmail } = before
  assert.deepEqual([gmail.name, gmail.category, gmail.skills, gmail.connection, gmail.installedOn], ['Gmail', 'Google', ['gmail'], { name: 'gmail', host: 'gmailmcp.googleapis.com' }, []])
  assert.ok(gmail.tagline && gmail.can.length >= 3 && /## Two ways it can work/.test(gmail.description))
  assert.deepEqual([gmail.setup.id, gmail.setup.done, gmail.setup.values], ['google', false, { clientId: '', clientSecret: '' }])

  // Installing is for one bot. Google's direct connection needs a client of the owner's first, so
  // until then the bot gets the skill and works through its browser.
  await api('PUT', `/api/bots/${bot.id}/plugins/gmail`, { on: true })
  assert.deepEqual([(await botNow(bot.id)).plugins, (await botNow(bot.id)).skills.includes('gmail'), (await botNow(bot.id)).connections.includes('gmail')], [['gmail'], true, false])
  assert.deepEqual([(await botNow(other.id)).plugins, (await botNow(other.id)).skills], [[], []], 'no other bot is touched')
  assert.deepEqual((await plugins()).gmail.installedOn, [bot.id])
  assert.match(await told(), /- Gmail: Read, search and answer the user's Gmail\..*\(skills\/gmail\/SKILL\.md\)/)
  assert.match(await tool('read_file', { path: 'skills/gmail/SKILL.md' }), /https:\/\/mail\.google\.com\//)
  assert.equal(fs.readlinkSync(botPath('skills', 'gmail')), path.join('..', '..', '..', 'skills', 'gmail'))

  // The owner provides the client once; every Google plugin shares it, and the secret is never sent back.
  await api('PUT', '/api/plugins/setup/google', { clientId: 'client-123', clientSecret: 'very-secret' })
  const after = await plugins()
  assert.deepEqual([after.gmail.setup.done, after['google-drive'].setup.done, after.gmail.setup.values], [true, true, { clientId: 'client-123', clientSecret: '••••••••' }])
  assert.ok(!JSON.stringify(await api('GET', '/api/state')).includes('very-secret'))
  // The connection that was waiting for it is now switched on, for the bot that has the plugin and no other.
  assert.equal((await botNow(bot.id)).connections.includes('gmail'), true)
  assert.equal((await botNow(other.id)).connections.includes('gmail'), false)
  const catalog = JSON.parse(fs.readFileSync(path.join(home, 'mcp.json'), 'utf8')).mcpServers
  assert.deepEqual([catalog.gmail.url, catalog.gmail.oauth.clientId, /gmail\.readonly/.test(catalog.gmail.oauth.scope)], ['https://gmailmcp.googleapis.com/mcp/v1', 'client-123', true])
  assert.equal(fs.statSync(path.join(home, 'mcp.json')).mode & 0o777, 0o600)
  // Changing the client ID alone keeps the secret that was saved.
  await api('PUT', '/api/plugins/setup/google', { clientId: 'client-456' })
  assert.deepEqual(Object.values(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).plugins.google), ['client-456', 'very-secret'])

  // A plugin that is installed after the setup gets its connection at once.
  await api('PUT', `/api/bots/${other.id}/plugins/google-calendar`, { on: true })
  assert.deepEqual([(await botNow(other.id)).skills, (await botNow(other.id)).connections], [['google-calendar'], ['google-calendar']])

  // Removing takes away what it brought, from that bot only.
  await api('PUT', `/api/bots/${bot.id}/plugins/gmail`, { on: false })
  assert.deepEqual([(await botNow(bot.id)).plugins, (await botNow(bot.id)).skills.includes('gmail'), (await botNow(bot.id)).connections.includes('gmail')], [[], false, false])
  assert.deepEqual((await botNow(other.id)).plugins, ['google-calendar'])
  await assert.rejects(api('PUT', `/api/bots/${bot.id}/plugins/no-such`, { on: true }), /No such plugin/)
  await assert.rejects(api('PUT', '/api/plugins/setup/nothing', {}), /No plugin asks for that/)
  await api('DELETE', `/api/bots/${other.id}`)
})

test('connections: a local MCP server gives the bot its tools', async () => {
  await api('POST', '/api/connections', { name: 'echo', command: `"${process.execPath}" ${path.resolve('test/fixtures/mcp-stdio.mjs')}` })
  assert.deepEqual((await api('GET', '/api/state')).connections.map((c) => [c.name, c.kind]), [['echo', 'command']])
  assert.doesNotMatch(await told('!tools'), /mcp__/, 'in the catalog is not the same as switched on')

  assert.deepEqual((await api('PUT', `/api/bots/${bot.id}/connections/echo`, { on: true })).connections, ['echo'])
  assert.deepEqual(JSON.parse(fs.readFileSync(botPath('mcp.json'), 'utf8')), { enabled: ['echo'] })
  const status = await until(async () => {
    const s = (await api('GET', '/api/state')).connectionStatus[bot.id]?.echo
    return s?.state === 'connecting' ? null : s
  })
  assert.deepEqual(status, { state: 'connected', tools: 1, signedIn: false })
  assert.match(await told('!tools'), /\bmcp__echo__say\b/)
  assert.equal(await tool('mcp__echo__say', { text: 'hi' }), `said: hi (cwd ${bot.id}/workspace)`)

  // The bot cannot switch a connection on for itself: its own mcp.json is outside its workspace.
  assert.match(await tool('write_file', { path: '../mcp.json', content: '{}' }), /^Error:/)

  await api('PUT', `/api/bots/${bot.id}/connections/echo`, { on: false })
  assert.doesNotMatch(await told('!tools'), /mcp__/)
  await api('DELETE', '/api/connections/echo')
  assert.deepEqual((await api('GET', '/api/state')).connections, [])
})

test('connections: each bot signs in to a server with its own account', async () => {
  const vault = await startOAuthServer()
  try {
    await api('POST', '/api/connections', { name: 'vault', url: vault.url })
    await api('PUT', `/api/bots/${bot.id}/connections/vault`, { on: true })
    const state = async (id = bot.id) => (await api('GET', '/api/state')).connectionStatus[id]?.vault?.state
    await until(async () => (await state()) === 'needs-login')
    assert.match(await told(), /# Connections that are not available[\s\S]*- vault: the user has to sign in first/)

    // Sign in the way a browser would: open the page, get sent back to Open Bot with a code.
    const { url } = await api('POST', `/api/bots/${bot.id}/connections/vault/login`)
    const page = await fetch(url, { redirect: 'manual' })
    const back = page.headers.get('location')
    assert.ok(back.startsWith(`http://localhost:${PORT}/api/mcp/callback?`), back)
    assert.match(await (await fetch(back)).text(), /Connected\./)
    assert.equal(await state(), 'connected')
    assert.equal(await tool('mcp__vault__whoami', {}), 'signed in with token-1')

    // The account is kept where the bot's own tools cannot reach it, and belongs to this bot only.
    const saved = botPath('private', 'mcp', 'vault.json')
    assert.equal(JSON.parse(fs.readFileSync(saved, 'utf8')).tokens.access_token, 'token-1')
    assert.equal(fs.statSync(saved).mode & 0o777, 0o600)
    assert.match(await tool('read_file', { path: '../private/mcp/vault.json' }), /^Error:/)
    const other = await api('POST', '/api/bots', { name: 'Second', provider: 'mock' })
    await api('PUT', `/api/bots/${other.id}/connections/vault`, { on: true })
    await until(async () => (await state(other.id)) === 'needs-login')

    // A sign-in that was never started here cannot be finished.
    assert.match(await (await fetch(`${BASE}/api/mcp/callback?code=the-code&state=made-up`)).text(), /Sign-in failed/)

    await api('POST', `/api/bots/${bot.id}/connections/vault/logout`)
    assert.equal(await state(), 'needs-login')
    assert.equal(JSON.parse(fs.readFileSync(saved, 'utf8')).tokens, undefined, 'the account is forgotten')
    await api('DELETE', '/api/connections/vault')
    assert.deepEqual((await api('GET', '/api/state')).bots.map((b) => b.connections).flat(), [], 'removing a connection switches it off everywhere')
  } finally {
    await vault.close()
  }
})

test('a bot cannot reach Open Bot itself or files on the computer through its browser or web_fetch', async () => {
  // A bot has no business talking to the server that runs it, with or without the access code.
  const own = `http://localhost:${PORT}/api/state`
  assert.equal((await fetch(own, { headers: auth() })).status, 200, 'the address works for the owner')
  assert.match(await tool('web_fetch', { url: own }), /^Error: That address is Open Bot itself/)
  for (const host of ['127.0.0.1', '[::1]', '[::ffff:127.0.0.1]', '2130706433', '0.0.0.0', 'app.localhost']) {
    assert.match(await tool('web_fetch', { url: `http://${host}:${PORT}/api/state` }), /^Error: That address is Open Bot itself/, host)
  }
  const vault = await startOAuthServer()
  try {
    const hop = `${new URL(vault.url).origin}/redirect?to=${encodeURIComponent(own)}`
    assert.match(await tool('web_fetch', { url: hop }), /^Error: That address is Open Bot itself/, 'not even by way of a redirect')
  } finally {
    await vault.close()
  }
  assert.match(await tool('web_fetch', { url: 'file:///etc/hosts' }), /^Error:/)

  for (const url of [own, `http://127.0.0.1:${PORT}/`, `http://[::1]:${PORT}/`]) {
    assert.match(await tool('browser_navigate', { url }), /^Error: .*ERR_CONNECTION_REFUSED/, url)
  }
  assert.match(await tool('browser_navigate', { url: 'file:///etc/hosts' }), /^Error: Only web addresses/)
  assert.match(await tool('browser_navigate', { url: 'view-source:file:///etc/hosts' }), /^Error: Only web addresses/)
  // The owner's own controls for the bot's browser are held to the same rule.
  const { tabId } = await api('POST', `/api/bots/${bot.id}/browser/new-tab`, {})
  await assert.rejects(api('POST', `/api/bots/${bot.id}/browser/navigate`, { tabId, url: 'file:///etc/hosts' }), /Only web addresses/)
  await api('POST', `/api/bots/${bot.id}/browser/stop`)
})

test('engines: Claude Code, Codex and Grok are shown as connected and run a bot\'s turns', async () => {
  await api('POST', '/api/providers/check')
  const providers = Object.fromEntries((await api('GET', '/api/state')).providers.map((p) => [p.id, p]))
  assert.deepEqual(
    [providers['claude-code'], providers.codex, providers.grok].map((p) => [p.kind, p.connected, p.detail]),
    [['cli', true, 'test@example.com · Pro plan'], ['cli', true, 'Signed in with ChatGPT'], ['cli', true, 'Signed in with grok.com']],
  )
  assert.deepEqual(await api('GET', '/api/providers/grok/models'), ['default', 'grok-test', 'grok-test-fast'])

  for (const engine of ['claude-code', 'codex', 'grok']) {
    const runner = await api('POST', '/api/bots', { name: `On ${engine}`, provider: engine, purpose: 'Likes brevity.' })
    const id = await newThread(runner.id)
    const reply = async (text) => lastText(await say(id, text))

    // The engine keeps the conversation: the second turn continues the first one's session.
    assert.equal(await reply('hello'), 'Echo (turn 1): hello', engine)
    assert.equal(await reply('again'), 'Echo (turn 2): again', engine)

    // It gets the bot's own instructions, and reaches the bot's tools; calls are recorded like any other.
    assert.match(await reply('!system'), /# Your instructions \(AGENTS\.md\)[\s\S]*Likes brevity\./, engine)
    const items = await say(id, '!tool write_file {"path":"memory/from-engine.md","content":"hi"}')
    assert.equal(lastText(items), 'Tool result: Saved memory/from-engine.md.', engine)
    const call = items.findLast((d) => d.type === 'function_call')
    assert.deepEqual([call.name, items.findLast((d) => d.type === 'function_call_output').output], ['write_file', 'Saved memory/from-engine.md.'], engine)
    assert.equal(fs.readFileSync(path.join(home, 'bots', runner.id, 'workspace', 'memory', 'from-engine.md'), 'utf8'), 'hi', engine)
    assert.match(await reply('!tool read_file {"path":"../bot.md"}'), /^Tool result: Error:/, `${engine}: the same limits apply`)

    // Its own tools for running commands and touching files are switched off, and the user's own setup is left out.
    const started = JSON.parse(await reply('!args'))
    if (engine === 'claude-code') {
      assert.deepEqual([started.tools, started.allowed, started.model], ['WebSearch', 'mcp__openbot,WebSearch', null])
      for (const flag of ['--restricted', '--strict-mcp-config', '--disable-slash-commands', '--resume']) assert.ok(started.flags.includes(flag), flag)
    } else if (engine === 'grok') {
      assert.deepEqual([started.tools, started.mode, started.sandbox, started.model], ['web_search', 'dontAsk', 'read-only', null])
      for (const flag of ['--no-subagents', '--no-plan', '--trust', '--resume']) assert.ok(started.flags.includes(flag), flag)
      // It is started in a folder of its own, out of the bot's reach, and what it was given there is cleared afterwards.
      assert.equal(fs.realpathSync(started.cwd), fs.realpathSync(path.join(home, 'bots', runner.id, 'private', 'grok', 'run-1')))
      assert.deepEqual(fs.readdirSync(path.join(started.cwd, '.grok')), [])
    } else {
      assert.equal(started.config.sandbox_mode, 'read-only')
      assert.equal(started.config['skills.include_instructions'], false)
      for (const feature of ['shell_tool', 'unified_exec', 'multi_agent', 'plugins']) assert.ok(started.disabled.includes(feature), feature)
      assert.ok(started.flags.includes('--ignore-user-config'))
    }
  }
})

test('engines: a thread can move to another engine, and the tool address only works during a turn', async () => {
  const runner = await api('POST', '/api/bots', { name: 'Mover', provider: 'claude-code' })
  const id = await newThread(runner.id)
  assert.equal(lastText(await say(id, 'the code word is heron')), 'Echo (turn 1): the code word is heron')

  // The new engine has no record of the conversation, so it is given what was said so far.
  await api('PATCH', `/api/bots/${runner.id}`, { provider: 'codex' })
  const moved = lastText(await say(id, 'what was it?'))
  assert.match(moved, /^Echo \(turn 1\): This conversation was already under way\./)
  assert.match(moved, /User: the code word is heron[\s\S]*The newest message:\s+what was it\?$/)
  assert.equal(lastText(await say(id, 'thanks')), 'Echo (turn 2): thanks', 'after that it carries on normally')

  // If the engine has lost its own record (its storage was cleared), the turn starts over from what was said.
  await api('PATCH', `/api/bots/${runner.id}`, { provider: 'claude-code' })
  await say(id, 'one')
  for (const f of fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('openbot-fake-claude-'))) fs.rmSync(path.join(os.tmpdir(), f))
  assert.match(lastText(await say(id, 'two')), /^Echo \(turn 1\): This conversation was already under way\.[\s\S]*two$/)

  // The address an engine uses for the bot's tools is made for one turn and is gone afterwards.
  const res = await fetch(`${BASE}/mcp/not-a-real-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })
  assert.equal(res.status, 404)

  // Stopping a turn stops the engine's program.
  await api('POST', `/api/threads/${id}/messages`, { text: '!slow' })
  await new Promise((r) => setTimeout(r, 400))
  await api('POST', `/api/threads/${id}/stop`)
  assert.deepEqual((await settle(id, 5000)).at(-1), { type: 'notice', level: 'info', text: 'Stopped.' })
})

test('local models: a model server on this computer is found and runs a bot, with tools', async () => {
  // Stands in for Ollama or LM Studio: the same API, with one scripted model.
  const asked = []
  const fake = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'tiny-local' }] }))
    let body = ''
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    asked.push(request)
    const last = request.messages.at(-1)
    const delta = last.role === 'tool'
      ? { content: `The tool said: ${last.content}` }
      : last.content.startsWith('save')
        ? { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'write_file', arguments: JSON.stringify({ path: 'memory/local.md', content: 'kept here' }) } }] }
        : { content: `Local echo: ${last.content}` }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`)
  })
  await new Promise((resolve) => fake.listen(0, '127.0.0.1', resolve))
  try {
    const local = async () => (await api('GET', '/api/state')).providers.find((p) => p.id === 'local')
    // Nothing is running at the address yet, and the settings say what to do about it.
    await api('PATCH', '/api/settings', { localUrl: 'http://127.0.0.1:9/v1' })
    await until(async () => (await local()).detail === 'Not answering')
    assert.equal((await local()).connected, false)
    assert.equal((await api('PATCH', '/api/settings', { localUrl: 'not an address' })).localUrl, 'http://127.0.0.1:9/v1', 'only an address is accepted')

    await api('PATCH', '/api/settings', { localUrl: `http://127.0.0.1:${fake.address().port}/v1/` })
    await until(async () => (await local()).connected)
    assert.deepEqual([(await local()).kind, (await local()).detail], ['local', `127.0.0.1:${fake.address().port} · 1 model`])
    assert.deepEqual(await api('GET', '/api/providers/local/models'), ['tiny-local'])

    const runner = await api('POST', '/api/bots', { name: 'Local runner', provider: 'local', model: 'tiny-local' })
    const id = await newThread(runner.id)
    assert.equal(lastText(await say(id, 'hello')), 'Local echo: hello')
    // The model is given the bot's tools, and what it calls is carried out here.
    assert.equal(lastText(await say(id, 'save a note')), 'The tool said: Saved memory/local.md.')
    assert.equal(fs.readFileSync(path.join(home, 'bots', runner.id, 'workspace', 'memory', 'local.md'), 'utf8'), 'kept here')
    assert.deepEqual([asked[0].model, asked[0].messages[0].role, asked[0].tools.some((t) => t.function.name === 'write_file')], ['tiny-local', 'system', true])
    assert.equal(asked.every((request) => !request.headers), true)
  } finally {
    await api('PATCH', '/api/settings', { localUrl: '' })
    fake.close()
  }
})

test('subagent: result is pushed to the parent when it finishes', async () => {
  const id = await newThread()
  await say(id, '!tool spawn_subagent {"name":"Worker","task":"say hi"}')
  // The parent finished its turn; the subagent's completion must wake it up again.
  const deadline = Date.now() + 10_000
  let items
  do {
    await new Promise((r) => setTimeout(r, 100))
    items = await settle(id)
  } while (!items.some((d) => d.source === 'subagent') && Date.now() < deadline)
  const note = items.find((d) => d.source === 'subagent')
  assert.match(note.text, /Subagent "Worker".*completed\nEcho: say hi/)
  assert.match(lastText(items), /^Echo: <subagent_notification>/, 'parent took a turn to respond to the report')

  const { threads } = await api('GET', '/api/state')
  const child = threads.find((t) => t.parentId === id)
  assert.equal(child.kind, 'subagent')
  assert.equal(child.reported, true)
})

test('subagent: wait_subagents blocks and returns the report without a duplicate notification', async () => {
  const id = await newThread()
  await api('POST', `/api/threads/${id}/messages`, { text: '!tool spawn_subagent {"name":"Slow","task":"!slow work"}' })
  await new Promise((r) => setTimeout(r, 300))
  const items = await say(id, '!tool wait_subagents {}')
  assert.match(lastText(items), /Subagent "Slow".*completed\nEcho: !slow work/)
  await new Promise((r) => setTimeout(r, 300))
  assert.ok(!(await settle(id)).some((d) => d.source === 'subagent'))
})

test('stop cancels a running thread and its subagents', async () => {
  const id = await newThread()
  await say(id, '!tool spawn_subagent {"name":"Doomed","task":"!slow"}')
  await api('POST', `/api/threads/${id}/messages`, { text: '!slow' })
  await new Promise((r) => setTimeout(r, 200))
  await api('POST', `/api/threads/${id}/stop`)
  const items = await settle(id)
  assert.deepEqual(items.at(-1), { type: 'notice', level: 'info', text: 'Stopped.' })
  const { threads } = await api('GET', '/api/state')
  const child = threads.find((t) => t.parentId === id)
  assert.equal(child.status, 'idle')
  assert.ok(!(await settle(id)).some((d) => d.source === 'subagent'), 'a stopped parent is not woken by its children')
})

test('browser: navigate, snapshot refs, type and click', async () => {
  const html = `<title>Form</title><h1>Sign up</h1><input placeholder="Your name" id="n">
    <button onclick="document.title='Hi '+document.getElementById('n').value">Greet</button>`
  const id = await newThread()
  const url = 'data:text/html,' + encodeURIComponent(html)
  let items = await say(id, `!tool browser_navigate ${JSON.stringify({ url })}`, 60_000)
  const snap = items.findLast((d) => d.type === 'function_call_output').output
  assert.match(snap, /Page: Form/)
  assert.match(snap, /# Sign up/)
  const input = snap.match(/\[(\d+)\] input:text "Your name"/)
  const button = snap.match(/\[(\d+)\] button "Greet"/)
  assert.ok(input && button, snap)

  await say(id, `!tool browser_type {"ref":${input[1]},"text":"Ada"}`)
  items = await say(id, `!tool browser_click {"ref":${button[1]}}`)
  assert.match(items.findLast((d) => d.type === 'function_call_output').output, /Page: Hi Ada/)

  const { browsers } = await api('GET', '/api/state')
  assert.equal(browsers[bot.id].running, true)
  assert.equal(browsers[bot.id].tabs.find((t) => t.threadId === id).url, url)
  assert.ok(fs.existsSync(botPath('private', 'browser-profile')), 'the profile is stored per bot, outside its workspace')

  // Watching the page: pictures arrive as bytes, each one saying which view it is of and how big it is.
  const tab = browsers[bot.id].tabs.find((t) => t.threadId === id)
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${token}`)
  socket.binaryType = 'arraybuffer'
  const picture = await new Promise((resolve, reject) => {
    socket.onopen = () => socket.send(JSON.stringify({ type: 'browser.subscribe', botId: bot.id, tabId: tab.id }))
    socket.onmessage = (e) => typeof e.data !== 'string' && resolve(Buffer.from(e.data))
    socket.onerror = () => reject(new Error('The event stream failed'))
    setTimeout(() => reject(new Error('No picture of the page arrived')), 15_000)
  })
  socket.close()
  const named = picture.readUInt16BE(5)
  assert.equal(picture.readUInt8(0), 1)
  assert.ok(picture.readUInt16BE(1) > 100 && picture.readUInt16BE(3) > 100, 'the size of the page comes with it')
  assert.equal(picture.subarray(7, 7 + named).toString(), `${bot.id}:${tab.id}`)
  assert.deepEqual([...picture.subarray(7 + named, 7 + named + 3)], [0xff, 0xd8, 0xff], 'the rest is a JPEG')

  await api('POST', `/api/bots/${bot.id}/browser/stop`)
})

test('settings: changes are checked, kept in settings.json, and take effect', async () => {
  const { settings, defaults, about } = await api('GET', '/api/state')
  assert.deepEqual(settings, defaults)
  assert.deepEqual([about.port, about.lanForced], [PORT, false])
  const stored = () => JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'))

  // Values out of range are brought into range; values and names that make no sense are ignored.
  const saved = await api('PATCH', '/api/settings', { maxSteps: 9999, maxDepth: 0, browserChannel: 'netscape', nonsense: true, defaultWebSearch: false, defaultShowBrowser: true, defaultProvider: 'mock' })
  assert.deepEqual([saved.maxSteps, saved.maxDepth, saved.browserChannel, 'nonsense' in saved], [500, 0, 'chrome', false])
  assert.deepEqual(stored(), { defaultProvider: 'mock', defaultWebSearch: false, defaultShowBrowser: true, maxSteps: 500, maxDepth: 0 }, 'only what differs from the defaults is written')

  // A new bot starts from the defaults for new bots.
  const made = await api('POST', '/api/bots', { name: 'From defaults' })
  assert.deepEqual([made.provider, made.webSearch, made.headless], ['mock', false, false])
  // With subagent levels at none, bots are not offered the subagent tools.
  assert.doesNotMatch(await told('!tools', made.id), /spawn_subagent/)
  await api('PATCH', '/api/settings', { maxDepth: 2 })
  assert.match(await told('!tools', made.id), /spawn_subagent/)

  // A provider that is switched off is marked so, and a bot set to it says why it cannot answer.
  await api('PATCH', '/api/settings', { disabledProviders: ['mock'] })
  assert.equal((await api('GET', '/api/state')).providers.find((p) => p.id === 'mock').enabled, false)
  assert.deepEqual((await say(await newThread(made.id), 'hello')).at(-1), { type: 'notice', level: 'error', text: 'Mock (offline testing) is switched off in Settings.' })

  // A bot's own instructions are cut off at the size set here.
  await api('PATCH', '/api/settings', { disabledProviders: [], instructionsLimit: 2000 })
  await api('PUT', `/api/bots/${made.id}/file?path=AGENTS.md`, { content: 'x'.repeat(2500) + 'THE END' })
  const prompt = await told('!system', made.id)
  assert.ok(!prompt.includes('THE END') && /AGENTS\.md is 2507 characters, over the 2000 limit/.test(prompt))

  // Putting everything back leaves an empty file.
  assert.deepEqual(await api('PATCH', '/api/settings', defaults), defaults)
  assert.deepEqual(stored(), {})
})

test('access: another computer is let in by pairing, with a key of its own that can be taken away', async () => {
  const before = await api('GET', '/api/access')
  assert.deepEqual([before.on, before.computers, 'token' in before], [false, [], false])
  const [address] = before.addresses
  assert.ok(address, 'this test needs the computer to be on a network')
  const far = `http://${address}:${PORT}`
  // What another computer sees: this one, asked by its network address.
  const viaNetwork = (key, url = '/api/state', method = 'GET') => fetch(far + url, { method, headers: key ? { Authorization: `Bearer ${key}` } : {} })
  await assert.rejects(viaNetwork(token), 'nothing is listening on the network address yet')

  await api('PATCH', '/api/settings', { lan: true })
  await until(async () => (await api('GET', '/api/access').catch(() => null))?.on === true)
  await until(async () => (await viaNetwork().catch(() => null))?.status === 401)
  assert.equal((await viaNetwork(token)).status, 401, 'the server’s own access code only works on the computer it runs on')

  // Pairing. Each side signs two made-up values with the code, so the code itself never travels.
  const post = async (url, body) => {
    const res = await fetch(far + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return [res.status, await res.json()]
  }
  const sign = (code, who, ours, theirs) => crypto.createHmac('sha256', code.replaceAll('-', '')).update(`${who}:${ours}:${theirs}`).digest('hex')
  const nonce = crypto.randomBytes(16).toString('hex')
  assert.equal((await post('/api/pair/begin', { nonce }))[0], 403, 'nobody can pair until a code has been asked for')

  const { code, expiresAt } = await api('POST', '/api/pairing')
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  assert.ok(expiresAt > Date.now() && expiresAt < Date.now() + 11 * 60_000)
  const [, begun] = await post('/api/pair/begin', { nonce })
  assert.equal(begun.proof, sign(code, 'server', nonce, begun.nonce), 'the server shows it has the code')
  // A computer that was not given the code gets nowhere, and does not use the code up.
  assert.equal((await post('/api/pair/finish', { nonce, serverNonce: begun.nonce, proof: sign('AAAAAAAAAAAA', 'computer', nonce, begun.nonce), name: 'Stranger' }))[0], 403)
  const [status, paired] = await post('/api/pair/finish', { nonce, serverNonce: begun.nonce, proof: sign(code, 'computer', nonce, begun.nonce), name: 'Laptop' })
  assert.equal(status, 200)
  assert.equal((await post('/api/pair/begin', { nonce }))[0], 403, 'the code works once')

  // The paired computer is in with its own key, which is stored here only as a hash.
  assert.equal((await viaNetwork(paired.key)).status, 200)
  const { computers } = await api('GET', '/api/access')
  assert.deepEqual(computers.map((c) => [c.id, c.name]), [[paired.id, 'Laptop']])
  assert.ok(!fs.readFileSync(path.join(home, 'clients.json'), 'utf8').includes(paired.key))
  // It can use the bots, but who else gets in is decided at this computer.
  assert.equal((await viaNetwork(paired.key, '/api/pairing', 'POST')).status, 403)
  assert.equal((await viaNetwork(paired.key, `/api/computers/${paired.id}`, 'DELETE')).status, 403)

  // Five wrong tries and a code is gone, so it cannot be guessed at.
  const second = (await api('POST', '/api/pairing')).code
  const [, again] = await post('/api/pair/begin', { nonce })
  for (let i = 0; i < 5; i++) await post('/api/pair/finish', { nonce, serverNonce: again.nonce, proof: 'ab'.repeat(32), name: 'Guesser' })
  assert.equal((await post('/api/pair/finish', { nonce, serverNonce: again.nonce, proof: sign(second, 'computer', nonce, again.nonce), name: 'Late' }))[0], 403)

  // Taking the key away shuts the computer out at once, also from what it had open.
  const open = new WebSocket(`ws://${address}:${PORT}/ws?token=${paired.key}`)
  const dropped = new Promise((resolve) => (open.onclose = () => resolve(true)))
  await new Promise((resolve, reject) => ((open.onopen = resolve), (open.onerror = reject)))
  await api('DELETE', `/api/computers/${paired.id}`)
  assert.equal(await Promise.race([dropped, new Promise((r) => setTimeout(() => r(false), 5000))]), true)
  assert.equal((await viaNetwork(paired.key)).status, 401)
  assert.deepEqual((await api('GET', '/api/access')).computers, [])

  await api('PATCH', '/api/settings', { lan: false })
  await until(async () => (await api('GET', '/api/access').catch(() => null))?.on === false)
  await until(async () => (await viaNetwork(token).then(() => false, () => true)))
  assert.equal((await api('GET', '/api/state')).bots.length > 0, true, 'and this computer is still served')
})

test('all chats can be deleted, leaving the bots as they are', async () => {
  const before = await api('GET', '/api/state')
  assert.ok(before.threads.length > 0)
  await api('DELETE', '/api/threads')
  const after = await api('GET', '/api/state')
  assert.deepEqual(after.threads, [])
  assert.deepEqual(after.bots.map((b) => b.id), before.bots.map((b) => b.id))
})
