// Run by sync.test.mjs, in a process of its own: the superpower catalog is not part of what the
// store is sent as it connects. A view that shows it has it fetched, and while one does, a change
// is fetched again, as is what changed while the connection was away. Arguments: the server's data
// folder, then its port.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createConnection } from '../src/connection'
import { follow, onState, receive, showCatalog, useTransport, type State } from '../src/store'

const [home, port] = process.argv.slice(2)
const base = `http://127.0.0.1:${port}`
const data = path.join(home, 'people', JSON.parse(fs.readFileSync(path.join(home, 'people.json'), 'utf8'))[0].name)
const token = JSON.parse(fs.readFileSync(path.join(data, 'auth.json'), 'utf8')).accessToken
const http = async (method: string, url: string, body?: unknown) => {
  const res = await realFetch(base + url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  const json = await res.json()
  if (!res.ok) throw new Error(`${method} ${url}: ${json.error}`)
  return json
}

// Counts what the store asks the server for. `cutOff` has the next answer for the catalog arrive cut short.
const asked: string[] = []
const realFetch = globalThis.fetch
let cutOff = false
globalThis.fetch = (input, init) => {
  const url = String(input).slice(base.length)
  asked.push(url)
  if (cutOff && url === '/api/superpowers/catalog') {
    cutOff = false
    return Promise.resolve(new Response('{"superpowers":[{"id":"wea', { status: 200 }))
  }
  return realFetch(input, init)
}
const catalogAsks = () => asked.filter((url) => url === '/api/superpowers/catalog').length

let now: State
onState((s) => (now = s))
const link = { id: 'catalog', name: 'catalog', addresses: [base], token, local: true } as any
// Counts the server's word that the catalog changed, as it reaches the store.
let changes = 0
useTransport(
  createConnection((report) => {
    if (report.type === 'events') changes += report.events.filter((e) => e.type === 'superpowers.changed').length
    receive(report)
  }, () => {}),
)
follow(link)

async function until(check: () => unknown, ms = 20_000) {
  const end = Date.now() + ms
  for (;;) {
    if (check()) return
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}
const settle = () => new Promise((r) => setTimeout(r, 300))
const weather = () => now.superpowers.find((p) => p.id === 'weather')
const bot = (await http('GET', '/api/state')).bots[0]
const turn = (on: boolean) => http('PUT', `/api/bots/${bot.id}/superpowers/weather`, { on })

await until(() => now?.connected)
assert.ok(asked.some((url) => url.startsWith('/api/state?without=superpowers')), 'the state is asked for without the catalog')
assert.deepEqual([now.superpowers, now.superpowersLoaded], [[], false], 'which does not come with it')
await settle()
assert.equal(catalogAsks(), 0, 'nor is it fetched while nothing shows it')

// 1. A view that shows the catalog has it fetched. The first answer is cut short: it is asked for again.
cutOff = true
const hide = showCatalog()
await until(() => catalogAsks() === 1)
await settle()
assert.deepEqual([now.superpowers, now.superpowersLoaded], [[], false], 'an answer cut short is not taken for the catalog')
await until(() => now.superpowersLoaded)
assert.ok(weather() && now.superpowerCategories.includes('Everyday'))
assert.equal(catalogAsks(), 2)

// 2. A second view, while the first is there: what is held is up to date, so it is not fetched again.
const hideSecond = showCatalog()
await settle()
assert.equal(catalogAsks(), 2)

// 3. A change while it is shown is fetched at once: the weather is switched on for a bot.
await turn(true)
await until(() => weather()?.onFor.includes(bot.id))
assert.equal(catalogAsks(), 3)

// 4. Once nothing shows it, a change is not fetched; the next view to be shown fetches it.
hide()
hideSecond()
hideSecond()
const told = changes
await turn(false)
await until(() => changes > told)
await settle()
assert.equal(catalogAsks(), 3, 'not fetched while nothing shows it')
assert.ok(weather()?.onFor.includes(bot.id), 'so what is held is as it was')
const hideThird = showCatalog()
await until(() => !weather()?.onFor.includes(bot.id))
assert.equal(catalogAsks(), 4)

// 5. What changed while the connection was away is fetched once it is back, while a view shows it.
follow({ ...link, addresses: ['http://127.0.0.1:9'] })
await until(() => !now.connected)
await turn(true)
follow(link)
await until(() => now.connected && weather()?.onFor.includes(bot.id))
assert.equal(catalogAsks(), 5)
hideThird()

// 6. Another environment holds nothing of this one's catalog.
follow(null)
assert.deepEqual([now.superpowers, now.superpowersLoaded], [[], false])

await turn(false)
process.exit(0)
