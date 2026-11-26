// The word both apps show over what may be behind (src/sync.ts): "Reconnecting…" while there is
// no connection, "Syncing…" while what changed meanwhile is on its way, and when each comes and goes.
// What the store goes through while it catches up is checked against a real server in catch-up.ts.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { build } from 'esbuild'

// Bundled without the store, which keeps a connection going that nothing here needs.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-client-syncing-'))
const noStore = {
  name: 'no-store',
  setup(bundling) {
    bundling.onResolve({ filter: /^\.\/store$/ }, () => ({ path: 'store', namespace: 'left-out' }))
    bundling.onLoad({ filter: /.*/, namespace: 'left-out' }, () => ({ contents: 'export const useStore = () => null', loader: 'js' }))
  },
}
let sync
before(async () => {
  const bundle = path.join(out, 'sync.mjs')
  await build({ entryPoints: [path.join(import.meta.dirname, '../src/sync.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'warning', plugins: [noStore] })
  sync = await import(bundle)
})
after(() => fs.rmSync(out, { recursive: true, force: true }))

const standing = (more = {}) => ({ connected: true, loaded: true, syncing: false, catchingUp: {}, ...more })

test('how things stand: up to date, reconnecting, the list catching up, and the chat on screen catching up', () => {
  assert.equal(sync.syncOf(standing()), null)
  assert.equal(sync.syncOf(standing({ connected: false })), 'reconnecting')
  // Nothing has come yet, from the server or a copy on the device: the screen says so itself.
  assert.equal(sync.syncOf(standing({ connected: false, loaded: false })), 'connecting')
  // The socket is open again, and what changed meanwhile is being asked for.
  assert.equal(sync.syncOf(standing({ connected: false, syncing: true })), 'syncing')
  assert.equal(sync.syncOf(standing({ catchingUp: { t1: true } }), 't1'), 'syncing')
  // Another chat catching up is not this view's business, nor any chat's for a view that shows none.
  assert.equal(sync.syncOf(standing({ catchingUp: { t2: true } }), 't1'), null)
  assert.equal(sync.syncOf(standing({ catchingUp: { t1: true } })), null)
  // Left over from before a drop: with no connection, reconnecting is what is said.
  assert.equal(sync.syncOf(standing({ connected: false, catchingUp: { t1: true } }), 't1'), 'reconnecting')
})

test('when the word comes and goes: syncing waits a moment before it is shown, and reconnecting or syncing a moment before it goes', () => {
  const { nextSync, SHOW_AFTER, HOLD } = sync
  assert.deepEqual(nextSync(null, null), { show: null, after: 0 })
  // Reconnecting is said at once, as it always was.
  assert.deepEqual(nextSync(null, 'reconnecting'), { show: 'reconnecting', after: 0 })
  assert.deepEqual(nextSync('syncing', 'reconnecting'), { show: 'reconnecting', after: 0 })
  // Catching up that is over quickly (on this computer, or nearby) is never shown, whatever was up before it.
  assert.deepEqual(nextSync(null, 'syncing'), { show: 'syncing', after: SHOW_AFTER })
  assert.deepEqual(nextSync('reconnecting', 'syncing'), { show: 'syncing', after: SHOW_AFTER })
  // Between the list catching up and the chat on screen there is a moment with nothing going on: the word stays through it.
  assert.deepEqual(nextSync('syncing', null), { show: null, after: HOLD })
  assert.deepEqual(nextSync('reconnecting', null), { show: null, after: HOLD })
  // The screen "Connecting…" was said over gives way to what came: nothing is left over it.
  assert.deepEqual(nextSync('connecting', null), { show: null, after: 0 })
  assert.deepEqual(nextSync('syncing', 'syncing'), { show: 'syncing', after: 0 })
})

/**
 * What a view shows over time, drawn as useSync draws it: the effect runs again when how things
 * stand or what is shown changes, which drops the wait it had set. `steps` are [ms, how things
 * stand], from 0. Returns what is shown at each millisecond up to `end`.
 */
function replay(steps, end) {
  const { nextSync } = sync
  let now = null
  let shown = null
  let ran = null
  let wait = null
  const seen = []
  for (let t = 0; t <= end; t++) {
    for (const [at, next] of steps) if (at === t) now = next
    if (wait && t >= wait.due) (shown = wait.show), (wait = null)
    while (!ran || ran.now !== now || ran.shown !== shown) {
      ran = { now, shown }
      wait = null
      const { show, after } = nextSync(shown, now)
      if (show === shown) break
      if (after) wait = { due: t + after, show }
      else shown = show
    }
    seen.push(nextSync(shown, now).after ? shown : now)
  }
  return seen
}
const words = (seen) => seen.filter((w, i) => w !== seen[i - 1])

test('a quick reconnect: "Reconnecting…" until the chat on screen has caught up, and never "Syncing…"', () => {
  // Gone at 0; back at 1000: what changed meanwhile comes by 1100, the chat on screen asks at 1110 and has it by 1300.
  const seen = replay([[0, 'reconnecting'], [1000, 'syncing'], [1100, null], [1110, 'syncing'], [1300, null]], 2000)
  assert.deepEqual(words(seen), ['reconnecting', null])
  assert.equal(seen[1290], 'reconnecting')
  assert.equal(seen[1300 + sync.HOLD], null)
})

test('a slow reconnect: "Reconnecting…", then "Syncing…" through both catching up, without a blink between them', () => {
  const seen = replay([[0, 'reconnecting'], [1000, 'syncing'], [3000, null], [3010, 'syncing'], [5000, null]], 6000)
  assert.deepEqual(words(seen), ['reconnecting', 'syncing', null])
  assert.equal(seen[1000 + sync.SHOW_AFTER - 1], 'reconnecting')
  assert.equal(seen[1000 + sync.SHOW_AFTER], 'syncing')
  assert.equal(seen[5000 + sync.HOLD], null)
})

test('the first connection says "Connecting…" while there is nothing to show, and leaves nothing behind once there is', () => {
  // The store does not count the first load as syncing (see opened() in store.ts).
  const seen = replay([[0, 'connecting'], [700, null]], 1000)
  assert.deepEqual(words(seen), ['connecting', null])
  assert.equal(seen[700], null)
})

test('a chat that catches up quickly while connected shows nothing', () => {
  const seen = replay([[100, 'syncing'], [400, null]], 1000)
  assert.deepEqual(words(seen), [null])
})

test('the words', () => {
  assert.deepEqual(sync.SYNC_WORDS, { connecting: 'Connecting…', reconnecting: 'Reconnecting…', syncing: 'Syncing…' })
})
