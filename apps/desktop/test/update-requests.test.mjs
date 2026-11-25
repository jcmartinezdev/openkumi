// When the app restarts into its new version because a server it runs was asked to update
// (src/updateAsked.ts): only once it has that version, only once no bot is at work in any of its
// servers unless whoever asked said not to wait, and never before the request has been answered.
// The app around it is played here: its update, its servers and the channel to each.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startUpdateRequests } from '../src/updateAsked.ts'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** An app with two servers, whose update starts as `begin`, and whose look for a newer version does what `look` says. */
function app(begin = 'ready', look = async () => {}) {
  let update = { state: begin, version: begin === 'ready' ? '9.9.9' : null, progress: 0, error: '', checkedAt: 0 }
  const changes = []
  let hear = () => {}
  const said = { a: [], b: [] }
  const working = { a: 0, b: 0 }
  const restarts = []
  const it = {
    said,
    restarts,
    set(patch) {
      update = { ...update, ...patch }
      for (const fn of changes) fn()
    },
    /** A server says how many of its bots are at work. */
    working(server, n) {
      working[server] = n
      hear(server, { type: 'working', working: n })
    },
    /** A server is asked to update, and passes it on; resolves with the app's answer. */
    async ask(server, now = false) {
      const id = Math.floor(Math.random() * 1e9)
      hear(server, { type: 'update', id, now })
      for (let i = 0; i < 100; i++) {
        const answer = said[server].findIndex((m) => m.type === 'updated' && m.id === id)
        if (answer >= 0) return said[server].slice(0, answer).filter((m) => m.type === 'app-update').at(-1)
        await wait(20)
      }
      throw new Error('not answered')
    },
  }
  startUpdateRequests({
    state: () => update,
    check: () => look(it),
    onChange: (fn) => changes.push(fn),
    servers: () => ['a', 'b'],
    workingIn: (server) => working[server],
    tell: (server, message) => said[server].push(message),
    onMessage: (fn) => (hear = fn),
    restart: () => restarts.push(Date.now()),
    answerMs: 50,
  })
  return it
}

test('with the new version downloaded and no bot at work, the app restarts into it, once the request is answered', async () => {
  const it = app('ready')
  const told = await it.ask('a')
  // The server reports it as in place before it answers.
  assert.equal(told.asked, true)
  assert.equal(told.update.state, 'ready')
  assert.equal(it.restarts.length, 0)
  await wait(150)
  assert.equal(it.restarts.length, 1)
})

test('bots at work in any of the servers hold the restart off until they are done, and each server hears of the others’', async () => {
  const it = app('ready')
  it.working('a', 2)
  it.working('b', 1)
  await it.ask('a')
  await wait(150)
  assert.equal(it.restarts.length, 0)
  assert.equal(it.said.a.filter((m) => m.type === 'app-update').at(-1).elsewhere, 1)
  assert.equal(it.said.b.filter((m) => m.type === 'app-update').at(-1).elsewhere, 2)
  it.working('a', 0)
  await wait(150)
  assert.equal(it.restarts.length, 0)
  it.working('b', 0)
  await wait(150)
  assert.equal(it.restarts.length, 1)
})

test('a bot that is done and hands on to another at once (a report, an automation’s result) is not taken for none at work', async () => {
  const it = app('ready')
  it.working('a', 1)
  await it.ask('a')
  // The count goes through 0 on the way from one to the next.
  it.working('a', 0)
  it.working('a', 1)
  await wait(150)
  assert.equal(it.restarts.length, 0)
  it.working('a', 0)
  await wait(150)
  assert.equal(it.restarts.length, 1)
})

test('asked not to wait, it restarts with bots at work; that holds for this request only', async () => {
  const hurried = app('ready')
  hurried.working('b', 3)
  await hurried.ask('a', true)
  await wait(150)
  assert.equal(hurried.restarts.length, 1)

  // A "now" that found nothing newer is not kept for a version that turns up later.
  const later = app('none', async (it) => {
    it.set({ state: 'checking' })
    it.set({ state: 'none', checkedAt: Date.now() })
  })
  later.working('a', 1)
  await later.ask('a', true)
  later.set({ state: 'downloading', version: '9.9.9' })
  later.set({ state: 'ready' })
  await wait(150)
  assert.equal(later.restarts.length, 0)
})

test('without the new version yet, it looks for it and fetches it first, and answers once it has it', async () => {
  const it = app('none', async (it) => {
    it.set({ state: 'checking' })
    it.set({ state: 'downloading', version: '9.9.9' })
    // The download goes on after the look has answered.
    setTimeout(() => it.set({ state: 'ready', progress: 100 }), 300)
  })
  const told = await it.ask('b')
  assert.equal(told.update.state, 'ready')
  assert.equal(it.restarts.length, 0)
  await wait(150)
  assert.equal(it.restarts.length, 1)
})

test('nothing newer, a download that fails, or an app that does not update itself: no restart, then or later', async () => {
  const nothing = app('none', async (it) => it.set({ state: 'none', checkedAt: Date.now() }))
  assert.equal((await nothing.ask('a')).asked, false)
  // A version found by a later look of the app's own is not restarted into: nobody asked for that one.
  nothing.set({ state: 'ready', version: '9.9.9' })
  await wait(150)
  assert.equal(nothing.restarts.length, 0)

  const fails = app('none', async (it) => {
    it.set({ state: 'downloading', version: '9.9.9' })
    it.set({ state: 'failed', error: 'The download was cut short.' })
  })
  const told = await fails.ask('a')
  assert.equal(told.asked, false)
  assert.equal(told.update.error, 'The download was cut short.')
  await wait(150)
  assert.equal(fails.restarts.length, 0)

  const unable = app('unsupported')
  assert.equal((await unable.ask('a')).asked, false)
  await wait(150)
  assert.equal(unable.restarts.length, 0)
})
