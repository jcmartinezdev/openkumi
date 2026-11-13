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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-test-'))
/** The superpowers the server offers: the ones that ship, and any the tests add. */
const powers = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-superpowers-'))
fs.cpSync(path.resolve('superpowers'), powers, { recursive: true })
function addPower(id, manifest, instructions) {
  fs.mkdirSync(path.join(powers, id))
  fs.writeFileSync(path.join(powers, id, 'superpower.json'), JSON.stringify({ categories: ['Tests'], tagline: 'For tests.', summary: `${manifest.name} for tests.`, can: [], ...manifest }))
  if (instructions) fs.writeFileSync(path.join(powers, id, 'instructions.md'), instructions)
}
const removePower = (id) => fs.rmSync(path.join(powers, id), { recursive: true, force: true })
// One with nothing to sign in to: instructions only.
addPower('field-guide', { name: 'Field guide' }, '# Field guide\n\nLook at the beak first.\n')
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

/** The bot's conversation, once something has been said in it. */
const conversationOf = async (botId) => (await api('GET', '/api/state')).threads.find((t) => t.botId === botId && !t.parentId && !t.archivedAt)
/** What waits for the bot in a thread, oldest first. */
const waitingIn = async (threadId) => (await api('GET', '/api/state')).queue.filter((w) => w.threadId === threadId)
/** What was said in a thread: the messages, in order. */
const spoken = (items) => items.filter((d) => d.type === 'message').map((d) => d.text)

const lastText = (items) => items.findLast((d) => d.type === 'message' && d.role === 'assistant')?.text
/** Starts a bot's conversation afresh and gives its id, so that a test begins with nothing said. */
const fresh = async (botId = bot.id) => (await api('POST', `/api/bots/${botId}/fresh`)).id
const botPath = (...parts) => path.join(home, 'bots', bot.id, ...parts)

/** Calls one tool through the scripted model and returns what the tool gave back. */
async function tool(name, args, botId = bot.id) {
  const items = await say(await fresh(botId), `!tool ${name} ${JSON.stringify(args)}`)
  return items.findLast((d) => d.type === 'function_call_output').output
}

/** What the model is told (its system prompt) or offered (its tool names) for a bot right now. */
const told = async (what = '!system', botId = bot.id) => lastText(await say(await fresh(botId), what))

/** Calls one tool in a thread through the scripted model and returns what the tool gave back. */
async function toolIn(threadId, name, args, timeoutMs) {
  const items = await say(threadId, `!tool ${name} ${JSON.stringify(args)}`, timeoutMs)
  return items.findLast((d) => d.type === 'function_call_output').output
}

/** Sends a file up to wait for a message, as the apps do when the owner picks one to send. */
async function pick(botId, name, bytes) {
  const res = await fetch(`${BASE}/api/bots/${botId}/attachments?name=${encodeURIComponent(name)}`, { method: 'POST', body: bytes, headers: auth() })
  return res.json()
}

