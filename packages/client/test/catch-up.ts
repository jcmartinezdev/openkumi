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
const token = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).accessToken
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
const firstSeq = now.seq
assert.ok(now.database.startsWith('db_'))
const bot = await http('POST', '/api/bots', { name: 'Checker', provider: 'mock' })
await http('PATCH', '/api/settings', { maxSteps: 300 })
const conv = (await http('POST', `/api/bots/${bot.id}/messages`, { text: 'one' })).id
await until(() => now.threads.some((t) => t.id === conv))
await idle(conv)
// As a view does when it shows the chat, and again when the connection comes back.
await openThread(conv)
assert.deepEqual(texts(conv), ['one', 'Echo: one'])
assert.ok(now.seq > firstSeq, 'thread events move the change number on')

// 1. Away while two more turns happen and a run of a task is made and deleted.
const runTask = await http('POST', '/api/tasks', { botId: bot.id, title: 'Doomed', prompt: '!say Nothing to report.', schedule: { type: 'interval', minutes: 60 } })
await http('POST', `/api/tasks/${runTask.id}/run`)
await until(() => now.threads.some((t) => t.taskId === runTask.id && t.status === 'idle'))
const run = now.threads.find((t) => t.taskId === runTask.id)!
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
back()
await until(() => now.connected)
await openThread(conv)
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

process.exit(0)
