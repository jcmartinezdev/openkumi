// The mark a bot wears in both apps' lists (src/attention.ts): that it needs its owner, has
// something for them to read now, is at work, failed, or said something they have not read.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { build } from 'esbuild'

// Bundled as the apps bundle it, but without the store, which keeps a connection going that
// nothing here needs. What stands in for it does as `store` says, for the test of what the server is told.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-client-attention-'))
const noStore = {
  name: 'no-store',
  setup(bundling) {
    bundling.onResolve({ filter: /^\.\/store$/ }, () => ({ path: 'store', namespace: 'left-out' }))
    bundling.onLoad({ filter: /.*/, namespace: 'left-out' }, () => ({
      contents: `
        export class ApiError extends Error { constructor(status, message) { super(message); this.status = status } }
        const store = globalThis.attentionTestStore
        store.ApiError = ApiError
        export const api = (...args) => store.api(...args)
        export const assume = (...args) => store.assumed.push(args)
        export const onState = (fn) => (store.changed = fn)
        export const onEnvironmentChange = (fn) => (store.left = fn)`,
      loader: 'js',
    }))
  },
}
/** The store's stand-in: what `api` does, what was assumed, and the two things the store calls back. */
const store = (globalThis.attentionTestStore = { api: () => Promise.resolve(), assumed: [] })
let attention
before(async () => {
  const bundle = path.join(out, 'attention.mjs')
  await build({ entryPoints: [path.join(import.meta.dirname, '../src/attention.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'warning', plugins: [noStore] })
  attention = await import(bundle)
})
after(() => fs.rmSync(out, { recursive: true, force: true }))

const chat = (botId, more = {}) => ({ id: `t_${botId}`, botId, parentId: null, archivedAt: null, kind: 'chat', status: 'idle', held: false, told: 0, readTo: 0, flag: null, ...more })
const under = (parent, id, more = {}) => ({ ...chat(parent.botId), id, parentId: parent.id, kind: 'subagent', ...more })
const flag = (kind, reason) => ({ kind, reason, item: 9, at: 1 })
const browser = (...windows) => ({ running: true, headless: true, tabs: [], windows: windows.map(([threadId, request], i) => ({ id: `w${i}`, threadId, request, activeTab: null, controller: null, usedAt: 0 })) })
const waiting = (threadId, id = 1) => ({ id, threadId, message: { type: 'message', role: 'user', source: 'bot', text: 'hi' }, now: false, createdAt: 0 })
/** The mark of the bot "kumi", given its conversation and whatever else the app holds. */
const of = (threads, more = {}) => attention.attentionOf('kumi', { threads, browsers: {}, queue: [], ...more })

test('nothing: a bot nothing was said to, one whose owner has read it all, and a server from before there were marks', () => {
  assert.deepEqual(of([]), { mark: null, reason: '' })
  assert.equal(of([chat('kumi', { told: 7, readTo: 7 })]).mark, null)
  const { told, readTo, flag: _, ...older } = chat('kumi')
  assert.equal(of([older]).mark, null)
  // Another bot's conversation, and an earlier one of its own, say nothing about it.
  assert.equal(of([chat('cook', { told: 5 }), chat('kumi', { id: 't_before', archivedAt: 1, told: 5 })]).mark, null)
})

test('new: the bot said something its owner has not read', () => {
  assert.deepEqual(of([chat('kumi', { told: 8, readTo: 7 })]), { mark: 'new', reason: '' })
})

test('working and failed stand in front of new', () => {
  const kumi = chat('kumi', { told: 8, readTo: 7 })
  assert.equal(of([{ ...kumi, status: 'running' }]).mark, 'working')
  assert.equal(of([{ ...kumi, status: 'error' }]).mark, 'failed')
  // A subagent at work, at any depth, is the bot at work.
  const sub = under(kumi, 't_sub')
  assert.equal(of([kumi, sub, under(sub, 't_deeper', { status: 'running' })]).mark, 'working')
  assert.equal(of([kumi, under(chat('cook'), 't_theirs', { status: 'running' })]).mark, 'new', 'another bot\'s subagent is not')
  assert.equal(of([kumi, under(kumi, 't_failed', { status: 'error' })]).mark, 'new', 'a subagent that failed reports that to the conversation')
})

test('read this: what the bot raised for its owner to read stands in front of its being at work', () => {
  const kumi = chat('kumi', { told: 9, readTo: 7, flag: flag('read', 'Design review moved to 3 pm') })
  assert.deepEqual(of([kumi]), { mark: 'read', reason: 'Design review moved to 3 pm' })
  assert.equal(of([{ ...kumi, status: 'running' }]).mark, 'read')
  assert.equal(of([{ ...kumi, status: 'error' }]).mark, 'read')
})

test('needs you: it asked for an answer, waits in its browser, or has messages held back', () => {
  const kumi = chat('kumi', { told: 9, readTo: 9, flag: flag('answer', 'Which flight to book') })
  assert.deepEqual(of([kumi]), { mark: 'needs', reason: 'Which flight to book' })
  assert.equal(of([{ ...kumi, status: 'running' }]).mark, 'needs', 'also while it works on something else')

  // In its browser, in its conversation's window or a subagent's: that comes first, since it only waits so long.
  const sub = under(kumi, 't_sub', { status: 'running' })
  assert.deepEqual(of([kumi, sub], { browsers: { kumi: browser(['t_sub', 'Sign in to Linear']) } }), { mark: 'needs', reason: 'Sign in to Linear' })
  assert.equal(of([chat('kumi')], { browsers: { kumi: browser(['t_kumi', null]) } }).mark, null, 'a window nothing is asked in')
  assert.equal(of([chat('kumi')], { browsers: { kumi: browser(['sign-in:linear', 'Sign in']), cook: browser(['t_kumi', 'Sign in']) } }).mark, null, 'a sign-in the owner began, or another bot\'s window')
  // A server from before windows: none to look in.
  assert.equal(of([chat('kumi')], { browsers: { kumi: { running: true, headless: true, tabs: [] } } }).mark, null)

  // Messages held back, after it was stopped or failed.
  const stopped = chat('kumi', { held: true, status: 'error' })
  assert.deepEqual(of([stopped], { queue: [waiting('t_kumi')] }), { mark: 'needs', reason: 'A message is held back for it' })
  assert.equal(of([stopped], { queue: [waiting('t_kumi'), waiting('t_kumi', 2)] }).reason, '2 messages are held back for it')
  assert.equal(of([stopped], { queue: [waiting('t_cook')] }).mark, 'failed', 'what waits for another bot is not its')
  assert.equal(of([chat('kumi')], { queue: [waiting('t_kumi')] }).mark, null, 'a message that only waits its turn')
})

test('the count on the app\'s icon: the bots that need their owner, or have something for them to read', () => {
  const bots = ['kumi', 'cook', 'coach', 'scout', 'idle'].map((id) => ({ id }))
  const threads = [
    chat('kumi', { told: 3, readTo: 1 }),
    chat('cook', { flag: flag('answer', 'Go ahead?') }),
    chat('coach', { told: 3, readTo: 3, flag: flag('read', 'Rain at five') }),
    // At work: what it says when it is done will count.
    chat('scout', { status: 'running', told: 3, readTo: 1 }),
    chat('idle', { told: 3, readTo: 3 }),
  ]
  const wanted = (threads) => bots.filter((bot) => attention.wantsOwner(attention.attentionOf(bot.id, { threads, browsers: {}, queue: [] }).mark)).map((bot) => bot.id)
  assert.deepEqual(wanted(threads), ['kumi', 'cook', 'coach'])
  assert.deepEqual(wanted([]), [])
})

test('a notification is for a bot that needs its owner or has something to be read now, and for nothing else', () => {
  const kumi = { name: 'Kumi' }
  assert.deepEqual(attention.noticeOf(kumi, { mark: 'needs', reason: 'Which flight to book' }), { title: 'Kumi needs you', body: 'Which flight to book' })
  assert.deepEqual(attention.noticeOf(kumi, { mark: 'read', reason: 'Rain at five' }), { title: 'Kumi: read this', body: 'Rain at five' })
  for (const mark of ['new', 'working', 'failed', null]) assert.equal(attention.noticeOf(kumi, { mark, reason: '' }), null)
})

test('what an app tells the server it has in front of the owner: a conversation with something unread, or raised to be read', () => {
  assert.equal(attention.unread(chat('kumi', { told: 4, readTo: 3 })), true)
  assert.equal(attention.unread(chat('kumi', { told: 4, readTo: 4 })), false)
  assert.equal(attention.unread(chat('kumi', { told: 4, readTo: 4, flag: flag('read', 'Rain at five') })), true)
  assert.equal(attention.unread(chat('kumi', { told: 4, readTo: 4, flag: flag('answer', 'Go ahead?') })), false, 'reading does not answer it')
  assert.equal(attention.unread(under(chat('kumi'), 't_sub', { told: 4 })), false)
  assert.equal(attention.unread(chat('kumi', { archivedAt: 1, told: 4 })), false)
  assert.equal(attention.unread(undefined), false)
})

test('reading is told to the server, shown here at once, and said again once a server that could not be reached is back', async () => {
  const asked = []
  let answer = () => Promise.resolve()
  store.api = (method, path, body) => (asked.push(`${method} ${path} ${JSON.stringify(body)}`), answer())
  const settled = () => new Promise((resolve) => setImmediate(resolve))
  const reconnect = () => (store.changed({ connected: false }), store.changed({ connected: true }))
  const kumi = chat('kumi', { told: 9, readTo: 4, flag: flag('read', 'Rain at five') })

  // Told, and shown as read without waiting for the answer: what was raised to be read goes with it.
  store.assumed.length = 0
  await attention.markRead(kumi)
  assert.deepEqual(asked, ['POST /api/threads/t_kumi/seen {"upTo":9}'])
  assert.deepEqual(store.assumed, [['t_kumi', { readTo: 9, flag: null }]])
  reconnect()
  await settled()
  assert.equal(asked.length, 1, 'nothing is left to say')

  // The server cannot be reached: it is told when the connection is back, and only until it has heard.
  answer = () => Promise.reject(new TypeError('fetch failed'))
  await attention.markRead(chat('cook', { told: 5 }))
  answer = () => Promise.reject(new store.ApiError(503, 'Starting'))
  reconnect()
  await settled()
  answer = () => Promise.resolve()
  reconnect()
  await settled()
  reconnect()
  await settled()
  assert.deepEqual(asked.slice(1), Array(3).fill('POST /api/threads/t_cook/seen {"upTo":5}'))

  // A server that says no is not asked again: an older one keeps nothing of the kind.
  answer = () => Promise.reject(new store.ApiError(404, 'Not found'))
  await attention.markRead(chat('coach', { told: 2 }))
  reconnect()
  await settled()
  assert.equal(asked.filter((line) => line.includes('t_coach')).length, 1)

  // What could not be said to an environment that was left is not said to the next one.
  answer = () => Promise.reject(new TypeError('fetch failed'))
  await attention.markRead(chat('scout', { told: 3 }))
  store.left()
  answer = () => Promise.resolve()
  reconnect()
  await settled()
  assert.equal(asked.filter((line) => line.includes('t_scout')).length, 1)
})
