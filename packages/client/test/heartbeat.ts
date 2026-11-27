// Run by sync.test.mjs, in a process of its own: a connection that dies without closing, as a
// phone's does in a pocket or a computer's while it sleeps. The store reaches the server through a
// relay here that can stop passing anything on while keeping the connection open. The store has
// to notice by itself, connect again and catch up. Arguments: the server's data folder, then its port.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createConnection } from '../src/connection'
import { follow, onState, receive, recheck, useTransport, type State } from '../src/store'

const [home, port] = process.argv.slice(2)
const data = path.join(home, 'people', JSON.parse(fs.readFileSync(path.join(home, 'people.json'), 'utf8'))[0].name)
const token = JSON.parse(fs.readFileSync(path.join(data, 'auth.json'), 'utf8')).accessToken
const http = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${url}: ${json.error}`)
  return json
}

// The relay. `freeze` leaves every connection through it open but passes nothing more on either way.
const open = new Set<{ from: net.Socket; to: net.Socket; frozen: boolean }>()
const relay = net.createServer((from) => {
  const to = net.connect(Number(port), '127.0.0.1')
  const pair = { from, to, frozen: false }
  open.add(pair)
  from.on('data', (d) => pair.frozen || to.write(d))
  to.on('data', (d) => pair.frozen || from.write(d))
  const end = () => (open.delete(pair), from.destroy(), to.destroy())
  from.on('close', end).on('error', end)
  to.on('close', end).on('error', end)
})
await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve))
const freeze = () => open.forEach((pair) => (pair.frozen = true))
const base = `http://127.0.0.1:${(relay.address() as net.AddressInfo).port}`

// The pings each socket reads, which the store's connection does not pass on: the last socket's.
let latest = { pings: 0 }
const Native = globalThis.WebSocket
globalThis.WebSocket = class extends Native {
  constructor(...args: ConstructorParameters<typeof Native>) {
    super(...args)
    const mine = { pings: 0 }
    latest = mine
    this.addEventListener('message', (e) => typeof e.data === 'string' && JSON.parse(e.data).type === 'ping' && mine.pings++)
  }
} as typeof WebSocket

let now: State
const seen: State[] = []
onState((s) => ((now = s), seen.push(s)))
// Quieter for less long than an app waits, so that this does not take minutes.
const QUIET = 3000
useTransport(createConnection(receive, () => {}, { quiet: QUIET, answer: 600 }))
follow({ id: 'heartbeat', name: 'heartbeat', addresses: [base], token, local: true } as any)

async function until(check: () => unknown, ms = 20_000) {
  const end = Date.now() + ms
  for (;;) {
    if (check()) return
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}
const dropped = (from: number) => seen.slice(from).some((s) => !s.connected)

await until(() => now?.connected)
// The ping the server sends as the connection opens: only a server that sent one is asked.
await until(() => latest.pings > 0)

// 1. A connection that is there stays: asked when the app comes back to the front, it answers.
let mark = seen.length
const before = latest.pings
recheck()
await until(() => latest.pings > before)
await new Promise((r) => setTimeout(r, 1000))
assert.ok(!dropped(mark), 'a connection that answers is kept')

// 2. It dies without closing while something happens. With nothing else to go on, the store notices
// once it has been quiet for a while and nothing answers, connects again, and catches up.
mark = seen.length
freeze()
const bot = await http('POST', '/api/bots', { name: 'Made while away', provider: 'mock' })
await until(() => dropped(mark), QUIET + 5000)
await until(() => now.connected && now.bots.some((b) => b.id === bot.id), 10_000)

// 3. The same, but the app comes back to the front: it asks at once rather than wait for the quiet.
await until(() => latest.pings > 0)
mark = seen.length
freeze()
const asked = Date.now()
recheck()
await until(() => dropped(mark), QUIET)
assert.ok(Date.now() - asked < QUIET, `noticed in ${Date.now() - asked} ms, before the quiet alone would have`)
await until(() => now.connected, 10_000)

await http('DELETE', `/api/bots/${bot.id}`)
process.exit(0)