/** A picture one pixel in size. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
/** A PDF of one page that says `text`. */
function pdf(text) {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = objects.map((object, i) => {
    const at = out.length
    out += `${i + 1} 0 obj\n${object}\nendobj\n`
    return at
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/** A connection to the server's event stream, as an app's view has. */
async function openSocket() {
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${token}`)
  socket.binaryType = 'arraybuffer'
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error('The event stream failed'))
  })
  return socket
}

/** Takes control of a window of the bot's browser from a view of its own; closing the view hands it back. */
async function takeControl(windowId, botId = bot.id) {
  const socket = await openSocket()
  const viewer = crypto.randomUUID()
  const control = (action) => socket.send(JSON.stringify({ type: 'browser.control', botId, windowId, viewer, action }))
  control('take')
  return { socket, viewer, give: () => control('give'), decline: () => control('decline'), close: () => socket.close() }
}

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
      OPENKUMI_HOME: home,
      OPENKUMI_PORT: String(PORT),
      OPENKUMI_MOCK: '1',
      OPENKUMI_SUPERPOWERS: powers,
      // Scripted stand-ins for the Claude Code and Codex programs.
      OPENKUMI_CLAUDE_BIN: path.resolve('test/fixtures/fake-claude.mjs'),
      OPENKUMI_CODEX_BIN: path.resolve('test/fixtures/fake-codex.mjs'),
      OPENKUMI_GROK_BIN: path.resolve('test/fixtures/fake-grok.mjs'),
      // And for Tailscale's, which says this computer is on a tailnet.
      OPENKUMI_TAILSCALE_BIN: path.resolve('test/fixtures/fake-tailscale.mjs'),
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
  fs.rmSync(powers, { recursive: true, force: true })
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
  assert.equal((await get('/api/state', { Cookie: `openkumi_token=${token}` })).status, 401, 'cookies mean nothing')
  assert.equal((await get('/api/state', auth())).status, 200)

  // Anyone may ask who is here; only the app on this computer is told where the data folder is.
  const hello = await (await get('/api/hello')).json()
  assert.deepEqual([hello.app, hello.authorized, hello.home], ['openkumi', false, home])
  // It says which server it is, the same whatever address it is asked at.
  assert.match(hello.id, /^s_[\w-]{12}$/)
  // ...and not a web page whose own name has been pointed at this computer.
  const renamed = await new Promise((resolve, reject) =>
    http.get({ host: '127.0.0.1', port: PORT, path: '/api/hello', headers: { host: `evil.example:${PORT}` } }, (res) => {
      let body = ''
      res.on('data', (d) => (body += d)).on('end', () => resolve(JSON.parse(body)))
    }).on('error', reject),
  )
  assert.deepEqual([renamed.app, 'home' in renamed], ['openkumi', false])
  assert.equal((await (await get('/api/hello', auth())).json()).authorized, true)
  // A proxy on this computer (a tunnel, a web server in front of OpenKumi) passes on requests from
  // elsewhere. Those are not this computer: the access code means nothing there, and the data folder is not named.
  for (const header of ['X-Forwarded-For', 'Forwarded', 'X-Real-IP', 'CF-Connecting-IP']) {
    assert.equal((await get('/api/state', { ...auth(), [header]: '203.0.113.9' })).status, 401, header)
    assert.equal('home' in (await (await get('/api/hello', { [header]: '203.0.113.9' })).json()), false, header)
  }

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
  assert.equal(await from('openkumi://app'), 'openkumi://app')
  assert.equal(await from('https://evil.example'), null)
  const preflight = await fetch(`${BASE}/api/state`, { method: 'OPTIONS', headers: { Origin: 'openkumi://app', 'Access-Control-Request-Headers': 'authorization' } })
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

test('chat: streams a reply, and the conversation is named after what it began with', async () => {
  const id = await fresh()
  const items = await say(id, 'hello there')
  assert.equal(lastText(items), 'Echo: hello there')
  const { thread } = await api('GET', `/api/threads/${id}`)
  assert.equal(thread.title, 'hello there')
})

test('a bot has one conversation: messages go to it, starting fresh sets it aside, and an earlier one can be continued', async () => {
  const one = await api('POST', '/api/bots', { name: 'Single', provider: 'mock' })
  const conversations = async () => (await api('GET', '/api/state')).threads.filter((t) => t.botId === one.id && !t.parentId)
  assert.deepEqual(await conversations(), [], 'nothing is kept until something is said')

  // Whatever is sent to the bot lands in the same conversation.
  const first = await api('POST', `/api/bots/${one.id}/messages`, { text: 'the code word is heron' })
  await settle(first.id)
  assert.equal((await api('POST', `/api/bots/${one.id}/messages`, { text: 'second message' })).id, first.id)
  assert.deepEqual((await settle(first.id)).filter((d) => d.type === 'message').map((d) => d.text), ['the code word is heron', 'Echo: the code word is heron', 'second message', 'Echo: second message'])
  assert.deepEqual((await conversations()).map((t) => [t.id, t.archivedAt, t.title]), [[first.id, null, 'the code word is heron']])

  // Starting fresh sets it aside, to be read only, and begins an empty one. Doing so again changes nothing more.
  const next = await api('POST', `/api/bots/${one.id}/fresh`)
  assert.notEqual(next.id, first.id)
  assert.equal((await api('POST', `/api/bots/${one.id}/fresh`)).id, next.id)
  const [old, current] = await conversations()
  assert.ok(old.id === first.id && old.archivedAt > 0 && current.id === next.id && current.archivedAt === null)
  await assert.rejects(api('POST', `/api/threads/${first.id}/messages`, { text: 'hello?' }), /earlier conversation, which can only be read/)
  assert.equal(lastText(await say(next.id, '!sent')), 'user: !sent', 'the bot starts with nothing in front of it')

  // It cannot be set aside while the bot is at work in it.
  await api('POST', `/api/bots/${one.id}/messages`, { text: '!slow' })
  await assert.rejects(api('POST', `/api/bots/${one.id}/fresh`), /still working/)
  await assert.rejects(api('POST', `/api/threads/${first.id}/resume`), /still working/)
  await api('POST', `/api/threads/${next.id}/stop`)
  await settle(next.id)

  // Continuing the earlier one swaps the two, and the bot has it in front of it again.
  const resumed = await api('POST', `/api/threads/${first.id}/resume`)
  assert.deepEqual([resumed.id, resumed.archivedAt], [first.id, null])
  assert.deepEqual((await conversations()).map((t) => [t.id, t.archivedAt === null]), [[first.id, true], [next.id, false]])
  assert.match(lastText(await say(first.id, '!sent')), /^user: the code word is heron\nassistant: Echo: the code word is heron\n/)
  assert.equal((await api('POST', `/api/bots/${one.id}/messages`, { text: 'back again' })).id, first.id)
  await settle(first.id)
})

test('what is said while the bot is working waits in a queue, and is read one message at a time, in order', async () => {
  const id = await fresh()
  await api('POST', `/api/threads/${id}/messages`, { text: '!drip one two three four five six' })
  await api('POST', `/api/threads/${id}/messages`, { text: 'second' })
  await api('POST', `/api/threads/${id}/messages`, { text: 'third' })
  // They wait where the apps can show them, and are not part of the conversation yet.
  const waiting = await waitingIn(id)
  assert.deepEqual(waiting.map((w) => [w.message.text, w.message.source, w.now]), [['second', 'user', false], ['third', 'user', false]])
  assert.deepEqual(spoken((await api('GET', `/api/threads/${id}`)).items.map((i) => i.data)), ['!drip one two three four five six'])
  // Each is answered in a turn of its own, in the order it came.
  assert.deepEqual(spoken(await settle(id)), ['!drip one two three four five six', 'one two three four five six', 'second', 'Echo: second', 'third', 'Echo: third'])
  assert.deepEqual(await waitingIn(id), [])
})

test('a waiting message can be taken back, or read at once by the bot as it works', async () => {
  const id = await fresh()
  await api('PATCH', '/api/settings', { maxSteps: 300 })
  try {
    await api('POST', `/api/threads/${id}/messages`, { text: '!steps 200' })
    for (const text of ['never mind', 'later', 'read this now']) await api('POST', `/api/threads/${id}/messages`, { text })
    const [gone, , now] = await waitingIn(id)
    // One taken back is never read.
    await api('DELETE', `/api/queue/${gone.id}`)
    await assert.rejects(api('POST', `/api/queue/${gone.id}/now`), /no longer waiting/)
    // One sent now goes in before the bot's next step, ahead of what was waiting longer.
    await api('POST', `/api/queue/${now.id}/now`)
    const items = await settle(id)
    assert.deepEqual(spoken(items), ['!steps 200', 'read this now', 'Echo: read this now', 'later', 'Echo: later'])
    const at = items.findIndex((d) => d.text === 'read this now')
    const steps = items.slice(0, at).filter((d) => d.type === 'function_call').length
    assert.ok(steps > 0 && steps < 200, `it arrived as the bot worked, after ${steps} steps`)
    assert.equal(items[at - 1].type, 'function_call_output', 'the step under way was finished first')
  } finally {
    await api('PATCH', '/api/settings', { maxSteps: 80 })
  }
})

test('at most ten messages wait for a bot; a bot that is stopped does not start again by itself on what was waiting', async () => {
  const id = await fresh()
  await api('POST', `/api/threads/${id}/messages`, { text: '!slow first' })
  for (let n = 1; n <= 10; n++) await api('POST', `/api/threads/${id}/messages`, { text: `waiting ${n}` })
  await assert.rejects(api('POST', `/api/threads/${id}/messages`, { text: 'one too many' }), /Tester is busy: 10 messages are already waiting for it\./)
  await assert.rejects(api('POST', `/api/bots/${bot.id}/messages`, { text: 'one too many' }), /Tester is busy/)
  assert.equal((await waitingIn(id)).length, 10)

  // Stopped, the bot leaves what was waiting where it is: held back, for the owner to let go.
  await api('POST', `/api/threads/${id}/stop`)
  assert.deepEqual(spoken(await settle(id)), ['!slow first'])
  await new Promise((r) => setTimeout(r, 200))
  const held = async () => (await api('GET', `/api/threads/${id}`)).thread.held
  assert.deepEqual([await held(), (await waitingIn(id)).length], [true, 10])
  // It cannot be set aside with messages still waiting in it.
  await assert.rejects(api('POST', `/api/bots/${bot.id}/fresh`), /Messages are still waiting for the bot/)

  // One sent now is read, and only that one.
  const waiting = await waitingIn(id)
  for (const w of waiting.slice(0, 7)) await api('DELETE', `/api/queue/${w.id}`)
  await api('POST', `/api/queue/${waiting[9].id}/now`)
  assert.deepEqual(spoken(await settle(id)).slice(1), ['waiting 10', 'Echo: waiting 10'])
  assert.deepEqual([await held(), (await waitingIn(id)).map((w) => w.message.text)], [true, ['waiting 8', 'waiting 9']])

  // The owner writing to the bot lets the rest go, in order, ahead of what they wrote.
  await api('POST', `/api/threads/${id}/messages`, { text: 'carry on' })
  assert.deepEqual(spoken(await settle(id)).slice(3), ['waiting 8', 'Echo: waiting 8', 'waiting 9', 'Echo: waiting 9', 'carry on', 'Echo: carry on'])
  assert.deepEqual([await held(), await waitingIn(id)], [false, []])

  // So does letting them go without writing; and a queue emptied by hand is no longer held back.
  await api('POST', `/api/threads/${id}/messages`, { text: '!slow again' })
  await api('POST', `/api/threads/${id}/messages`, { text: 'held one' })
  await api('POST', `/api/threads/${id}/stop`)
  await settle(id)
  assert.equal(await held(), true)
  await api('POST', `/api/threads/${id}/queue/go`)
  assert.equal(lastText(await settle(id)), 'Echo: held one')
  await api('POST', `/api/threads/${id}/messages`, { text: '!slow once more' })
  await api('POST', `/api/threads/${id}/messages`, { text: 'not after all' })
  await api('POST', `/api/threads/${id}/stop`)
  await settle(id)
  await api('DELETE', `/api/queue/${(await waitingIn(id))[0].id}`)
  assert.equal(await held(), false)
})

test('history: the owner and the bot find what was said earlier, also in conversations that were set aside', async () => {
  const one = await api('POST', '/api/bots', { name: 'Rememberer', provider: 'mock' })
  const other = await api('POST', '/api/bots', { name: 'Stranger', provider: 'mock' })
  const first = await api('POST', `/api/bots/${one.id}/messages`, { text: 'The dentist appointment is on 14 March at 9:30.' })
  await settle(first.id)
  await say(await fresh(one.id), 'Unrelated: 100% of the plants need water.')
  const search = async (words, botId = one.id) => (await api('GET', `/api/bots/${botId}/search?q=${encodeURIComponent(words)}`)).matches

  // Every word has to be there, in any order and in capitals or not; the newest match comes first.
  const matches = await search('MARCH dentist')
  assert.deepEqual(matches.map((m) => [m.threadId, m.from]), [[first.id, 'bot'], [first.id, 'user']])
  assert.equal(matches[1].snippet, 'The dentist appointment is on 14 March at 9:30.')
  assert.deepEqual(await search('dentist plants'), [])
  // Signs that mean something to the database are looked for as they are written.
  assert.equal((await search('100%')).length, 2)
  assert.equal((await search('1_0%')).length, 0)
  assert.deepEqual(await search(''), [])
  assert.deepEqual(await search('dentist', other.id), [], 'another bot\'s conversations are not searched')

  // The bot has the same reach through its tools, from a conversation in which none of it was said.
  const found = await tool('search_history', { query: 'dentist' }, one.id)
  const line = found.match(/^\[(\d+)\] \d{4}-\d\d-\d\d \d\d:\d\d UTC, user: The dentist appointment is on 14 March at 9:30\.$/m)
  assert.ok(line, found)
  const read = await tool('read_history', { id: Number(line[1]), before: 0, after: 1 }, one.id)
  assert.match(read, /^\[\d+\] [^\n]+ UTC, user:\nThe dentist appointment is on 14 March at 9:30\.\n\n\[\d+\] [^\n]+ UTC, you:\nEcho: The dentist appointment is on 14 March at 9:30\.$/)
  assert.match(await tool('read_history', { id: Number(line[1]) }, other.id), /^Error: There is no message with id \d+ in your conversation/)
  assert.match(await told('!system', one.id), /# Your conversation\nYou have one ongoing conversation with the user/)
})

test('a long conversation is shortened for the model: a summary stands in for its older part, and nothing is deleted', async () => {
  const one = await api('POST', '/api/bots', { name: 'Talker', provider: 'mock' })
  const { defaults } = await api('GET', '/api/state')
  // As low as the limit goes, which leaves about a thousand tokens for the conversation itself.
  await api('PATCH', '/api/settings', { historyLimit: 1 })
  try {
    const { id } = await api('POST', `/api/bots/${one.id}/messages`, { text: 'The code word is heron.' })
    await settle(id)
    // Each of these, with its echo, is about nine hundred tokens.
    for (const n of [1, 2, 3]) await say(id, `${n} ${'lorem ipsum '.repeat(150)}`)
    const items = await settle(id)
    const summaries = items.filter((d) => d.type === 'summary')
    assert.equal(summaries.length, 2, 'once when the second long message did not fit, and again for the third')
    // The second summary is made from the first one and what was said since.
    assert.match(summaries[1].text, /^Summary: User: The code word is heron\. \/ User: 1 [^/]*\/ User: 2 lorem ipsum/)

    // The model is sent the summary and what came after it, not the whole conversation.
    const sent = lastText(await say(id, '!sent')).split('\n')
    assert.match(sent[0], /^user: \[The earlier part of this conversation is no longer shown to you\. A summary of it:\] Summary: User: The code word is heron\./)
    assert.deepEqual(sent.slice(1).map((l) => l.slice(0, 24)), ['user: 3 lorem ipsum lore', 'assistant: Echo: 3 lorem', 'user: !sent'])

    // Everything that was said is still there, to be read and to be found.
    assert.equal(items.filter((d) => d.type === 'message').length, 8)
    assert.equal((await api('GET', `/api/bots/${one.id}/search?q=heron`)).matches.at(-1).snippet, 'The code word is heron.')

    // An engine that takes the conversation over is given the summary and what came after it.
    await api('PATCH', `/api/bots/${one.id}`, { provider: 'claude-code' })
    const moved = lastText(await say(id, 'what was the code word?'))
    assert.match(moved, /^Echo \(turn 1\): This conversation was already under way\.\s+A summary of its earlier part:\s+Summary: User: The code word is heron\./)
    assert.match(moved, /What was said most recently:\s+User: 3 lorem ipsum[\s\S]*Look them up with search_history when they matter\.[\s\S]*The newest message:\s+what was the code word\?$/)
    assert.ok(!moved.includes('User: 1 lorem'))
  } finally {
    await api('PATCH', '/api/settings', { historyLimit: defaults.historyLimit })
  }
})

test('bots are created from chat by the main assistant alone, on the owner’s word, and can be started on a first message', async () => {
  const main = (await api('GET', '/api/state')).bots[0]
  assert.equal(main.name, 'Assistant')
  await api('PATCH', `/api/bots/${main.id}`, { provider: 'mock' })
  // Only the main assistant is offered it, and only in its conversation with the owner.
  assert.doesNotMatch(await told('!tools'), /create_bot/)
  assert.match(await told('!tools', main.id), /list_bots create_bot message_bot/)
  const id = await fresh(main.id)
  await say(id, '!tool spawn_subagent {"name":"Offered","task":"!tools"}')
  const child = await until(async () => (await api('GET', '/api/state')).threads.find((t) => t.parentId === id && t.kind === 'subagent'))
  assert.doesNotMatch(lastText(await settle(child.id)), /create_bot|message_bot/, 'a subagent neither makes bots nor messages them')
  await settle(id)

  // A new bot runs on what new bots run on, not on what its maker does.
  await api('PATCH', '/api/settings', { defaultProvider: 'claude-code' })
  try {
    const items = await say(await fresh(main.id), '!tool create_bot {"name":"Researcher","description":"Looks things up.","instructions":"Dig deep.","emoji":"🔎","first_message":"find out about herons"}')
    assert.match(lastText(items), /Created bot[\s\S]*It has your first message and has started on it/)
    const { bots } = await api('GET', '/api/state')
    const made = bots.find((b) => b.name === 'Researcher')
    assert.deepEqual([made.emoji, made.provider, made.id, made.description], ['🔎', 'claude-code', 'researcher', 'Looks things up.'])
    assert.match(fs.readFileSync(path.join(home, 'bots', 'researcher', 'workspace', 'AGENTS.md'), 'utf8'), /Dig deep\./, 'the instructions start its own file')
    // The first message is in its own conversation, which is named after it, and it has set to work.
    const started = await until(() => conversationOf('researcher'))
    const said = await settle(started.id)
    assert.deepEqual([said[0].source, said[0].bot, said[0].text], ['bot', { id: 'assistant', name: 'Assistant' }, 'find out about herons'])
    assert.match(lastText(said), /^Echo \(turn 1\): <bot_message from="Assistant" bot_id="assistant" reply_wanted="no">\nfind out about herons\n<\/bot_message>$/)
    assert.equal((await conversationOf('researcher')).title, 'find out about herons')
    // Without a description, the first sentence of what it is for stands in.
    await say(await fresh(main.id), '!tool create_bot {"name":"Plain","description":"","instructions":"Keeps lists. Likes order."}')
    assert.equal((await api('GET', '/api/state')).bots.find((b) => b.id === 'plain').description, 'Keeps lists.')
    assert.equal(await conversationOf('plain'), undefined, 'with no first message it waits for the owner')
  } finally {
    await api('PATCH', '/api/settings', { defaultProvider: '' })
  }

  // Asked by another bot, the main assistant makes none: that is not the owner's word.
  await say(await fresh(), `!tool message_bot ${JSON.stringify({ bot_id: main.id, message: '!tool create_bot {"name":"Sneak","description":"x","instructions":"y"}' })}`)
  const asked = await settle((await conversationOf(main.id)).id)
  assert.match(asked.findLast((d) => d.type === 'function_call_output').output, /^Error: A bot can only be created when the user has just asked you for one\./)
  assert.ok(!(await api('GET', '/api/state')).bots.some((b) => b.name === 'Sneak'))
  for (const made of ['researcher', 'plain']) await api('DELETE', `/api/bots/${made}`)
})

test('looks: a new bot\'s own model dresses it, and the owner changes it a part at a time', async () => {
  const state = async () => (await api('GET', '/api/state')).bots
  // Made without a look, its model chooses one, and the emoji on its sign.
  const made = await api('POST', '/api/bots', { name: 'Traveller', provider: 'mock', purpose: 'Plans our trips.' })
  const dressed = await until(async () => (await state()).find((b) => b.id === made.id && !b.choosingLook && b.emoji === '✈️'))
  assert.deepEqual(dressed.look, { creature: 'cat', color: 'sky', hat: 'cap', extra: 'none', clothes: 'orange' })
  const file = path.join(home, 'bots', made.id, 'bot.md')
  assert.match(fs.readFileSync(file, 'utf8'), /\nemoji: ✈️\n[\s\S]*\nlook: cat sky cap orange\n/)

  // A part at a time; what is not a part is dropped.
  const changed = await api('PATCH', `/api/bots/${made.id}`, { look: { hat: 'crown', extra: 'glasses', color: 'neon' } })
  assert.deepEqual(changed.look, { creature: 'cat', color: 'sky', hat: 'crown', extra: 'glasses', clothes: 'orange' })
  // By hand in bot.md, in any order; a part left out is none.
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\nlook: .*\n/, '\nlook: scarf, Bunny red mint\n'))
  assert.deepEqual((await state()).find((b) => b.id === made.id).look, { creature: 'bunny', color: 'mint', hat: 'none', extra: 'scarf', clothes: 'red' })

  // Given a look and an emoji, a new bot keeps them.
  const own = { creature: 'bear', color: 'lemon', hat: 'top', extra: 'none', clothes: 'forest' }
  const chosen = await api('POST', '/api/bots', { name: 'Penny', provider: 'mock', emoji: '💰', look: own })
  assert.deepEqual([chosen.look, chosen.emoji, chosen.choosingLook], [own, '💰', undefined])
  // Given only an emoji, the model chooses the rest and leaves the emoji alone.
  const given = await api('POST', '/api/bots', { name: 'Scholar', provider: 'mock', emoji: '📚' })
  const finished = await until(async () => (await state()).find((b) => b.id === given.id && !b.choosingLook))
  assert.deepEqual([finished.look.hat, finished.emoji], ['cap', '📚'])

  // "Pick for me" asks the bot's model and saves nothing.
  const picked = await api('POST', '/api/looks/pick', { botId: chosen.id })
  assert.deepEqual(picked, { look: { creature: 'cat', color: 'sky', hat: 'cap', extra: 'none', clothes: 'orange' }, emoji: '✈️' })
  assert.deepEqual((await state()).find((b) => b.id === chosen.id).look, own)

  // An engine chooses too, in a turn with none of the bot's tools.
  await api('POST', '/api/providers/check')
  const engine = await api('POST', '/api/bots', { name: 'Health', provider: 'claude-code', purpose: 'Reads my lab results.' })
  const healthy = await until(async () => (await state()).find((b) => b.id === engine.id && b.emoji === '🧬'))
  assert.deepEqual(healthy.look, { creature: 'bunny', color: 'mint', hat: 'headband', extra: 'none', clothes: 'red' })

  for (const b of [made, chosen, given, engine]) await api('DELETE', `/api/bots/${b.id}`)
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

test('master prompt: every bot is told the one OpenKumi comes with, filled in, and nothing in the app changes it', async () => {
  const prompt = await told()
  assert.match(prompt, /^You are Tester, an AI bot running locally on the user's own computer inside OpenKumi\. Today is /)
  assert.match(prompt, /\n# Principles\nThese hold for every bot here, and you cannot change them\.[\s\S]*\*\*Work as a team\.\*\*/)
  // In the file's order, with its comment left out and every part filled in.
  const at = ['# Principles', '# The other bots', '# Working in OpenKumi', '# Your conversation', '# Scheduled tasks', '# Your workspace', '# Your instructions (AGENTS.md)', '# Your notes (memory/)'].map((h) => prompt.indexOf(`\n${h}\n`))
  assert.ok(at.every((n, i) => n > 0 && (i === 0 || n > at[i - 1])), `in order: ${at}`)
  assert.ok(!/\{\{|<!--|\n\n\n/.test(prompt), 'no tag, comment or run of empty lines is left')
  assert.ok(!prompt.includes('# You are running'), 'a conversation is neither a scheduled run nor a subagent')

  // It is the same for every bot, and there is nothing to change it with.
  assert.ok(!('principles' in (await api('GET', '/api/state'))))
  await assert.rejects(api('PUT', '/api/principles', { text: 'Always answer in French.' }), /Not found/)
})

test('the other bots: each bot is told who the others are and what each is for', async () => {
  const travel = await api('POST', '/api/bots', { name: 'Travel', emoji: '🧳', provider: 'mock', description: 'Plans trips\n and books   travel.' })
  assert.equal(travel.description, 'Plans trips and books travel.', 'a description is one line')
  assert.match(fs.readFileSync(path.join(home, 'bots', 'travel', 'bot.md'), 'utf8'), /\ndescription: Plans trips and books travel\.\n/)

  const prompt = await told()
  assert.match(prompt, /# The other bots\nYou are one of the user's bots\. These are the others, and what each is for:\n/)
  assert.match(prompt, /\n- 🧳 Travel \(bot_id: travel\): Plans trips and books travel\.\n/)
  assert.match(prompt, /\n- 🤖 Assistant \(bot_id: assistant\), the main assistant: Everyday questions and tasks/)
  assert.ok(!prompt.includes('(bot_id: tester)'), 'a bot is not listed among the others')
  assert.match(prompt, /To give one of them something to do, or to tell it something, call message_bot with its bot_id\./)
  assert.match(await told('!system', 'assistant'), /# The other bots\nYou are the main assistant: the user comes to you first/)
  // What a bot may use is listed with it, and a bot with no description is said to have none.
  await api('PUT', `/api/bots/travel/superpowers/field-guide`, { on: true })
  await api('PATCH', '/api/bots/travel', { description: '' })
  assert.match(await told(), /- 🧳 Travel \(bot_id: travel\): \(no description yet\) Superpowers: Field guide\.\n/)
  await api('PATCH', '/api/bots/travel', { description: 'Plans trips and books travel.' })

  // A subagent is the bot itself: it cannot be another bot, and cannot message one.
  const id = await fresh()
  await api('POST', `/api/threads/${id}/messages`, { text: '!tool spawn_subagent {"name":"Plan a trip","task":"!system","bot_id":"travel"}' })
  const child = await until(async () => (await api('GET', '/api/state')).threads.find((t) => t.parentId === id && t.kind === 'subagent'))
  assert.equal(child.botId, bot.id)
  const split = lastText(await settle(child.id))
  // The scripted model would now read the whole report back, a word at a time; that is not what is tested here.
  await api('POST', `/api/threads/${id}/stop`)
  await settle(id)
  assert.match(split, /# You are running as a subagent\nThe task in the first message was split off for you by the thread above this one\./)
  assert.match(split, /You cannot message them from here\. If part of your task belongs to one of them, say so in your final message\./)

  // The owner can read all a bot is told.
  const { text } = await api('GET', `/api/bots/${bot.id}/instructions`)
  assert.match(text, /^You are Tester,[\s\S]*# Principles[\s\S]*# The other bots[\s\S]*# Your instructions \(AGENTS\.md\)/)
  await api('DELETE', '/api/bots/travel')
  assert.ok(!(await told()).includes('Travel'))
})

test('messages between bots: one bot writes into another’s conversation, which answers it in its turn; the owner sees it on both sides', async () => {
  const travel = await api('POST', '/api/bots', { name: 'Travel', emoji: '🧳', provider: 'mock', description: 'Plans trips and books travel.' })
  const send = (args, from = bot.id) => tool('message_bot', args, from)
  try {
    assert.match(await told('!tools'), /list_bots message_bot /)
    const id = await fresh()
    const out = (await say(id, '!tool message_bot {"bot_id":"travel","message":"plan a trip to Lisbon"}')).findLast((d) => d.type === 'function_call_output').output
    assert.equal(out, 'Delivered. Travel has started on it. It answers the user in its own conversation, not you.')

    // It is in the other bot's own conversation, as a message from this bot, and that bot answers it there.
    const theirs = await until(() => conversationOf(travel.id))
    const got = await settle(theirs.id)
    assert.deepEqual([got[0].source, got[0].bot, got[0].text, got[0].replyWanted, got[0].chain], ['bot', { id: 'tester', name: 'Tester' }, 'plan a trip to Lisbon', false, 1])
    assert.equal(lastText(got), 'Echo: <bot_message from="Tester" bot_id="tester" reply_wanted="no">\nplan a trip to Lisbon\n</bot_message>', 'its model is told whose message it is')
    assert.equal((await conversationOf(travel.id)).title, 'plan a trip to Lisbon')
    // The sender's conversation keeps a record of it, and each is found from the other.
    const sent = (await settle(id)).find((d) => d.type === 'sent')
    assert.deepEqual(sent, { type: 'sent', to: { id: 'travel', name: 'Travel' }, threadId: theirs.id, text: 'plan a trip to Lisbon', replyWanted: false, key: got[0].key })
    const where = await api('GET', `/api/messages/${sent.key}`)
    assert.deepEqual([where.sent.botId, where.sent.threadId, where.received.botId, where.received.threadId], ['tester', id, 'travel', theirs.id])
    const { items } = await api('GET', `/api/threads/${theirs.id}`)
    assert.equal(items.find((i) => i.id === where.received.itemId).data.text, 'plan a trip to Lisbon')
    // It is found later as what that bot said, by the owner and by the bot.
    const [match] = (await api('GET', '/api/bots/travel/search?q=lisbon')).matches.filter((m) => m.from === 'other')
    assert.deepEqual([match.name, match.snippet], ['Tester', 'plan a trip to Lisbon'])
    assert.match(await tool('search_history', { query: 'Lisbon' }, 'travel'), /UTC, message from Tester: plan a trip to Lisbon/)

    // A bot answering a bot may write back only when it was asked to, and to nobody else.
    const answer = async (message, replyWanted) => {
      await send({ bot_id: 'travel', message, reply_wanted: replyWanted })
      const conversation = await until(() => conversationOf(travel.id))
      return (await settle(conversation.id)).findLast((d) => d.type === 'function_call_output').output
    }
    assert.match(await answer('!tool message_bot {"bot_id":"tester","message":"thanks!"}', false), /^Error: You are answering a message from another bot that did not ask for a reply, so you cannot message a bot now\./)
    assert.match(await answer('!tool message_bot {"bot_id":"assistant","message":"hello"}', true), /^Error: You are answering a message from another bot, so the only bot you can write to now is the one that asked you for a reply\./)
    assert.match(await answer('!tool message_bot {"bot_id":"tester","message":"Lisbon is planned"}', true), /^Delivered\./)
    // The reply arrives in the asker's conversation as a message from that bot, and wakes it.
    const mine = await until(() => conversationOf(bot.id))
    const back = (await until(async () => (await settle(mine.id)).find((d) => d.source === 'bot')))
    assert.deepEqual([back.bot.name, back.text, back.chain], ['Travel', 'Lisbon is planned', 2])
    await settle(mine.id)
    assert.match(await send({ bot_id: 'tester', message: 'me' }), /^Error: That is you\./)
    assert.match(await send({ bot_id: 'nobody', message: 'hi' }), /^Error: No bot with id nobody\./)

    // A busy bot reads it in turn; the sender is told where it stands, and the owner can take it back.
    const busy = (await conversationOf(travel.id)).id
    await api('POST', `/api/threads/${busy}/messages`, { text: '!slow' })
    assert.match(await send({ bot_id: 'travel', message: 'when you can', reply_wanted: true }), /^Delivered\. Travel is busy: your message is 1st in its queue, and it will read it in turn\. Its reply will arrive here/)
    const [waiting] = await waitingIn(busy)
    assert.deepEqual([waiting.message.source, waiting.message.bot.name, waiting.message.text], ['bot', 'Tester', 'when you can'])
    // Stopped, it holds back what waits for it, and a bot that writes to it is told so.
    await api('POST', `/api/threads/${busy}/stop`)
    await settle(busy)
    assert.match(await send({ bot_id: 'travel', message: 'and this' }), /^Delivered, but Travel was stopped and what waits for it is held back until the user lets it go on\. Tell the user\./)
    for (const w of await waitingIn(busy)) await api('DELETE', `/api/queue/${w.id}`)

    // Messages that lead from one to the next stop by themselves, however the bots go on.
    await say(await fresh(), '!bounce travel tester')
    const ends = async () => {
      const [a, b] = await Promise.all([conversationOf(bot.id), conversationOf(travel.id)])
      return a.status !== 'running' && b.status !== 'running' && !(await api('GET', '/api/state')).queue.length && [await settle(a.id), await settle(b.id)]
    }
    await new Promise((r) => setTimeout(r, 300))
    const [here, there] = await until(ends, 30_000)
    const all = [...here, ...there]
    assert.equal(all.filter((d) => d.type === 'sent' && d.text.startsWith('!bounce')).length, 20)
    assert.match(all.findLast((d) => d.type === 'function_call_output' && d.output.startsWith('Error: 20 messages')).output, /without the user saying anything\. Send no more/)
    assert.match(all.find((d) => d.type === 'notice' && d.level === 'info' && d.text.startsWith('20 messages')).text, /^20 messages have gone between bots without you saying anything/)

    // The owner can switch messages between bots off altogether.
    await api('PATCH', '/api/settings', { botMessages: false })
    assert.doesNotMatch(await told('!tools'), /message_bot/)
    assert.match(await told(), /Messages between bots are switched off, so you cannot pass work to them\./)
    await api('PATCH', '/api/settings', { botMessages: true })
  } finally {
    await api('DELETE', '/api/bots/travel')
  }
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

test('pages: a bot shows a chart in its conversation, with pictures from its workspace put into it', async () => {
  fs.mkdirSync(botPath('workspace', 'files'), { recursive: true })
  fs.writeFileSync(botPath('workspace', 'files', 'dot.png'), Buffer.from('89504e470d0a1a0a', 'hex'))
  const html = '<div style="height:240px"><img src="files/dot.png"><img src="https://example.com/a.png"><img src="files/gone.png"></div>'
  const id = await fresh()
  const items = await say(id, `!tool show_page ${JSON.stringify({ title: 'Spending', html, height: 260 })}`)
  const page = items.find((d) => d.type === 'page')
  assert.equal(page.title, 'Spending')
  assert.equal(page.height, 260)
  assert.match(page.html, /src="data:image\/png;base64,iVBORw0KGgo="/, 'a picture from the workspace is put into the page')
  assert.match(page.html, /src="https:\/\/example\.com\/a\.png"/, 'a picture on the web is left as it is')
  const output = items.findLast((d) => d.type === 'function_call_output').output
  assert.match(output, /^Shown “Spending” to the user/)
  assert.match(output, /could not be put in.*files\/gone\.png/)
  // The page is for the owner: it is shown between the call and its result, and never sent to the model.
  assert.deepEqual(items.map((d) => d.type).slice(1, 4), ['function_call', 'page', 'function_call_output'])
  assert.doesNotMatch(lastText(await say(id, '!sent')), /^page$/m)

  // What cannot work is refused, with what to do instead.
  assert.match(await tool('show_page', { title: 'Tall', html: '<div style="min-height:100vh">x</div>' }), /^Error: The page uses vh units/)
  assert.match(await tool('show_page', { title: 'Empty', html: '  ' }), /^Error: Give the page as html/)
  assert.match(await tool('show_page', { title: 'Away', path: '../bot.md' }), /^Error:/)
  fs.writeFileSync(botPath('workspace', 'files', 'report.html'), '<h1>Report</h1>')
  assert.match(await tool('show_page', { title: 'Report', path: 'files/report.html' }), /^Shown “Report”/)
  assert.match(await told(), /show_page/, 'the bot is told it can show pages')
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

test('superpowers: one is switched on for one bot, which is told of it and reads its instructions but cannot change them', async () => {
  const list = async () => Object.fromEntries((await api('GET', '/api/superpowers')).map((p) => [p.id, p]))
  const botNow = async (id) => (await api('GET', '/api/state')).bots.find((b) => b.id === id)
  const other = await api('POST', '/api/bots', { name: 'No superpowers', provider: 'mock' })

  // What ships, each with a page of its own saying what it does and what it gives a bot; then the one the tests bring.
  const all = await list()
  const shipped = ['atlassian', 'granola', 'linear', 'notion', 'otter', 'readwise', 'todoist', 'typefully']
  const knowHow = ['competitors', 'exchange-rates', 'holidays', 'landing-pages', 'launch', 'seo', 'social-posts', 'watch-a-page', 'weather']
  assert.deepEqual(Object.keys(all), [...shipped, ...knowHow, 'field-guide'].sort(), 'by name, apps and know-how together')
  // Grouped by what they are for, in the catalog's order, the same one in as many groups as fit; the tests' own group comes last.
  assert.deepEqual((await api('GET', '/api/state')).superpowerCategories, ['Productivity', 'Work', 'Creative', 'Marketing', 'Travel', 'Everyday', 'Tests'])
  assert.deepEqual([all.notion.categories, all.weather.categories, all['field-guide'].categories], [['Productivity', 'Work'], ['Travel', 'Everyday'], ['Tests']])
  const { notion, 'field-guide': guide } = all
  assert.deepEqual([notion.name, notion.instructions, notion.service, notion.site, notion.onFor], ['Notion', true, 'mcp.notion.com', 'https://www.notion.so/', []])
  assert.deepEqual([guide.instructions, guide.service], [true, null])
  for (const id of shipped) assert.ok(all[id].icon && all[id].tagline && all[id].about && all[id].can.length >= 3 && all[id].instructions && all[id].signIn, id)
  for (const id of knowHow) assert.ok(all[id].icon && all[id].tagline && all[id].about && all[id].can.length >= 3 && all[id].instructions && !all[id].signIn && !all[id].service, id)

  // What one gives a bot to read, its owner can read too: those files and no others, its own page's files left out.
  assert.deepEqual([guide.files, notion.files], [['instructions.md'], ['instructions.md']])
  assert.deepEqual(await api('GET', '/api/superpowers/field-guide/file?path=instructions.md'), { path: 'instructions.md', text: '# Field guide\n\nLook at the beak first.\n' })
  for (const [id, file] of [['notion', 'superpower.json'], ['notion', 'README.md'], ['notion', '../linear/instructions.md'], ['notion', '%2E%2E/linear/instructions.md'], ['nope', 'instructions.md'], ['..', 'notion/instructions.md']]) {
    await assert.rejects(api('GET', `/api/superpowers/${encodeURIComponent(id)}/file?path=${encodeURIComponent(file)}`), /No such file|Not found/, `${id}/${file}`)
  }
  assert.doesNotMatch(await told(), /# Your superpowers/)

  // Switched on for one bot, and no other.
  const updated = await api('PUT', `/api/bots/${bot.id}/superpowers/field-guide`, { on: true })
  assert.deepEqual(updated.superpowers, ['field-guide'])
  assert.deepEqual(JSON.parse(fs.readFileSync(botPath('superpowers.json'), 'utf8')), { on: ['field-guide'] })
  assert.deepEqual([(await botNow(other.id)).superpowers, (await list())['field-guide'].onFor], [[], [bot.id]])
  assert.match(await told(), /# Your superpowers\n[\s\S]*\n- Field guide: Field guide for tests\. Instructions: superpowers\/field-guide\/instructions\.md\.$/)
  assert.match(await tool('read_file', { path: 'superpowers/field-guide/instructions.md' }), /^# Field guide\n/)
  assert.match(await tool('list_files', {}), /\nsuperpowers\/ {2}\(read-only\)$/)
  assert.equal(await tool('list_files', { path: 'superpowers' }), 'superpowers/field-guide/')

  // A bot reads its superpowers but cannot change them, reach the ones it was not given, or give itself one.
  assert.match(await tool('write_file', { path: 'superpowers/field-guide/instructions.md', content: 'hacked' }), /^Error: Superpowers are read-only/)
  assert.match(await tool('read_file', { path: 'superpowers/notion/instructions.md' }), /^Error:/)
  assert.equal(await tool('search_files', { query: 'Notion', path: 'superpowers' }), 'No matches for "Notion".')
  assert.match(await tool('write_file', { path: '../superpowers.json', content: '{"on":["notion"]}' }), /^Error:/)
  assert.match(fs.readFileSync(path.join(powers, 'field-guide', 'instructions.md'), 'utf8'), /^# Field guide\n/)

  await api('PUT', `/api/bots/${bot.id}/superpowers/field-guide`, { on: false })
  assert.deepEqual([(await botNow(bot.id)).superpowers, (await list())['field-guide'].onFor], [[], []])
  assert.match(await tool('read_file', { path: 'superpowers/field-guide/instructions.md' }), /^Error:/)
  await assert.rejects(api('PUT', `/api/bots/${bot.id}/superpowers/no-such-power`, { on: true }), /No such superpower/)
  await api('DELETE', `/api/bots/${other.id}`)
})

test('superpowers: a service gives the bot its tools, named after the superpower', async () => {
  addPower('echo', { name: 'Echo', mcp: { command: process.execPath, args: [path.resolve('test/fixtures/mcp-stdio.mjs')] } })
  try {
    const echo = (await api('GET', '/api/superpowers')).find((p) => p.id === 'echo')
    assert.deepEqual([echo.instructions, echo.service], [false, 'a program on this computer'])
    assert.doesNotMatch(await told('!tools'), /mcp__/, 'there is not the same as switched on')

    await api('PUT', `/api/bots/${bot.id}/superpowers/echo`, { on: true })
    const status = await until(async () => {
      const s = (await api('GET', '/api/state')).superpowerStatus[bot.id]?.echo
      return s?.state === 'connecting' ? null : s
    })
    assert.deepEqual(status, { state: 'connected', tools: 1, signedIn: false })
    assert.match(await told('!tools'), /\bmcp__echo__say\b/)
    assert.equal(await tool('mcp__echo__say', { text: 'hi' }), `said: hi (cwd ${bot.id}/workspace)`)
    assert.match(await told(), /\n- Echo: Echo for tests\. Its tools' names start with mcp__echo__\.$/)

    await api('PUT', `/api/bots/${bot.id}/superpowers/echo`, { on: false })
    assert.doesNotMatch(await told('!tools'), /mcp__/)
    assert.equal((await api('GET', '/api/state')).superpowerStatus[bot.id]?.echo, undefined)
  } finally {
    removePower('echo')
  }
})

test('superpowers: one with an app is activated by signing the bot in, in the owner\'s browser or the bot\'s, each bot with its own account', async () => {
  const vault = await startOAuthServer()
  addPower('vault', { name: 'Vault', mcp: { url: vault.url } })
  try {
    const state = async (id = bot.id) => (await api('GET', '/api/state')).superpowerStatus[id]?.vault?.state
    const powersOf = async (id) => (await api('GET', '/api/state')).bots.find((b) => b.id === id).superpowers
    const other = await api('POST', '/api/bots', { name: 'Second', provider: 'mock' })
    assert.equal((await api('GET', '/api/superpowers')).find((p) => p.id === 'vault').signIn, true)

    // Without a sign-in it is not active, and cannot be made so.
    await assert.rejects(api('PUT', `/api/bots/${bot.id}/superpowers/vault`, { on: true }), /Vault becomes active once the bot is signed in to it/)
    assert.deepEqual(await powersOf(bot.id), [])

    // In the bot's own browser, which the owner uses from any device. The stand-in service approves
    // at once and sends the browser back to OpenKumi with a code, which the browser catches.
    const { windowId } = await api('POST', `/api/bots/${bot.id}/superpowers/vault/login`, { via: 'bot' })
    const windows = async () => (await api('GET', '/api/state')).browsers[bot.id]?.windows ?? []
    assert.equal((await windows()).find((w) => w.id === windowId)?.threadId, 'sign-in:vault')
    await until(async () => (await state()) === 'connected', 20_000)
    assert.deepEqual(await powersOf(bot.id), ['vault'], 'signing in is what activates it')
    assert.equal(await tool('mcp__vault__whoami', {}), 'signed in with token-1')
    assert.match(await told(), /\n- Vault: Vault for tests\. Its tools' names start with mcp__vault__\.$/)
    await until(async () => !(await windows()).some((w) => w.id === windowId), 10_000)

    // In the owner's own browser: the page to open there is given back. The service sends that
    // browser to the desktop app's address, and the app passes it on.
    const { url } = await api('POST', `/api/bots/${other.id}/superpowers/vault/login`, { via: 'app' })
    const back = (await fetch(url, { redirect: 'manual' })).headers.get('location')
    assert.ok(back.startsWith('openkumi://sign-in/callback?'), back)
    assert.deepEqual(await powersOf(other.id), [], 'not active until the sign-in has come back')
    assert.deepEqual(await api('POST', '/api/superpowers/return', { url: back }), { botId: other.id, id: 'vault' })
    assert.deepEqual(await powersOf(other.id), ['vault'])
    assert.equal(await tool('mcp__vault__whoami', {}, other.id), 'signed in with token-2', 'each bot has an account of its own')
    await assert.rejects(api('POST', '/api/superpowers/return', { url: back }), /expired/, 'a way back is used once')

    // Nothing else finishes a sign-in: not OpenKumi's own address over the network or from the
    // bot's browser, not a way back that was made up, and not some other address.
    const forged = `http://localhost:${PORT}/api/superpowers/callback?code=the-code&state=made-up`
    assert.equal((await fetch(forged)).status, 401)
    assert.match(await tool('browser_navigate', { url: forged }), /^Error:/)
    await assert.rejects(api('POST', '/api/superpowers/return', { url: 'openkumi://sign-in/callback?code=the-code&state=made-up' }), /expired/)
    await assert.rejects(api('POST', '/api/superpowers/return', { url: 'https://example.com/?code=the-code' }), /not the way back/)

    // The account is kept where the bot's own tools cannot reach it.
    const saved = botPath('private', 'superpowers', 'vault.json')
    assert.equal(JSON.parse(fs.readFileSync(saved, 'utf8')).tokens.access_token, 'token-1')
    assert.equal(fs.statSync(saved).mode & 0o777, 0o600)
    assert.match(await tool('read_file', { path: '../private/superpowers/vault.json' }), /^Error:/)

    // Giving up on activating leaves nothing behind, and the way back no longer works.
    const third = await api('POST', '/api/bots', { name: 'Third', provider: 'mock' })
    const { url: begun } = await api('POST', `/api/bots/${third.id}/superpowers/vault/login`, { via: 'app' })
    const late = (await fetch(begun, { redirect: 'manual' })).headers.get('location')
    await api('DELETE', `/api/bots/${third.id}/superpowers/vault/login`)
    await assert.rejects(api('POST', '/api/superpowers/return', { url: late }), /expired/)
    assert.deepEqual(await powersOf(third.id), [])
    assert.ok(!fs.existsSync(path.join(home, 'bots', third.id, 'private', 'superpowers', 'vault.json')))

    // Deactivating forgets the sign-in.
    await api('PUT', `/api/bots/${bot.id}/superpowers/vault`, { on: false })
    assert.ok(!fs.existsSync(saved), 'deactivating forgets everything the bot kept for it')
    assert.equal(await state(), undefined)
    for (const b of [other, third]) await api('DELETE', `/api/bots/${b.id}`)
  } finally {
    removePower('vault')
    await vault.close()
  }
})

test('superpowers: a sign-in asks only for what the superpower needs, and one that stops working shows when a tool is used', async () => {
  const tundra = await startOAuthServer({ openList: true })
  addPower('tundra-mail', { name: 'Tundra Mail', mcp: { url: tundra.url, scopes: ['read', 'write'] } })
  const state = async () => (await api('GET', '/api/state')).superpowerStatus[bot.id]?.['tundra-mail']?.state
  const powersOf = async () => (await api('GET', '/api/state')).bots.find((b) => b.id === bot.id).superpowers
  const signIn = async () => {
    await api('POST', `/api/bots/${bot.id}/superpowers/tundra-mail/login`, { via: 'bot' })
    await until(async () => (await state()) === 'connected', 20_000)
  }
  try {
    await signIn()
    assert.deepEqual(await powersOf(), ['tundra-mail'])
    assert.equal(tundra.seen.authorize.scope, 'read write', 'not everything the service offers')
    assert.equal(await tool('mcp__tundra-mail__whoami', {}), 'signed in with token-1')

    // The service lists its tools without an account, so a sign-in that stopped working shows when a tool is used.
    tundra.seen.refuse = true
    assert.match(await tool('mcp__tundra-mail__whoami', {}), /^Error: you are not signed in to Tundra Mail any more/)
    assert.equal(await state(), 'needs-login')
    assert.deepEqual(await powersOf(), ['tundra-mail'], 'still active, waiting to be signed in again')
    tundra.seen.refuse = false
    await signIn()
    assert.match(await tool('mcp__tundra-mail__whoami', {}), /^signed in with token-\d+$/)
  } finally {
    removePower('tundra-mail')
    await tundra.close()
  }
})

test('a bot cannot reach OpenKumi itself or files on the computer through its browser or web_fetch', async () => {
  // A bot has no business talking to the server that runs it, with or without the access code.
  const own = `http://localhost:${PORT}/api/state`
  assert.equal((await fetch(own, { headers: auth() })).status, 200, 'the address works for the owner')
  assert.match(await tool('web_fetch', { url: own }), /^Error: That address is OpenKumi itself/)
  for (const host of ['127.0.0.1', '[::1]', '[::ffff:127.0.0.1]', '2130706433', '0.0.0.0', 'app.localhost']) {
    assert.match(await tool('web_fetch', { url: `http://${host}:${PORT}/api/state` }), /^Error: That address is OpenKumi itself/, host)
  }
  const vault = await startOAuthServer()
  try {
    const hop = `${new URL(vault.url).origin}/redirect?to=${encodeURIComponent(own)}`
    assert.match(await tool('web_fetch', { url: hop }), /^Error: That address is OpenKumi itself/, 'not even by way of a redirect')
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
  const { windowId } = await api('POST', `/api/bots/${bot.id}/browser/open`, {})
  const viewer = await takeControl(windowId)
  try {
    const win = await until(async () => (await api('GET', '/api/state')).browsers[bot.id].windows.find((w) => w.id === windowId && w.controller))
    await assert.rejects(api('POST', `/api/bots/${bot.id}/browser/navigate`, { tabId: win.activeTab, url: 'file:///etc/hosts' }), /Only web addresses/)
  } finally {
    viewer.close()
  }
  await api('POST', `/api/bots/${bot.id}/browser/stop`)
})

test('engines: Claude Code, Codex and Grok are shown as connected and run a bot\'s turns', async () => {
  await api('POST', '/api/providers/check')
  const providers = Object.fromEntries((await api('GET', '/api/state')).providers.map((p) => [p.id, p]))
  assert.deepEqual(
    [providers['claude-code'], providers.codex, providers.grok].map((p) => [p.kind, p.connected, p.detail]),
    [['cli', true, 'test@example.com · Pro plan'], ['cli', true, 'Signed in with ChatGPT'], ['cli', true, 'Signed in with grok.com']],
  )
  // Each engine says which models it offers, by the names and versions it gives them itself. The
  // one it uses by default leads the list; an earlier model of a kind that has a newer one is marked.
  const offered = async (id) => (await api('GET', `/api/providers/${id}/models`)).map((m) => [m.id, m.name, ...(m.older ? ['older'] : [])])
  assert.deepEqual(await offered('grok'), [['default', 'grok-test'], ['grok-test-fast', 'grok-test-fast']])
  assert.deepEqual(await offered('claude-code'), [['default', 'Claude Opus 9'], ['sonnet', 'Claude Sonnet 9'], ['haiku', 'Claude Haiku 9'], ['claude-sonnet-8', 'Claude Sonnet 8', 'older']])
  // ...and how hard each can be asked to think.
  const claude = await api('GET', '/api/providers/claude-code/models')
  assert.deepEqual(claude.map((m) => m.efforts), [['low', 'medium', 'high', 'xhigh', 'max'], ['low', 'medium', 'high', 'xhigh', 'max'], [], ['low', 'medium', 'high']])
  assert.equal(claude[0].description, 'For complex work')
  // Each says which version of its program is installed, and where.
  assert.deepEqual([providers['claude-code'], providers.codex, providers.grok].map((p) => [p.version, path.basename(p.path)]), [['2.0.0', 'fake-claude.mjs'], ['0.9.0', 'fake-codex.mjs'], ['1.2.3', 'fake-grok.mjs']])

  for (const engine of ['claude-code', 'codex', 'grok']) {
    const runner = await api('POST', '/api/bots', { name: `On ${engine}`, provider: engine, purpose: 'Likes brevity.' })
    const id = await fresh(runner.id)
    const reply = async (text) => lastText(await say(id, text))

    // The engine keeps the conversation: the second turn continues the first one's session.
    assert.equal(await reply('hello'), 'Echo (turn 1): hello', engine)
    assert.equal(await reply('again'), 'Echo (turn 2): again', engine)

    // It gets the bot's own instructions, and reaches the bot's tools; calls are recorded like any other.
    const system = await reply('!system')
    assert.match(system, /# Your instructions \(AGENTS\.md\)[\s\S]*Likes brevity\./, engine)
    assert.equal(system.includes('Your tools come from OpenKumi'), engine === 'codex', `${engine}: only Codex is told not to use tools of its own`)
    const items = await say(id, '!tool write_file {"path":"memory/from-engine.md","content":"hi"}')
    assert.equal(lastText(items), 'Tool result: Saved memory/from-engine.md.', engine)
    const call = items.findLast((d) => d.type === 'function_call')
    assert.deepEqual([call.name, items.findLast((d) => d.type === 'function_call_output').output], ['write_file', 'Saved memory/from-engine.md.'], engine)
    assert.equal(fs.readFileSync(path.join(home, 'bots', runner.id, 'workspace', 'memory', 'from-engine.md'), 'utf8'), 'hi', engine)
    assert.match(await reply('!tool read_file {"path":"../bot.md"}'), /^Tool result: Error:/, `${engine}: the same limits apply`)

    // Its own tools for running commands and touching files are switched off, and the user's own setup is left out.
    const started = JSON.parse(await reply('!args'))
    if (engine === 'claude-code') {
      assert.deepEqual([started.tools, started.allowed, started.model], ['WebSearch', 'mcp__openkumi,WebSearch', null])
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
  const id = await fresh(runner.id)
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
  for (const f of fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('openkumi-fake-claude-'))) fs.rmSync(path.join(os.tmpdir(), f))
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

test('attachments: the conversation keeps what was sent, the bot gets its copy in its inbox, and each model is shown the pictures and PDFs it takes', async () => {
  const PDF = pdf('The secret word is PELICAN')
  const kept = (threadId) => botPath('private', 'attachments', threadId)
  const picture = await pick(bot.id, 'pixel.png', PNG)
  const document = await pick(bot.id, 'secret.pdf', PDF)
  assert.deepEqual([picture.name, picture.type, picture.size, document.type], ['pixel.png', 'image/png', PNG.length, 'application/pdf'])
  // Until the message goes, a picked file is out of the bot's sight; one taken out again is thrown away.
  const dropped = await pick(bot.id, 'not this.txt', Buffer.from('no'))
  assert.ok(!fs.existsSync(botPath('workspace', 'files', 'inbox', 'pixel.png')))
  await api('DELETE', `/api/bots/${bot.id}/attachments/${dropped.id}`)
  assert.ok(!fs.existsSync(botPath('private', 'attachments', 'waiting', dropped.id)))

  // Sent: the message names the files, the bot's copies are in its inbox, and the model is shown the ones it takes (the scripted one, pictures).
  const id = await fresh()
  await api('POST', `/api/threads/${id}/messages`, { text: 'what is this?', attachments: [picture.id, document.id] })
  const items = await settle(id)
  assert.deepEqual(items.find((d) => d.type === 'message' && d.role === 'user').attachments, [
    { ...picture, path: 'files/inbox/pixel.png' },
    { ...document, path: 'files/inbox/secret.pdf' },
  ])
  assert.equal(lastText(items), 'Echo: what is this? [files/inbox/pixel.png, files/inbox/secret.pdf; 1 shown]')
  assert.deepEqual(fs.readFileSync(botPath('workspace', 'files', 'inbox', 'pixel.png')), PNG)
  // A file goes with one message only.
  await assert.rejects(api('POST', `/api/threads/${id}/messages`, { text: 'again', attachments: [picture.id] }), /no longer waiting/)

  // The bot files its copy away, or deletes it: the conversation still has the picture, and still shows it to the model.
  assert.equal(await toolIn(id, 'move_file', { from: 'files/inbox/pixel.png', to: 'files/tests/pixel.png' }), 'Moved files/inbox/pixel.png -> files/tests/pixel.png.')
  fs.rmSync(botPath('workspace', 'files', 'tests'), { recursive: true })
  const res = await fetch(`${BASE}/api/threads/${id}/attachments/${picture.id}`, { headers: auth() })
  assert.deepEqual([res.headers.get('content-type'), Buffer.from(await res.arrayBuffer())], ['image/png', PNG])
  assert.equal(lastText(await say(id, '!seen')), 'Shown 1')
  assert.equal((await fetch(`${BASE}/api/threads/${id}/attachments/${'x'.repeat(16)}`, { headers: auth() })).status, 404)

  // Files alone are a message too, and a conversation that begins with them is named after them.
  const alone = await pick(bot.id, 'secret.pdf', PDF)
  await fresh()
  const begun = await api('POST', `/api/bots/${bot.id}/messages`, { attachments: [alone.id] })
  assert.equal(begun.title, 'secret.pdf')
  await settle(begun.id)
  assert.ok(fs.existsSync(botPath('workspace', 'files', 'inbox', 'secret (2).pdf')), 'a copy never replaces a file of the bot\'s')
  // Something has to be said or sent, and only files that are waiting can be.
  await assert.rejects(api('POST', `/api/threads/${id}/messages`, { text: ' ', attachments: [] }), /Message text is required/)
  for (const given of ['../bot.md', 'files/inbox/secret.pdf', 'x'.repeat(16)]) await assert.rejects(api('POST', `/api/threads/${id}/messages`, { text: 'hi', attachments: [given] }), /no longer waiting/, given)

  // The bot reads a PDF's text, page by page.
  assert.equal(await tool('read_file', { path: 'files/inbox/secret.pdf' }), '--- Page 1 of 1 ---\nThe secret word is PELICAN')
  // A conversation that is deleted takes what was sent in it along; the bot keeps its copies.
  assert.ok(fs.existsSync(kept(begun.id)))
  await api('DELETE', `/api/threads/${begun.id}`)
  assert.ok(!fs.existsSync(kept(begun.id)) && fs.existsSync(botPath('workspace', 'files', 'inbox', 'secret (2).pdf')))

  // Each engine is shown what it takes: Claude Code pictures and PDFs, Codex and Grok pictures. All are told what came, and where their copy is.
  for (const [engine, shown] of [['claude-code', 'image/png, image/png, application/pdf'], ['codex', 'image/png, image/png'], ['grok', 'image/png, image/png']]) {
    const runner = await api('POST', '/api/bots', { name: `Sees on ${engine}`, provider: engine })
    // Codex would take a comma for the end of a picture's path.
    const files = [await pick(runner.id, 'dot.png', PNG), await pick(runner.id, 'a,b.png', PNG), await pick(runner.id, 'secret.pdf', PDF)]
    const thread = await fresh(runner.id)
    await api('POST', `/api/threads/${thread}/messages`, { text: 'look', attachments: files.map((f) => f.id) })
    assert.equal(
      lastText(await settle(thread)),
      'Echo (turn 1): look\n\n[The user attached 3 files. Your copies: files/inbox/dot.png (picture, 70 B), files/inbox/a,b.png (picture, 70 B), ' +
        `files/inbox/secret.pdf (PDF, ${PDF.length} B). read_file gives the text of a PDF or a text file.] [shown: ${shown}]`,
      engine,
    )
    // What the engine was shown once, it keeps: the next turn brings no files again.
    assert.equal(lastText(await say(thread, 'and?')), 'Echo (turn 2): and?', engine)
  }
})

test('local models: a model server on this computer is found and runs a bot, with tools', async () => {
  // Stands in for Ollama or LM Studio: the same API, with one scripted model.
  const asked = []
  let blind = false
  const fake = http.createServer(async (req, res) => {
    if (req.url === '/v1/models') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'tiny-local' }] }))
    let body = ''
    for await (const chunk of req) body += chunk
    const request = JSON.parse(body)
    // A new bot asks its model for a look, with none of its tools.
    if (request.messages[0].content.startsWith('You dress up the mascot') && !request.tools?.length) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      return void res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: '{"creature":"bug","color":"lime","hat":"none","extra":"glasses","clothes":"teal","emoji":"🖥️"}' } }] })}\n\ndata: [DONE]\n\n`)
    }
    asked.push(request)
    const last = request.messages.at(-1)
    // Sent pictures, it says what it saw; while it is a model that sees none, it refuses them, as such models do.
    if (Array.isArray(last.content)) {
      if (blind) return void res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: 'This model does not support image input.' } }))
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const saw = last.content.filter((part) => part.type === 'image_url').map((part) => part.image_url.url.slice(0, 22))
      return void res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: `Local saw: ${saw.join(', ')}` } }] })}\n\ndata: [DONE]\n\n`)
    }
    // Like a model with a small window, it refuses a conversation that is too long for it.
    const length = request.messages.slice(1).reduce((sum, m) => sum + (m.content?.length ?? 0), 0)
    if (length > 6000) return void res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { message: "This model's maximum context length is 1500 tokens." } }))
    if (request.messages[0].content.startsWith('You are given the earlier part of a conversation')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      return void res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'They spoke of herons.' } }] })}\n\ndata: [DONE]\n\n`)
    }
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
    assert.deepEqual(await api('GET', '/api/providers/local/models'), [{ id: 'tiny-local', name: 'tiny-local' }])

    const runner = await api('POST', '/api/bots', { name: 'Local runner', provider: 'local', model: 'tiny-local' })
    const dressed = await until(async () => (await api('GET', '/api/state')).bots.find((b) => b.id === runner.id && b.emoji === '🖥️'))
    assert.deepEqual(dressed.look, { creature: 'bug', color: 'lime', hat: 'none', extra: 'glasses', clothes: 'teal' })
    const id = await fresh(runner.id)
    assert.equal(lastText(await say(id, 'hello')), 'Local echo: hello')
    // The model is given the bot's tools, and what it calls is carried out here.
    assert.equal(lastText(await say(id, 'save a note')), 'The tool said: Saved memory/local.md.')
    assert.equal(fs.readFileSync(path.join(home, 'bots', runner.id, 'workspace', 'memory', 'local.md'), 'utf8'), 'kept here')
    assert.deepEqual([asked[0].model, asked[0].messages[0].role, asked[0].tools.some((t) => t.function.name === 'write_file')], ['tiny-local', 'system', true])
    assert.equal(asked.every((request) => !request.headers), true)

    // A picture goes with its message; a model that does not see pictures is asked again with them only named.
    await api('POST', `/api/threads/${id}/messages`, { text: 'see?', attachments: [(await pick(runner.id, 'dot.png', PNG)).id] })
    assert.equal(lastText(await settle(id)), 'Local saw: data:image/png;base64,')
    blind = true
    await api('POST', `/api/threads/${id}/messages`, { text: 'and now?', attachments: [(await pick(runner.id, 'dot.png', PNG)).id] })
    assert.match(lastText(await settle(id)), /^Local echo: and now\?\n\n\[The user attached a file\. Your copy: files\/inbox\/dot \(2\)\.png \(picture, 70 B\)/)
    blind = false

    // When the model refuses the conversation for its length, the older part is summarised and it is asked again.
    const long = await fresh(runner.id)
    for (const n of [1, 2]) await say(long, `${n} ${'heron '.repeat(250)}`)
    const items = await say(long, 'and now?')
    assert.equal(lastText(items), 'Local echo: and now?')
    assert.deepEqual(items.filter((d) => d.type === 'summary').map((d) => d.text), ['They spoke of herons.'])
    assert.ok(!items.some((d) => d.type === 'notice'), 'the refusal is not shown as a failure')
  } finally {
    await api('PATCH', '/api/settings', { localUrl: '' })
    fake.close()
  }
})

test('subagent: result is pushed to the parent when it finishes', async () => {
  const id = await fresh()
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
  const id = await fresh()
  await api('POST', `/api/threads/${id}/messages`, { text: '!tool spawn_subagent {"name":"Slow","task":"!slow work"}' })
  await new Promise((r) => setTimeout(r, 300))
  const items = await say(id, '!tool wait_subagents {}')
  assert.match(lastText(items), /Subagent "Slow".*completed\nEcho: !slow work/)
  await new Promise((r) => setTimeout(r, 300))
  assert.ok(!(await settle(id)).some((d) => d.source === 'subagent'))
})

test('scheduled tasks: one the owner makes runs in the background beneath the conversation, and the bot passes the result on', async () => {
  const id = await fresh()
  const task = await api('POST', '/api/tasks', { botId: bot.id, title: 'Ping', prompt: 'say pong', schedule: { type: 'once', at: Date.now() + 1200 } })
  assert.equal(task.createdBy, 'user')
  assert.ok(task.nextRunAt > Date.now() && task.enabled)
  assert.ok((await api('GET', '/api/state')).tasks.some((t) => t.id === task.id), 'the app is given the tasks with everything else')

  // The run is a thread of its own under the conversation; only its result comes into the conversation.
  const report = await until(async () => (await settle(id)).find((d) => d.source === 'task'))
  assert.match(report.text, /^<scheduled_task_result>\nScheduled task "Ping" \(task: task_\S+, run: t_\S+\) — completed\nEcho: say pong\n<\/scheduled_task_result>$/)
  assert.match(lastText(await settle(id)), /^Echo: <scheduled_task_result>/, 'the bot took a turn to tell the user')
  const { threads, tasks } = await api('GET', '/api/state')
  const run = threads.find((t) => t.taskId === task.id)
  assert.deepEqual([run.kind, run.parentId, run.title, run.reported], ['task', id, 'Ping', true])
  const first = (await api('GET', `/api/threads/${run.id}`)).items[0].data
  assert.deepEqual([first.source, first.text], ['schedule', 'say pong'])
  const done = tasks.find((t) => t.id === task.id)
  assert.deepEqual([done.lastStatus, done.lastThreadId, done.nextRunAt], ['completed', run.id, null], 'a task that runs once does not run again')

  // A run is not one of the bot's subagents.
  assert.equal(lastText(await say(id, '!tool list_subagents {}')), 'Tool result: You have not spawned any subagents.')
  await api('DELETE', `/api/tasks/${task.id}`)
})

test('scheduled tasks: run by hand, paused and resumed, checked, and quiet when there is nothing to report', async () => {
  const id = await fresh()
  const hourly = await api('POST', '/api/tasks', { botId: bot.id, title: 'Watch', prompt: '!say Nothing to report.', schedule: { type: 'interval', minutes: 60 } })
  assert.ok(Math.abs(hourly.nextRunAt - (Date.now() + 3_600_000)) < 5000)

  // Run now leaves the next run where it was. A run with nothing to say is not passed on.
  const started = await api('POST', `/api/tasks/${hourly.id}/run`)
  assert.equal(started.lastStatus, 'running')
  assert.equal(started.nextRunAt, hourly.nextRunAt)
  await until(async () => (await api('GET', '/api/state')).tasks.find((t) => t.id === hourly.id).lastStatus === 'completed')
  await new Promise((r) => setTimeout(r, 300))
  assert.ok(!(await settle(id)).some((d) => d.source === 'task'), 'nothing to report, so the conversation is left alone')

  const paused = await api('PATCH', `/api/tasks/${hourly.id}`, { enabled: false })
  assert.deepEqual([paused.enabled, paused.nextRunAt], [false, null])
  const resumed = await api('PATCH', `/api/tasks/${hourly.id}`, { enabled: true, schedule: { type: 'daily', time: '7:05', days: [1, 2, 3, 4, 5] } })
  assert.deepEqual(resumed.schedule, { type: 'daily', time: '07:05', days: [1, 2, 3, 4, 5] })
  const next = new Date(resumed.nextRunAt)
  assert.deepEqual([next.getHours(), next.getMinutes()], [7, 5])
  assert.ok(next.getDay() >= 1 && next.getDay() <= 5)

  const refused = async (body) => (await fetch(`${BASE}/api/tasks`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...auth() }, body: JSON.stringify({ botId: bot.id, title: 'X', prompt: 'x', ...body }) })).status
  assert.equal(await refused({ schedule: { type: 'once', at: Date.now() - 60_000 } }), 400, 'a time that has passed')
  assert.equal(await refused({ schedule: { type: 'interval', minutes: 1 } }), 400, 'too often')
  assert.equal(await refused({ schedule: { type: 'daily', time: '25:00' } }), 400)
  assert.equal(await refused({ title: ' ', schedule: { type: 'interval', minutes: 30 } }), 400)
  assert.equal(await refused({ botId: 'nobody', schedule: { type: 'interval', minutes: 30 } }), 400)

  await api('DELETE', `/api/tasks/${hourly.id}`)
  assert.ok(!(await api('GET', '/api/tasks')).some((t) => t.id === hourly.id))
})

test('scheduled tasks: bots schedule for themselves, and only the main assistant schedules for others or touches what it did not make', async () => {
  const main = (await api('GET', '/api/state')).bots[0]
  assert.equal(main.name, 'Assistant', 'the first bot is the main assistant')
  await api('PATCH', `/api/bots/${main.id}`, { provider: 'mock' })
  const other = await api('POST', '/api/bots', { name: 'Other', provider: 'mock' })
  const tasks = async () => (await api('GET', '/api/tasks'))
  const list = async (botId) => JSON.parse((await tool('list_scheduled_tasks', {}, botId)).replace(/^Tool result: /, ''))

  const made = await tool('schedule_task', { title: 'Water plants', prompt: 'Remind the user to water the plants.', time: '08:00', days: ['mon', 'fri'] })
  assert.match(made, /^Scheduled\. It is now \w{3} \d{4}-\d\d-\d\d \d\d:\d\d \(.+\)\./)
  const own = (await tasks()).find((t) => t.title === 'Water plants')
  assert.deepEqual([own.botId, own.createdBy, own.schedule], [bot.id, bot.id, { type: 'daily', time: '08:00', days: [1, 5] }])
  assert.match(await tool('schedule_task', { title: 'X', prompt: 'x', in_minutes: 5, bot_id: main.id }), /^Error: Only the main assistant, Assistant, can schedule tasks for other bots/)
  assert.match(await tool('schedule_task', { title: 'X', prompt: 'x', in_minutes: 5, every_minutes: 30 }), /^Error: Give only one of/)
  assert.match(await tool('schedule_task', { title: 'X', prompt: 'x' }), /^Error: Say when the task runs/)

  // One the owner made for this bot: it can see it, and cannot change it.
  const owners = await api('POST', '/api/tasks', { botId: bot.id, title: 'Owner’s', prompt: 'x', schedule: { type: 'interval', minutes: 30 } })
  const seen = await list(bot.id)
  assert.match(seen.now, /\(.+\)$/)
  assert.deepEqual(seen.tasks.map((t) => [t.title, t.made_by, t.you_can_change_it]), [['Water plants', 'you', true], ['Owner’s', 'the user', false]])
  assert.match(await tool('update_scheduled_task', { id: owners.id, paused: true }), /^Error: You did not make the task "Owner’s" \(the user did\), so you cannot change or delete it\. Only the main assistant, Assistant, can\./)
  assert.match(await tool('delete_scheduled_task', { id: owners.id }), /^Error: You did not make/)
  // Another bot does not see them at all.
  assert.deepEqual((await list(other.id)).tasks, [])
  assert.match(await tool('delete_scheduled_task', { id: own.id }, other.id), /^Error: You have no scheduled task with id/)

  // What it made, it changes and deletes.
  assert.match(await tool('update_scheduled_task', { id: own.id, paused: true, every_minutes: 120 }), /"schedule": "every 2 hours",\n "paused": true/)
  assert.equal(await tool('delete_scheduled_task', { id: own.id }), 'Deleted the task "Water plants".')

  // The main assistant sees everything, changes what the owner made, and schedules for other bots.
  assert.ok((await list(main.id)).tasks.some((t) => t.id === owners.id && t.you_can_change_it))
  assert.match(await tool('update_scheduled_task', { id: owners.id, title: 'Renamed' }, main.id), /^Changed\./)
  assert.match(await tool('schedule_task', { title: 'For Tester', prompt: 'x', at: '2099-01-01 09:30', bot_id: bot.id }, main.id), /"bot": "Tester \(tester\)",\n "made_by": "you"/)
  const forTester = (await tasks()).find((t) => t.title === 'For Tester')
  assert.deepEqual([forTester.botId, forTester.createdBy, new Date(forTester.nextRunAt).getHours()], [bot.id, main.id, 9])
  // Tester sees it, as it is the one doing it, and cannot delete it.
  assert.ok((await list(bot.id)).tasks.some((t) => t.id === forTester.id && t.made_by === 'Assistant' && !t.you_can_change_it))
  assert.match(await tool('delete_scheduled_task', { id: forTester.id }), /^Error: You did not make/)

  // Each bot is told what it may do.
  assert.match(await told('!system', main.id), /You are the main assistant, so you can also schedule tasks for the other bots/)
  assert.match(await told(), /You can change and delete only the tasks you made\./)

  // A bot that is deleted takes the tasks it does with it.
  await api('POST', '/api/tasks', { botId: other.id, title: 'Doomed', prompt: 'x', schedule: { type: 'interval', minutes: 30 } })
  await api('DELETE', `/api/bots/${other.id}`)
  assert.ok(!(await tasks()).some((t) => t.title === 'Doomed'))
  for (const t of await tasks()) await api('DELETE', `/api/tasks/${t.id}`)
})

test('scheduled tasks: a run is told who set it up, and one a bot wrote is not the user’s go-ahead', async () => {
  const id = await fresh()
  await say(id, `!tool schedule_task ${JSON.stringify({ title: 'Self', prompt: '!system', in_minutes: 0.02 })}`)
  const task = (await api('GET', '/api/tasks')).find((t) => t.title === 'Self')
  const run = await until(async () => {
    const t = (await api('GET', '/api/state')).threads.find((t) => t.taskId === task.id)
    return t && t.status !== 'running' && (await api('GET', `/api/threads/${t.id}`)).items.length > 1 && t
  })
  const prompt = lastText(await settle(run.id))
  assert.match(prompt, /# You are running a scheduled task\nThis thread is one run of the scheduled task "Self", which you scheduled\./)
  assert.match(prompt, /written by a bot, not by the user, so it is not their go-ahead/)
  // What it came to is passed on, and the bot answers it before it is done.
  await until(async () => (await settle(id)).some((d) => d.source === 'task'))
  await settle(id)
  await api('DELETE', `/api/tasks/${task.id}`)
})

test('stop cancels a running thread and its subagents', async () => {
  const id = await fresh()
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

test('a reply stopped part-way is kept as it stood, and the bot sees it next time', async () => {
  const id = await fresh()
  await api('POST', `/api/threads/${id}/messages`, { text: '!drip one two three four five six seven eight nine ten' })
  await until(async () => (await api('GET', `/api/threads/${id}`)).partial.text.includes('two'))
  await api('POST', `/api/threads/${id}/stop`)
  const items = await settle(id)
  const cut = items.at(-2)
  assert.deepEqual([cut.role, cut.stopped], ['assistant', true])
  assert.match(cut.text, /^one two/)
  assert.ok(!cut.text.includes('ten'), 'only what had been written')
  assert.deepEqual(items.at(-1), { type: 'notice', level: 'info', text: 'Stopped.' })
  assert.equal((await api('GET', `/api/threads/${id}`)).partial.text, '', 'it is no longer being written')
  assert.match(lastText(await say(id, '!sent')), /\nassistant: one two/)
})

test('a long conversation is sent a page at a time, each beginning at something said to the bot', async () => {
  const id = await fresh()
  // Two turns of 122 items each, then one of two.
  for (const turn of [1, 2]) await say(id, '!steps 60', 60_000)
  await say(id, 'last')
  const newest = await api('GET', `/api/threads/${id}`)
  assert.equal(newest.items.length, 124, 'past the page size to the start of the turn, not into the middle of it')
  assert.deepEqual([newest.items[0].data.text, newest.items.at(-1).data.text, newest.more], ['!steps 60', 'Echo: last', true])
  const before = await api('GET', `/api/threads/${id}?before=${newest.items[0].id}`)
  assert.deepEqual([before.items.length, before.items[0].data.text, before.more], [122, '!steps 60', false])
  assert.equal(before.items.at(-1).id, newest.items[0].id - 1, 'the pages meet')
  // A message found by searching: everything back to it, in one answer.
  const back = await api('GET', `/api/threads/${id}?before=${newest.items[0].id}&from=${before.items[5].id}`)
  assert.equal(back.items.length, 122)
  assert.equal((await api('GET', `/api/threads/${id}?before=x`).catch((e) => e)).message, `GET /api/threads/${id}?before=x: before must be a whole number`)
})

test('scheduled tasks: every run is kept, and the apps get them a page at a time', async () => {
  const id = await fresh()
  const task = await api('POST', '/api/tasks', { botId: bot.id, title: 'Often', prompt: '!say Nothing to report.', schedule: { type: 'interval', minutes: 60 } })
  for (let n = 0; n < 52; n++) {
    await api('POST', `/api/tasks/${task.id}/run`)
    await until(async () => (await api('GET', '/api/tasks')).find((t) => t.id === task.id).lastStatus !== 'running')
  }
  const first = await api('GET', `/api/tasks/${task.id}/runs`)
  assert.deepEqual([first.runs.length, first.more], [20, true])
  assert.ok(first.runs.every((r, i) => !i || r.createdAt < first.runs[i - 1].createdAt), 'newest first')
  let all = first.runs
  for (let page = first; page.more; ) {
    page = await api('GET', `/api/tasks/${task.id}/runs?before=${all.at(-1).createdAt}`)
    all = [...all, ...page.runs]
  }
  assert.equal(new Set(all.map((r) => r.id)).size, 52, 'none was deleted')
  assert.ok(all.every((r) => r.parentId === id && r.kind === 'task'))
  await api('DELETE', `/api/tasks/${task.id}`)
  assert.equal((await api('GET', `/api/tasks/${task.id}/runs`)).runs.length, 20, 'the runs of a deleted task are still there')
})

test('browser: navigate, snapshot refs, type and click', async () => {
  const html = `<title>Form</title><h1>Sign up</h1><input placeholder="Your name" id="n">
    <button onclick="document.title='Hi '+document.getElementById('n').value">Greet</button>`
  const id = await fresh()
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

test('browser: each thread browses in a window of its own, and popups open and close in it', async () => {
  const page = (title, body = '') => 'data:text/html,' + encodeURIComponent(`<title>${title}</title><h1>${title}</h1>${body}`)
  const id = await fresh()
  await toolIn(id, 'browser_navigate', { url: page('Mine') }, 60_000)
  // A subagent of the conversation browses at the same time, somewhere else, without moving the conversation's page.
  await say(id, `!tool spawn_subagent ${JSON.stringify({ name: 'Looker', task: `!tool browser_navigate ${JSON.stringify({ url: page('Theirs') })}` })}`)
  const child = (await api('GET', '/api/state')).threads.find((t) => t.parentId === id)
  await until(async () => (await api('GET', `/api/threads/${child.id}`)).thread.status !== 'running', 30_000)
  const { browsers } = await api('GET', '/api/state')
  const { windows, tabs } = browsers[bot.id]
  const mine = windows.find((w) => w.threadId === id)
  const theirs = windows.find((w) => w.threadId === child.id)
  assert.ok(mine && theirs && mine.id !== theirs.id, 'two windows')
  const url = (w) => tabs.find((t) => t.id === w.activeTab).url
  assert.deepEqual([url(mine), url(theirs)], [page('Mine'), page('Theirs')])
  assert.deepEqual(tabs.filter((t) => t.windowId === mine.id).map((t) => t.threadId), [id], 'tabs say which window and thread they are in')
  assert.match(await toolIn(id, 'browser_snapshot', {}), /Page: Mine/)

  // A popup opens in the window of the page that opened it, the work goes on there, and when it
  // closes the bot is back on the page it came from.
  await toolIn(id, 'browser_navigate', { url: page('Opener', `<button onclick="window.open('about:blank', '_blank')">Pop</button>`) })
  const pop = (await toolIn(id, 'browser_snapshot', {})).match(/\[(\d+)\] button "Pop"/)[1]
  assert.match(await toolIn(id, 'browser_click', { ref: Number(pop) }), /URL: about:blank/)
  const opened = (await api('GET', '/api/state')).browsers[bot.id]
  assert.equal(opened.tabs.filter((t) => t.windowId === mine.id).length, 2)
  assert.equal(opened.windows.length, windows.length, 'no window of its own')
  await toolIn(id, 'browser_eval', { expression: 'window.close()' })
  await until(async () => (await api('GET', '/api/state')).browsers[bot.id].tabs.filter((t) => t.windowId === mine.id).length === 1)
  assert.match(await toolIn(id, 'browser_snapshot', {}), /Page: Opener/)
})

test('browser: the owner takes control of a window; the bot can then only read it, and hears when it is handed back', async () => {
  const page = (title) => 'data:text/html,' + encodeURIComponent(`<title>${title}</title><div style="height:100vh" onclick="document.title='Clicked'">${title}</div>`)
  const id = await fresh()
  await toolIn(id, 'browser_navigate', { url: page('Mine') }, 60_000)
  const windowOf = async () => (await api('GET', '/api/state')).browsers[bot.id].windows.find((w) => w.threadId === id)
  const win = await windowOf()
  assert.equal(win.controller, null, 'the bot has it to begin with')

  // Watching is not driving: a view that has not taken control cannot use the page, or its address bar.
  const watcher = await openSocket()
  const click = (socket) => ['down', 'up'].forEach((kind) => socket.send(JSON.stringify({ type: 'browser.input', botId: bot.id, tabId: win.activeTab, input: { kind, x: 200, y: 200, button: 'left' } })))
  click(watcher)
  await assert.rejects(api('POST', `/api/bots/${bot.id}/browser/reload`, { tabId: win.activeTab }), /Take control of the browser first/)

  const owner = await takeControl(win.id)
  assert.equal((await until(async () => (await windowOf()).controller)), owner.viewer)
  click(watcher)
  await new Promise((r) => setTimeout(r, 500))
  let read = await toolIn(id, 'browser_snapshot', {})
  assert.match(read, /^\(The user has control of this window right now: you can read it but not act in it\.\)/)
  assert.match(read, /Page: Mine/, 'clicks from a view without control did not reach the page')
  assert.match(await toolIn(id, 'browser_navigate', { url: page('Elsewhere') }), /^Error: The user has taken control of this browser window/)
  click(owner.socket)
  await until(async () => /Page: Clicked/.test(await toolIn(id, 'browser_read', {})))
  await api('POST', `/api/bots/${bot.id}/browser/navigate`, { tabId: win.activeTab, url: page('Owner') })

  owner.give()
  await until(async () => !(await windowOf()).controller)
  read = await toolIn(id, 'browser_snapshot', {})
  assert.match(read, /^\(The user used this browser window since you last looked, and has handed it back\. The page may have changed\.\)/)
  assert.match(read, /Page: Owner/)
  assert.doesNotMatch(await toolIn(id, 'browser_snapshot', {}), /The user used/, 'the bot is told once')

  // Control goes back to the bot when the view that has it goes away.
  const leaving = await takeControl(win.id)
  await until(async () => (await windowOf()).controller === leaving.viewer)
  leaving.close()
  await until(async () => !(await windowOf()).controller)
  assert.match(await toolIn(id, 'browser_navigate', { url: page('Again') }), /Page: Again/)
  watcher.close()
  owner.close()
})

test('browser: a bot asks the owner to take over, and waits until they hand it back or say no', async () => {
  const id = await fresh()
  await toolIn(id, 'browser_navigate', { url: 'data:text/html,' + encodeURIComponent('<title>Sign in</title>') }, 60_000)
  const windowOf = async () => (await api('GET', '/api/state')).browsers[bot.id].windows.find((w) => w.threadId === id)
  const ask = async (request) => {
    await api('POST', `/api/threads/${id}/messages`, { text: `!tool browser_ask_user ${JSON.stringify({ request })}` })
    return until(async () => ((await windowOf()).request === request ? windowOf() : null))
  }
  const answer = async () => (await settle(id)).findLast((d) => d.type === 'function_call_output').output

  // Done: the owner takes over, does it, and hands back; the bot carries on from the page as they left it.
  const win = await ask('Sign in to Example')
  const owner = await takeControl(win.id)
  await until(async () => (await windowOf()).controller)
  assert.equal((await api('GET', `/api/threads/${id}`)).thread.status, 'running', 'the bot is still waiting')
  await api('POST', `/api/bots/${bot.id}/browser/navigate`, { tabId: win.activeTab, url: 'data:text/html,' + encodeURIComponent('<title>Signed in</title>') })
  owner.give()
  assert.match(await answer(), /^The user handed the browser back\.\n\nPage: Signed in/)
  assert.equal((await windowOf()).request, null)

  // Said no.
  await ask('Solve the puzzle')
  owner.decline()
  assert.match(await answer(), /^The user said no/)

  // Took over, then went away.
  await ask('Type the code')
  const leaving = await takeControl(win.id)
  await until(async () => (await windowOf()).controller)
  leaving.close()
  assert.match(await answer(), /^The user took over, then left without handing back/)
  owner.close()

  // Stopping the bot stops the wait.
  await ask('Anything')
  await api('POST', `/api/threads/${id}/stop`)
  assert.match(await answer(), /^Error: stopped by the user/)
  assert.equal((await windowOf()).request, null)

  // Nobody watches a scheduled run, so it cannot ask.
  assert.match(lastText(await say(id, '!tools')), /\bbrowser_ask_user\b/)
  const task = await api('POST', '/api/tasks', { botId: bot.id, title: 'Tools', prompt: '!tools', schedule: { type: 'interval', minutes: 60 } })
  await api('POST', `/api/tasks/${task.id}/run`)
  const run = await until(async () => (await api('GET', '/api/state')).tasks.find((t) => t.id === task.id && t.lastStatus === 'completed'))
  const tools = lastText((await api('GET', `/api/threads/${run.lastThreadId}`)).items.map((i) => i.data))
  assert.match(tools, /\bbrowser_navigate\b/)
  assert.doesNotMatch(tools, /\bbrowser_ask_user\b/)
  await api('DELETE', `/api/tasks/${task.id}`)
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
  assert.deepEqual((await say(await fresh(made.id), 'hello')).at(-1), { type: 'notice', level: 'error', text: 'Mock (offline testing) is switched off in Settings.' })

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
  // The computer is told which server this is, to know it by at any address.
  const { id: server } = await (await fetch(far + '/api/hello')).json()
  assert.equal(paired.server, server)

  // Before it sends its key to an address, the computer asks who is there, naming itself by a tag
  // made from the key. Only this server, which keeps the key's hash, can sign the computer's value with it.
  const hashOf = (key) => crypto.createHash('sha256').update(key).digest('hex')
  const tagOf = (key) => crypto.createHash('sha256').update(`device:${hashOf(key)}`).digest('hex')
  const ask = async (key, challenge = crypto.randomBytes(16).toString('hex')) => {
    const said = await (await fetch(`${far}/api/hello?challenge=${challenge}&device=${tagOf(key)}`)).json()
    return { said, expected: crypto.createHmac('sha256', hashOf(key)).update(`server:${said.id}:${challenge}`).digest('hex') }
  }
  const { said, expected } = await ask(paired.key)
  assert.deepEqual([said.id, said.device, said.authorized], [server, { known: true, proof: expected }, false], 'the key itself was not sent')
  assert.deepEqual((await ask('a key nobody was given')).said.device, { known: false })
  assert.equal('device' in (await (await fetch(`${far}/api/hello?challenge=zz&device=${tagOf(paired.key)}`)).json()), false, 'a challenge has to be a made-up value')

  // Where else it can be reached: the local network, then Tailscale, name first.
  const reported = (await (await viaNetwork(paired.key, '/api/addresses')).json()).addresses
  const place = (url) => reported.indexOf(url)
  assert.ok(place(far) >= 0, 'the address it was reached at')
  assert.ok(place(far) < place(`http://test-mac.tail0000.ts.net:${PORT}`) && place(`http://test-mac.tail0000.ts.net:${PORT}`) < place(`http://100.101.102.103:${PORT}`), reported.join(' '))
  assert.equal((await viaNetwork(undefined, '/api/addresses')).status, 401, 'only a paired computer is told')
  assert.deepEqual((await api('GET', '/api/access')).tailscale.slice(0, 2), ['test-mac.tail0000.ts.net', '100.101.102.103'])

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
  // ...and it can no longer be shown who this is: it is told the server does not know it.
  assert.deepEqual((await ask(paired.key)).said.device, { known: false })

  await api('PATCH', '/api/settings', { lan: false })
  await until(async () => (await api('GET', '/api/access').catch(() => null))?.on === false)
  assert.deepEqual((await api('GET', '/api/addresses')).addresses, [], 'with network access off, there is nowhere else to reach it')
  await until(async () => (await viaNetwork(token).then(() => false, () => true)))
  assert.equal((await api('GET', '/api/state')).bots.length > 0, true, 'and this computer is still served')
})

test('all conversations can be deleted, leaving the bots as they are', async () => {
  const before = await api('GET', '/api/state')
  assert.ok(before.threads.length > 0)
  await api('DELETE', '/api/threads')
  const after = await api('GET', '/api/state')
  assert.deepEqual(after.threads, [])
  assert.deepEqual(after.bots.map((b) => b.id), before.bots.map((b) => b.id))
})
