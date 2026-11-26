// A bot's id changing, against a real server process (src/move.ts): what is filed under the id
// moves with it (its folder, conversation, automations, vault and place in the owner's order), and
// the id it had still reaches it, so that what other bots wrote down before goes on working. One
// that cannot be finished is put back. The model is the scripted one.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'

/** A server keeps its data in the folder of the person it runs for: here the first one, made when it first starts. */
const dataOf = (home) => path.join(home, 'people', JSON.parse(fs.readFileSync(path.join(home, 'people.json'), 'utf8'))[0].name)

// Clear of the other tests' servers (secrets.test.mjs ends below 5890), of 5900 (the Mac's screen
// sharing), and of the ports fetch refuses.
const PORT = 5910 + Math.floor(Math.random() * 80)
const BASE = `http://127.0.0.1:${PORT}`
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-move-'))
/** Where the vault's key goes in a test, instead of the keychain of whoever runs it. */
const keys = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-keys-'))
let server
let token
/** The main assistant, and the two bots whose ids change. */
let main
let first
let other

async function call(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function api(method, url, body) {
  const { status, json } = await call(method, url, body)
  if (status >= 400) throw new Error(`${method} ${url}: ${json.error}`)
  return json
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
async function until(check, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await check()
    if (found) return found
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('It did not happen in time')
}
async function say(threadId, text) {
  await api('POST', `/api/threads/${threadId}/messages`, { text })
  return settle(threadId)
}
const state = () => api('GET', '/api/state')
const fresh = async (botId) => (await api('POST', `/api/bots/${botId}/fresh`)).id
const lastText = (items) => items.findLast((d) => d.type === 'message' && d.role === 'assistant')?.text
/** Calls one tool through the scripted model and returns what the tool gave back. */
const tool = async (name, args, botId) => (await say(await fresh(botId), `!tool ${name} ${JSON.stringify(args)}`)).findLast((d) => d.type === 'function_call_output').output
const refused = async (botId, id) => {
  const { status, json } = await call('POST', `/api/bots/${botId}/move`, { id })
  assert.equal(status, 400, `moving ${botId} to ${id} was refused`)
  return json.error
}

before(async () => {
  server = spawn(process.execPath, ['src/index.ts'], {
    env: { ...process.env, OPENKUMI_HOME: home, OPENKUMI_PORT: String(PORT), OPENKUMI_MOCK: '1', OPENKUMI_VAULT_KEYS: keys },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('running at') && resolve())
    server.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
  token = JSON.parse(fs.readFileSync(path.join(dataOf(home), 'auth.json'), 'utf8')).accessToken
  main = (await state()).bots[0]
  await api('PATCH', `/api/bots/${main.id}`, { provider: 'mock' })
  // Made as "Assistant", and renamed since: the name changed, and the id it was made with did not.
  // Given a look, as the bots in a test are: one chosen by the model would come a moment later.
  first = await api('POST', '/api/bots', { name: 'Assistant', provider: 'mock', emoji: '📅', look: { creature: 'cat', color: 'mint' } })
  first = await api('PATCH', `/api/bots/${first.id}`, { name: 'Scheduler' })
  other = await api('POST', '/api/bots', { name: 'Writer', provider: 'mock', emoji: '✍️', look: { creature: 'bug', color: 'sky' } })
})

after(async () => {
  server.removeAllListeners('exit')
  server.kill('SIGTERM')
  await new Promise((r) => server.on('exit', r))
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(keys, { recursive: true, force: true })
})

const KEY = 'plsbl_9e1d2c3b4a5f60718293a4b5c6d7e8f9'

test('the owner gives a bot a new id: its folder, conversation, automations, vault and place in the order go with it', async () => {
  assert.deepEqual([first.id, first.name, first.formerIds], ['assistant', 'Scheduler', undefined])
  // Things kept under its id: a secret (sealed to the id), a conversation, an automation, its place in the owner's order.
  await api('POST', '/api/bots/assistant/secrets', { name: 'plausible', sites: 'plausible.io', value: KEY, what: 'Plausible key' })
  const talk = await fresh('assistant')
  assert.equal(lastText(await say(talk, 'hello')), 'Echo: hello')
  const automation = await api('POST', '/api/automations', { botId: 'assistant', title: 'Daily', prompt: '!say Done.', trigger: { kind: 'time', schedule: { type: 'interval', minutes: 60 } } })
  await api('PATCH', '/api/settings', { botSort: 'manual', botOrder: [other.id, 'assistant', main.id] })

  // What is typed is made into an id, as a new bot's name is.
  const moved = await api('POST', '/api/bots/assistant/move', { id: 'Scheduler' })
  assert.deepEqual([moved.id, moved.formerIds, moved.name, moved.createdAt, moved.look], ['scheduler', ['assistant'], 'Scheduler', first.createdAt, first.look])

  assert.ok(fs.existsSync(path.join(dataOf(home), 'bots', 'scheduler', 'workspace', 'AGENTS.md')))
  assert.ok(!fs.existsSync(path.join(dataOf(home), 'bots', 'assistant')))
  assert.match(fs.readFileSync(path.join(dataOf(home), 'bots', 'scheduler', 'bot.md'), 'utf8'), /^former_ids: assistant$/m)

  const now = await state()
  assert.ok(!now.bots.some((b) => b.id === 'assistant'))
  assert.equal(now.threads.find((t) => t.id === talk).botId, 'scheduler')
  assert.equal(now.automations.find((a) => a.id === automation.id).botId, 'scheduler')
  assert.deepEqual(now.settings.botOrder, [other.id, 'scheduler', main.id])
  // Each value in the vault was sealed to the old id, and was sealed again to the new one.
  assert.equal((await api('GET', '/api/bots/scheduler/secrets/plausible/value')).value, KEY)
  assert.ok(!fs.readFileSync(path.join(dataOf(home), 'bots', 'scheduler', 'private', 'secrets.json'), 'utf8').includes(KEY))
  // The conversation goes on where it was, and the automation runs as the bot under its new id.
  assert.equal(lastText(await say(talk, 'still there?')), 'Echo: still there?')
  await api('POST', `/api/automations/${automation.id}/run`)
  const ran = await until(async () => (await state()).threads.find((t) => t.automationId === automation.id && t.status !== 'running'))
  assert.equal(ran.botId, 'scheduler')
  // Its workspace's history is kept in its folder, and goes on from where it was.
  const before = (await api('GET', '/api/bots/scheduler/history')).entries.length
  await api('PUT', '/api/bots/scheduler/file?path=memory/after.md', { content: 'Moved.' })
  const history = await api('GET', '/api/bots/scheduler/history')
  assert.deepEqual([history.available, history.entries.length, history.entries[0].author, history.entries[0].files], [true, before + 1, 'you', ['memory/after.md']])
  // An app that has not heard yet reaches it by the id it had.
  assert.equal((await api('GET', '/api/bots/assistant/secrets')).secrets.length, 1)
  // The same id again changes nothing.
  assert.deepEqual((await api('POST', '/api/bots/scheduler/move', { id: 'scheduler' })).formerIds, ['assistant'])
})

test('what still names a bot by the id it had reaches it, and no other bot can take that id', async () => {
  // Another bot's notes from before name it "assistant": its message reaches the bot, under its new id.
  assert.match(await tool('message_bot', { bot_id: 'assistant', message: '!say Got it.' }, other.id), /^Delivered\./)
  const conversation = (await state()).threads.find((t) => t.botId === 'scheduler' && !t.parentId && !t.archivedAt)
  const read = (items) => items.some((d) => d.type === 'message' && d.source === 'bot' && d.bot?.id === other.id && d.text === '!say Got it.')
  await until(async () => read(await settle(conversation.id)))
  // The other bots are told both, so that what they wrote down before still makes sense to them.
  assert.match(lastText(await say(await fresh(other.id), '!system')), /- 📅 Scheduler \(bot_id: scheduler, formerly assistant\): /)
  assert.match(await tool('list_bots', {}, other.id), /"id": "scheduler",\s*"former_ids": \[\s*"assistant"\s*\],\s*"name": "Scheduler"/)
  // An app that has not heard yet makes an automation for it by the id it had.
  const weekly = await api('POST', '/api/automations', { botId: 'assistant', title: 'Weekly', prompt: '!say Done.', trigger: { kind: 'time', schedule: { type: 'interval', minutes: 60 } } })
  assert.equal(weekly.botId, 'scheduler')

  // A new bot named as it was first does not get the id it had, nor can another bot move to it.
  const again = await api('POST', '/api/bots', { name: 'Assistant', provider: 'mock' })
  assert.equal(again.id, 'assistant-2')
  assert.match(await refused(other.id, 'assistant'), /^“assistant” was Scheduler’s id, and what was written to it then still reaches Scheduler\.$/)
  assert.match(await refused(other.id, 'scheduler'), /already has the id “scheduler”/)
  assert.match(await refused(other.id, 'settings'), /is the address of a page in the app/)
  assert.match(await refused(other.id, '!!!'), /^An id is made of letters a to z, digits and "-"/)
  await api('DELETE', `/api/bots/${again.id}`)

  // The bot itself can have it again, and keeps the one it leaves. Not while it is at work: it is let finish.
  await until(async () => read(await settle(conversation.id)) && (await state()).threads.every((t) => t.botId !== 'scheduler' || t.status !== 'running'))
  const back = await api('POST', '/api/bots/scheduler/move', { id: 'assistant' })
  assert.deepEqual([back.id, back.formerIds], ['assistant', ['scheduler']])
  assert.equal((await api('GET', '/api/bots/assistant/secrets/plausible/value')).value, KEY)
  assert.deepEqual((await api('POST', '/api/bots/assistant/move', { id: 'scheduler' })).formerIds, ['assistant'])
})

test('the main assistant changes another bot’s id on the owner’s word, not its own; and none moves while it works', async () => {
  const changed = await tool('update_bot', { bot_id: other.id, id: 'author' }, main.id)
  assert.match(changed, /^Changed bot \{"id":"author","former_ids":\["writer"\],"name":"Writer",/)
  assert.match(changed, /\nIts id was writer, which still reaches it\.$/)
  // Asked by the id it had, too.
  assert.match(await tool('update_bot', { bot_id: 'writer', name: 'Author' }, main.id), /^Changed bot \{"id":"author",.*"name":"Author"/)
  assert.match(await tool('update_bot', { bot_id: main.id, id: 'boss' }, main.id), /^Error: Your own id cannot change while you are at work/)
  // Its own id given again is no change of id.
  assert.match(await tool('update_bot', { bot_id: main.id, id: main.id, emoji: '🐻' }, main.id), /^Changed bot \{"id":"kumi","name":"Kumi","emoji":"🐻"/)

  const working = await fresh('author')
  await api('POST', `/api/threads/${working}/messages`, { text: '!slow' })
  await until(async () => (await api('GET', `/api/threads/${working}`)).thread.status === 'running')
  assert.equal(await refused('author', 'later'), 'Author is at work. Its id can change once it has finished.')
  await settle(working)
  assert.equal((await api('POST', '/api/bots/author/move', { id: 'later' })).id, 'later')
})

test('a move that cannot be finished leaves the bot as it was', async () => {
  await api('POST', '/api/bots', { name: 'Keeper', provider: 'mock', emoji: '🔐', look: { creature: 'blob', color: 'tangerine' } })
  await api('POST', '/api/bots/keeper/secrets', { name: 'plausible', sites: 'plausible.io', value: KEY, what: 'Plausible key' })
  const talk = await fresh('keeper')
  await say(talk, 'hello')
  const folder = (id) => path.join(dataOf(home), 'bots', id)
  const asItWas = async () => {
    assert.ok(fs.existsSync(folder('keeper')) && !fs.existsSync(folder('kept')))
    assert.doesNotMatch(fs.readFileSync(path.join(folder('keeper'), 'bot.md'), 'utf8'), /former_ids/)
    assert.equal((await api('GET', '/api/bots/keeper/secrets/plausible/value')).value, KEY)
    assert.equal((await state()).threads.find((t) => t.id === talk).botId, 'keeper')
  }

  // The database refuses its part, after the folder has moved and the vault was sealed to the new id: both are put back.
  const sql = new DatabaseSync(path.join(dataOf(home), 'openkumi.db'), { timeout: 5000 })
  sql.exec(`CREATE TRIGGER refuse_move BEFORE UPDATE OF bot_id ON threads WHEN NEW.bot_id = 'kept' BEGIN SELECT RAISE(ABORT, 'refused for the test'); END`)
  try {
    assert.equal(await refused('keeper', 'kept'), 'refused for the test')
  } finally {
    sql.exec('DROP TRIGGER refuse_move')
    sql.close()
  }
  await asItWas()

  // A secret that cannot be opened stops it before anything moves: sealed to the old id, it would never open again.
  const vault = path.join(folder('keeper'), 'private', 'secrets.json')
  const sealed = fs.readFileSync(vault, 'utf8')
  const damaged = JSON.parse(sealed)
  damaged.secrets[0].data = Buffer.from('changed by hand, and longer than sixteen bytes').toString('base64')
  fs.writeFileSync(vault, JSON.stringify(damaged))
  assert.match(await refused('keeper', 'kept'), /“plausible” could not be: .*damaged\. Enter it again\. Or remove it\.$/)
  fs.writeFileSync(vault, sealed)
  await asItWas()

  // What the owner makes is marked "user": no bot can pass for them.
  assert.equal(await refused('keeper', 'user'), '“user” stands for you, so no bot can have it as its id.')
  assert.equal((await api('POST', '/api/bots/keeper/move', { id: 'kept' })).id, 'kept')
  assert.equal((await api('GET', '/api/bots/kept/secrets/plausible/value')).value, KEY)
})
