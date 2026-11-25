// What the phone app shows in a car (src/car.ts): the bots to call, the call, and what it says
// when there is nothing to call.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { build } from 'esbuild'

// Bundled as the apps bundle it, but without the store, which keeps a connection going that
// nothing here needs.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-client-car-'))
const noStore = {
  name: 'no-store',
  setup(bundling) {
    bundling.onResolve({ filter: /^\.\/store$/ }, () => ({ path: 'store', namespace: 'left-out' }))
    bundling.onLoad({ filter: /.*/, namespace: 'left-out' }, () => ({ contents: 'export const saveSettings = () => {}; export const useStore = () => {}', loader: 'js' }))
  },
}
let car
before(async () => {
  const bundle = path.join(out, 'car.mjs')
  await build({ entryPoints: [path.join(import.meta.dirname, '../src/car.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'warning', plugins: [noStore] })
  car = await import(bundle)
})
after(() => fs.rmSync(out, { recursive: true, force: true }))

const look = { creature: 'bear', color: 'mint', hat: 'none', extra: 'none', clothes: 'purple' }
const kumi = { id: 'kumi', name: 'Kumi', emoji: '🤖', look, createdAt: 100 }
const cook = { id: 'cook', name: 'Cook', emoji: '🍳', look: { ...look, hat: 'chef' }, createdAt: 200 }
const off = { phase: 'off', botId: '', id: '', muted: false, since: 0, error: '', denied: false, last: '' }
/** A phone that is paired, connected, and whose computer can make calls. */
const known = (more = {}, state = {}) => ({
  server: { name: 'Mac mini' },
  ready: true,
  locked: false,
  calling: off,
  said: null,
  ...more,
  state: { bots: [kumi, cook], threads: [], settings: {}, calls: { available: true, reason: '' }, call: null, loaded: true, connected: true, refused: false, outdated: false, newer: false, failures: 0, ...state },
})

test('the bots are the rows, in the order the phone lists them, each with its face', () => {
  const screen = car.carScreen(known())
  assert.deepEqual(screen.rows.map((row) => [row.id, row.title, row.emoji, row.detail]), [['kumi', 'Kumi', '🤖', ''], ['cook', 'Cook', '🍳', '']])
  assert.equal(screen.rows[0].picture, 'bear.mint.none.none.purple')
  assert.notEqual(screen.rows[0].picture, screen.rows[1].picture)
  assert.equal(screen.call, null)
  assert.equal(screen.alert, null)
  assert.equal(screen.note, '')

  const mine = car.carScreen(known({}, { settings: { botSort: 'manual', botOrder: ['cook', 'kumi'] } }))
  assert.deepEqual(mine.rows.map((row) => row.id), ['cook', 'kumi'])
})

test('a bot from before bots had looks still has a name for its face', () => {
  assert.equal(car.faceOf(undefined), 'none')
})

test('without a list there is a note saying why, and no row to tap', () => {
  const says = (more, state) => {
    const screen = car.carScreen(known(more, state))
    assert.deepEqual(screen.rows, [])
    assert.equal(screen.call, null)
    return [screen.note, screen.busy]
  }
  assert.deepEqual(says({ locked: true, ready: false }), ['Unlock your iPhone', false])
  assert.deepEqual(says({ ready: false }), ['', true])
  assert.deepEqual(says({ server: null }), ['Pair your iPhone first', false])
  assert.deepEqual(says({}, { refused: true }), ['Mac mini no longer lets this iPhone in', false])
  assert.deepEqual(says({}, { outdated: true }), ['Mac mini needs an update', false])
  assert.deepEqual(says({}, { newer: true }), ['Update OpenKumi on your iPhone', false])
  assert.deepEqual(says({}, { loaded: false, connected: false }), ['Connecting…', true])
  assert.deepEqual(says({}, { loaded: false, connected: false, failures: 3 }), ['Mac mini cannot be reached', true])
  // The bots the phone kept from last time cannot be called while their computer is away.
  assert.deepEqual(says({}, { connected: false, failures: 2 }), ['Mac mini cannot be reached', true])
  assert.deepEqual(says({}, { bots: [] }), ['No bots yet', false])
  const none = car.carScreen(known({}, { calls: { available: false, reason: 'Sign in to Codex with ChatGPT.' } }))
  assert.deepEqual([none.note, none.noteDetail, none.rows.length], ['Calls are not set up', 'Sign in to Codex with ChatGPT.', 0])
})

test('a call from this phone shows over the list, and says how it stands', () => {
  const on = (calling, call = null) => car.carScreen(known({ calling: { ...off, botId: 'cook', ...calling } }, { call })).call
  assert.deepEqual(on({ phase: 'asking' }), { id: 'cook', name: 'Cook', state: 'calling', picture: 'bear.mint.chef.none.purple', emoji: '🍳' })
  assert.equal(on({ phase: 'connecting' }).state, 'calling')
  assert.equal(on({ phase: 'live', id: 'c1' }, { id: 'c1', botId: 'cook', working: 0 }).state, 'listening')
  assert.equal(on({ phase: 'live', id: 'c1' }, { id: 'c1', botId: 'cook', working: 2 }).state, 'working')
  assert.equal(on({ phase: 'live', id: 'c1', muted: true }, { id: 'c1', botId: 'cook', working: 2 }).state, 'muted')
  // Work counted for another call is not this one's.
  assert.equal(on({ phase: 'live', id: 'c2' }, { id: 'c1', botId: 'cook', working: 2 }).state, 'listening')
  // The list stays under it.
  assert.equal(car.carScreen(known({ calling: { ...off, phase: 'live', botId: 'cook' } })).rows.length, 2)
})

test('a call stays on the screen, with the way to end it, while the computer cannot be reached', () => {
  // The call's sound goes its own way: leaving the Wi-Fi at home drops the connection to the computer, not the call.
  const away = car.carScreen(known({ calling: { ...off, phase: 'live', botId: 'cook', id: 'c1', muted: true } }, { connected: false, failures: 2 }))
  assert.equal(away.note, 'Mac mini cannot be reached')
  assert.deepEqual(away.rows, [])
  assert.deepEqual(away.call, { id: 'cook', name: 'Cook', state: 'muted', picture: 'bear.mint.chef.none.purple', emoji: '🍳' })
  // A bot the phone does not know (yet) is still a call to end.
  const unknown = car.carScreen(known({ calling: { ...off, phase: 'connecting', botId: 'gone' } }))
  assert.deepEqual(unknown.call, { id: 'gone', name: 'Your bot', state: 'calling', picture: 'none', emoji: '' })
})

test('a call made from another device is said on its bot\'s row, but not the one just hung up here', () => {
  const elsewhere = car.carScreen(known({}, { call: { id: 'c9', botId: 'cook', working: 0 } }))
  assert.deepEqual(elsewhere.rows.map((row) => row.detail), ['', 'On a call on another device'])
  assert.equal(elsewhere.call, null)
  const justEnded = car.carScreen(known({ calling: { ...off, last: 'c9' } }, { call: { id: 'c9', botId: 'cook', working: 0 } }))
  assert.deepEqual(justEnded.rows.map((row) => row.detail), ['', ''])
})

test('a call that ended by itself says why, until it is dismissed', () => {
  const ended = car.carScreen(known({ calling: { ...off, error: 'The connection for the call was lost.' } }))
  assert.deepEqual(ended.alert, { id: 'ended', titles: ['The call ended. The connection for the call was lost.', 'The call ended'] })
  assert.equal(ended.rows.length, 2)
  const refused = car.carScreen(known({ calling: { ...off, error: 'OpenKumi is not allowed to use the microphone.', denied: true } }))
  assert.equal(refused.alert.id, 'ended')
  assert.match(refused.alert.titles[0], /Allow it in Settings on your iPhone/)
  // It is said over a note too.
  assert.equal(car.carScreen(known({ calling: { ...off, error: 'x' } }, { connected: false })).alert.id, 'ended')
})

test('what else there is to say shows unless a call has something to say', () => {
  const said = { id: 'microphone', titles: ['a', 'b'] }
  assert.equal(car.carScreen(known({ said })).alert, said)
  assert.equal(car.carScreen(known({ said, calling: { ...off, error: 'Lost.' } })).alert.id, 'ended')
})

test('a call is only made from the car once the phone may listen', () => {
  assert.equal(car.microphoneAlert('granted'), null)
  assert.match(car.microphoneAlert('denied').titles[0], /Settings/)
  // Not asked yet: the phone asks on its own screen, which nobody sees in a car.
  assert.match(car.microphoneAlert('prompt').titles[0], /once/)
  assert.ok(car.microphoneAlert('denied').titles.every((title, i, all) => i === 0 || title.length < all[i - 1].length))
})
