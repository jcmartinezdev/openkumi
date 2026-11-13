// Run by sync.test.mjs, in a process of its own for each start of the app, against one server,
// with a shelf kept in a file between the starts:
//   first   pairs, opens a chat, and leaves a copy behind
//   second  starts with the server out of reach: the copy is shown; then it connects and catches up
//   third   the server's database was started afresh: the copy is not taken for it
// Arguments: which start, the server's data folder, its port, and a folder for the shelf.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createConnection } from '../src/connection'
import { useRandom } from '../src/addresses'
import { type Shelf, keepCopies, saveCopyNow } from '../src/copies'
import { pair } from '../src/pair'
import { follow, onState, openThread, receive, useTransport, type State } from '../src/store'

const [mode, home, port, dir] = process.argv.slice(2)
const base = `http://127.0.0.1:${port}`
const owner = () => JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).accessToken
const http = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(base + url, { method, headers: { Authorization: `Bearer ${owner()}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${url}: ${json.error}`)
  return json
}
const random = () => crypto.getRandomValues(new Uint8Array(16))
useRandom(random)

// A shelf in a file, read when the app starts, written after every change.
const file = path.join(dir, 'shelf.json')
const kept: Record<string, string> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}
const write = () => fs.writeFileSync(file, JSON.stringify(kept))
const writes: string[][] = []
const shelf: Shelf = {
  async get(keys) {
    return keys.map((k) => kept[k] ?? null)
  },
  async set(entries) {
    writes.push(entries.map(([k, v]) => (v === null ? `-${k}` : k)))
    for (const [k, v] of entries) v === null ? delete kept[k] : (kept[k] = v)
    write()
  },
  async clear(prefix) {
    for (const k of Object.keys(kept)) if (k.startsWith(prefix)) delete kept[k]
    write()
  },
  async keys(prefix) {
    return Object.keys(kept).filter((k) => k.startsWith(prefix))
  },
}

let now: State
onState((s) => (now = s))
keepCopies(shelf)
useTransport(createConnection(receive, () => {}))
async function until(check: () => unknown, ms = 20_000) {
  const end = Date.now() + ms
  for (;;) {
    if (check()) return
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 30))
  }
}
const texts = (id: string) => (now.items[id] ?? []).map((i) => (i.data as any).text ?? i.data.type)
const idleOnServer = async (id: string) => {
  for (;;) {
    if ((await http('GET', `/api/threads/${id}`)).thread.status === 'idle') return
    await new Promise((r) => setTimeout(r, 30))
  }
}
const linkFile = path.join(dir, 'link.json')

if (mode === 'first') {
  const { code } = await http('POST', '/api/pairing')
  const { key, serverId } = await pair(base, code, 'Check', random)
  const link = { id: 'remote', name: 'Mini', addresses: [base], token: key, local: false, serverId }
  fs.writeFileSync(linkFile, JSON.stringify(link))
  follow(link)
  await until(() => now?.connected)
  const bot = await http('POST', '/api/bots', { name: 'Keeper', provider: 'mock' })
  const conv = (await http('POST', `/api/bots/${bot.id}/messages`, { text: 'remember herons' })).id
  await idleOnServer(conv)
  await until(() => now.threads.some((t) => t.id === conv && t.status === 'idle'))
  await openThread(conv)
  assert.deepEqual(texts(conv), ['remember herons', 'Echo: remember herons'])
  await until(() => kept[`remote/thread/${conv}`] && JSON.parse(kept['remote/state']).seq === now.seq, 15_000)
  fs.writeFileSync(path.join(dir, 'conv'), conv)
}

if (mode === 'second') {
  const link = JSON.parse(fs.readFileSync(linkFile, 'utf8'))
  const conv = fs.readFileSync(path.join(dir, 'conv'), 'utf8')
  // Something is said while the app is closed.
  await http('POST', `/api/threads/${conv}/messages`, { text: 'and egrets' })
  await idleOnServer(conv)
  // Starts out of reach: the copy is what is shown.
  follow({ ...link, addresses: ['http://127.0.0.1:9'] })
  await until(() => now?.loaded)
  assert.equal(now.connected, false)
  assert.ok(now.threads.some((t) => t.id === conv), 'the list comes from the copy')
  assert.ok(now.bots.some((b) => b.name === 'Keeper'))
  assert.equal(now.items[conv], undefined, 'a chat is read from the copy only when it is opened')
  await openThread(conv)
  assert.deepEqual(texts(conv), ['remember herons', 'Echo: remember herons'], 'readable while away')
  const keptFirst = now.items[conv]![0]
  // Back in reach: only what changed comes, and the open chat catches up from what it holds.
  const seqBefore = now.seq
  follow(link)
  await until(() => now.connected)
  assert.ok(now.seq > seqBefore)
  await openThread(conv)
  assert.deepEqual(texts(conv), ['remember herons', 'Echo: remember herons', 'and egrets', 'Echo: and egrets'])
  assert.equal(now.items[conv]![0], keptFirst, 'what the copy held is kept, not fetched again')
  await saveCopyNow()
  await until(() => JSON.parse(kept[`remote/thread/${conv}`]).items.length === 4, 15_000)
}

if (mode === 'third') {
  const link = JSON.parse(fs.readFileSync(linkFile, 'utf8'))
  const conv = fs.readFileSync(path.join(dir, 'conv'), 'utf8')
  const old = JSON.parse(kept['remote/state']).database
  follow(link)
  await until(() => now?.connected)
  assert.notEqual(now.database, old, 'the server started a new database')
  assert.ok(!now.threads.some((t) => t.id === conv), 'the old list is gone')
  await until(() => JSON.parse(kept['remote/state'] ?? '{}').database === now.database, 15_000)
  assert.equal(kept[`remote/thread/${conv}`], undefined, 'and so is the old chat')
}
process.exit(0)
