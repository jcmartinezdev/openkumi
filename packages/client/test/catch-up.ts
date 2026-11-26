// Run by sync.test.mjs, in a process of its own (the store is one per app): drives the store
// against a real server. Connects, opens a chat, is kept away while things change, and checks
// what the store holds once it is back. Arguments: the server's data folder, then its port.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createConnection } from '../src/connection'
import { follow, loadOlder, onState, openThread, receive, useTransport, type State } from '../src/store'

const [home, port] = process.argv.slice(2)
const base = `http://127.0.0.1:${port}`
// The server keeps its data in the folder of the person it runs for: the first one here.
const data = path.join(home, 'people', JSON.parse(fs.readFileSync(path.join(home, 'people.json'), 'utf8'))[0].name)
const token = JSON.parse(fs.readFileSync(path.join(data, 'auth.json'), 'utf8')).accessToken
const http = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(base + url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${url}: ${json.error}`)
  return json
}

let now: State
const seen: State[] = []
onState((s) => ((now = s), seen.push(s)))
const tell = createConnection(receive, () => {})
useTransport(tell)
const link = { id: 'check', name: 'check', addresses: [base], token, local: true } as any
follow(link)
/** Keeps the store away: the same environment, at an address where nothing answers, until `back`. */
const away = () => follow({ ...link, addresses: ['http://127.0.0.1:9'] })
const back = () => follow(link)

async function until(check: () => unknown, ms = 20_000) {
  const end = Date.now() + ms
  for (;;) {
    if (check()) return
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 30))
  }
}
const idle = (id: string) => until(() => now.threads.find((t) => t.id === id)?.status === 'idle')
const texts = (id: string) => (now.items[id] ?? []).map((i) => (i.data as any).text ?? i.data.type)

await until(() => now?.connected && now.loaded)
assert.ok(!seen.some((s) => s.syncing), 'the first load, with nothing shown yet, is not syncing')
const firstSeq = now.seq
assert.ok(now.database.startsWith('db_'))
const bot = await http('POST', '/api/bots', { name: 'Checker', provider: 'mock' })
await http('PATCH', '/api/settings', { maxSteps: 300 })
const conv = (await http('POST', `/api/bots/${bot.id}/messages`, { text: 'one' })).id
await until(() => now.threads.some((t) => t.id === conv))
// A thread is listed as idle for a moment before its turn starts, so "idle" alone could be either end of it: the reply has to be in.
for (const end = Date.now() + 20_000; ; ) {
  const { thread, items } = await http('GET', `/api/threads/${conv}`)
  if (thread.status === 'idle' && items.length >= 2) break
  if (Date.now() > end) throw new Error('the first reply did not arrive')
  await new Promise((r) => setTimeout(r, 30))
}
await idle(conv)
// As a view does when it shows the chat, and again when the connection comes back.
await openThread(conv)
assert.deepEqual(texts(conv), ['one', 'Echo: one'])
assert.ok(now.seq > firstSeq, 'thread events move the change number on')

// 1. Away while two more turns happen and a run of an automation is made and deleted.
const runTask = await http('POST', '/api/automations', { botId: bot.id, title: 'Doomed', prompt: '!say Nothing to report.', trigger: { kind: 'time', schedule: { type: 'interval', minutes: 60 } } })
await http('POST', `/api/automations/${runTask.id}/run`)
await until(() => now.threads.some((t) => t.automationId === runTask.id && t.status === 'idle'))
const run = now.threads.find((t) => t.automationId === runTask.id)!
const heldBefore = now.items[conv]
away()
await until(() => !now.connected)
await http('POST', `/api/threads/${conv}/messages`, { text: 'two' })
for (;;) {
  const { thread } = await http('GET', `/api/threads/${conv}`)
  if (thread.status === 'idle') break
  await new Promise((r) => setTimeout(r, 30))
}
await http('POST', `/api/threads/${conv}/messages`, { text: 'three' })
for (;;) {
  const { thread } = await http('GET', `/api/threads/${conv}`)
  if (thread.status === 'idle') break
  await new Promise((r) => setTimeout(r, 30))
}
await http('DELETE', `/api/threads/${run.id}`)
const cleared = seen.length
assert.ok(!now.syncing, 'nothing is being caught up while away')
back()
await until(() => now.connected)
// Once the connection opened, and before it counted as connected, what changed meanwhile was being asked for.
const syncing = seen.slice(cleared).findIndex((s) => s.syncing)
assert.ok(syncing >= 0, 'said to be syncing')
assert.ok(!seen[cleared + syncing]!.connected, 'syncing comes before connected')
assert.ok(!now.syncing, 'not syncing once connected')
const opening = seen.length
const caughtUp = openThread(conv)
// The chat on screen holds what it had from before: its newer messages are on their way.
assert.ok(now.catchingUp[conv], 'the chat is said to be catching up')
await caughtUp
assert.ok(!now.catchingUp[conv], 'and not once it has')
assert.deepEqual(now.catchingUp, {})
// It stopped catching up in the same change that put the new messages in.
const done = seen.slice(opening).find((s) => !s.catchingUp[conv])!
assert.equal(done.items[conv]!.length, 6)
assert.equal(texts(conv).length, 6)
assert.deepEqual(texts(conv), ['one', 'Echo: one', 'two', 'Echo: two', 'three', 'Echo: three'])
assert.ok(seen.slice(cleared).every((s) => s.items[conv]), 'the open chat was never emptied while catching up')
assert.equal(now.items[conv]![0], heldBefore![0], 'what was held is kept as it was')
assert.ok(!now.threads.some((t) => t.id === run.id), 'a thread removed while away is gone')
const ids = now.items[conv]!.map((i) => i.id)
assert.deepEqual(ids, [...ids].sort((a, b) => a - b), 'in order, no repeats')
assert.equal(new Set(ids).size, ids.length)
assert.equal(now.threads.find((t) => t.id === conv)!.status, 'idle')

// 2. Away while more happens than a page holds: the newest page replaces what was held.
away()
await until(() => !now.connected)
await http('POST', `/api/threads/${conv}/messages`, { text: '!steps 210' })
for (;;) {
  const { thread } = await http('GET', `/api/threads/${conv}`)
  if (thread.status === 'idle') break
  await new Promise((r) => setTimeout(r, 50))
}
back()
await until(() => now.connected)
await openThread(conv)
assert.equal(texts(conv).at(-1), 'Done in 210 steps.')
assert.equal(now.items[conv]!.length, 400)
assert.equal(now.older[conv], true, 'what came before the gap can be fetched as older pages')
await loadOlder(conv)
const after = now.items[conv]!.map((i) => i.id)
assert.deepEqual(after, [...after].sort((a, b) => a - b))
assert.equal(new Set(after).size, after.length)
assert.ok(after.length > 400)

// 3. Live while connected: a new message comes through events, after the catch-ups.
await http('POST', `/api/threads/${conv}/messages`, { text: 'four' })
await until(() => texts(conv).at(-1) === 'Echo: four')
const live = now.items[conv]!.map((i) => i.id)
assert.equal(new Set(live).size, live.length)

// 4. Something already in the chat is rewritten on the server: a key that was written out in it is
// put in the bot's vault, and taken out of the conversation. What the store holds of it follows.
const key = 'key_wr1ttenOutInTheChat00aa11bb22'
await http('POST', `/api/threads/${conv}/messages`, { text: `the key is ${key}` })
await until(() => texts(conv).at(-1) === `Echo: the key is ${key}`)
const held = now.items[conv]!.length
await http('POST', `/api/threads/${conv}/messages`, { text: `!tool save_secret ${JSON.stringify({ name: 'written-out', site: 'example.com', what: 'A key', value: key })}` })
await until(() => String(texts(conv).at(-1)).startsWith('Tool result: Kept as "written-out"'))
assert.ok(!JSON.stringify(now.items[conv]).includes(key), 'the key is in nothing the store holds')
assert.deepEqual(texts(conv).slice(held - 2, held), ['the key is [secret: written-out]', 'Echo: the key is [secret: written-out]'])
const rewritten = now.items[conv]!.map((i) => i.id)
assert.deepEqual(rewritten, [...rewritten].sort((a, b) => a - b), 'each item is where it was')
assert.equal(new Set(rewritten).size, rewritten.length)

// 5. The same while the store is away (a phone in a pocket): it was told of no change, and what came
// after what it holds is not all that changed. The conversation says it was rewritten, so what is
// held of it is thrown away and fetched afresh.
const other = 'key_wr1ttenOutWhileAway33cc44dd55'
await http('POST', `/api/threads/${conv}/messages`, { text: `and another key is ${other}` })
await until(() => texts(conv).at(-1) === `Echo: and another key is ${other}`)
assert.ok(JSON.stringify(now.items[conv]).includes(other), 'held as it was said')
away()
await until(() => !now.connected)
await http('POST', `/api/threads/${conv}/messages`, { text: `!tool save_secret ${JSON.stringify({ name: 'written-while-away', site: 'example.com', what: 'A key', value: other })}` })
for (const end = Date.now() + 20_000; ; ) {
  const { thread, items } = await http('GET', `/api/threads/${conv}`)
  if (thread.status === 'idle' && String(items.at(-1).data.text).startsWith('Tool result: Kept as "written-while-away"')) break
  if (Date.now() > end) throw new Error(`the key was not kept while away: ${thread.status}, ${JSON.stringify(items.at(-1).data).slice(0, 200)}`)
  await new Promise((r) => setTimeout(r, 50))
}
assert.ok(JSON.stringify(now.items[conv]).includes(other), 'still held as it was, while away')
back()
await until(() => now.connected)
await openThread(conv)
assert.ok(!JSON.stringify(now.items[conv]).includes(other), 'what was held from before the rewrite is gone')
assert.ok(texts(conv).includes('and another key is [secret: written-while-away]'))
assert.ok(String(texts(conv).at(-1)).startsWith('Tool result: Kept as "written-while-away"'))
const afresh = now.items[conv]!.map((i) => i.id)
assert.deepEqual(afresh, [...afresh].sort((a, b) => a - b))
assert.equal(new Set(afresh).size, afresh.length)

// 6. The bot's id changes while the store is connected: it stays where it was in the list (the first
// is the main assistant), under its new id and once, and its conversation goes with it.
const place = now.bots.findIndex((b) => b.id === bot.id)
assert.ok(place > 0)
const heldThen = now.items[conv]
await http('POST', `/api/bots/${bot.id}/move`, { id: 'Checked' })
await until(() => now.bots.some((b) => b.id === 'checked') && !now.bots.some((b) => b.id === bot.id) && now.threads.find((t) => t.id === conv)?.botId === 'checked')
// The event an app from before understands comes last: a bot with that id, which this store already holds.
await until(() => seen.at(-1)!.bots.find((b) => b.id === 'checked')?.formerIds?.length)
await new Promise((r) => setTimeout(r, 300))
assert.equal(now.bots.findIndex((b) => b.id === 'checked'), place)
assert.equal(now.bots.filter((b) => b.id === 'checked').length, 1)
assert.deepEqual(now.bots[place]!.formerIds, [bot.id])
assert.equal(now.items[conv], heldThen, 'what is held of its conversation stays as it was')

process.exit(0)
