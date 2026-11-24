// The order both apps list the bots in (src/bots.ts): as they were made, the one last talked with
// first, or the owner's own order.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { build } from 'esbuild'

// Bundled as the apps bundle it, but without the store, which keeps a connection going that
// nothing here needs.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-client-bots-'))
const noStore = {
  name: 'no-store',
  setup(bundling) {
    bundling.onResolve({ filter: /^\.\/store$/ }, () => ({ path: 'store', namespace: 'left-out' }))
    bundling.onLoad({ filter: /.*/, namespace: 'left-out' }, () => ({ contents: 'export const saveSettings = () => {}; export const useStore = () => {}', loader: 'js' }))
  },
}
let bots
before(async () => {
  const bundle = path.join(out, 'bots.mjs')
  await build({ entryPoints: [path.join(import.meta.dirname, '../src/bots.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'warning', plugins: [noStore] })
  bots = await import(bundle)
})
after(() => fs.rmSync(out, { recursive: true, force: true }))

// As the server sends them: in the order they were made.
const made = [
  { id: 'kumi', createdAt: 100 },
  { id: 'cook', createdAt: 200 },
  { id: 'coach', createdAt: 300 },
  { id: 'scout', createdAt: 400 },
]
const chat = (botId, updatedAt, more = {}) => ({ id: `t_${botId}_${updatedAt}`, botId, parentId: null, archivedAt: null, updatedAt, ...more })
const ids = (list) => list.map((bot) => bot.id)

test('as they were made, which is also what a server from before there was a choice gets', () => {
  assert.equal(bots.sortBots(made, [], 'created'), made)
  assert.equal(bots.sortBots(made, [chat('scout', 900)], undefined), made)
})

test('last message: the conversation something last happened in comes first', () => {
  const threads = [
    chat('kumi', 500),
    chat('coach', 900),
    // Neither a subagent at work nor an earlier conversation counts: the time beside a bot is its conversation's.
    chat('cook', 2000, { parentId: 't_cook_600' }),
    chat('cook', 600),
    chat('kumi', 3000, { archivedAt: 3000 }),
  ]
  assert.deepEqual(ids(bots.sortBots(made, threads, 'recent')), ['coach', 'cook', 'kumi', 'scout'])
  assert.deepEqual(ids(made), ['kumi', 'cook', 'coach', 'scout'], 'the list it was given is left as it was')
})

test('last message: a bot nothing was said to yet goes by when it was made', () => {
  assert.deepEqual(ids(bots.sortBots(made, [chat('kumi', 350)], 'recent')), ['scout', 'kumi', 'coach', 'cook'])
})

test('their own order: bots it does not name come after, as they were made, and bots that are gone are passed over', () => {
  assert.deepEqual(ids(bots.sortBots(made, [], 'manual', ['coach', 'gone', 'kumi'])), ['coach', 'kumi', 'cook', 'scout'])
  assert.deepEqual(ids(bots.sortBots(made, [], 'manual', [])), ids(made))
  assert.deepEqual(ids(bots.sortBots(made, [], 'manual')), ids(made))
})

test('moving a bot puts it at that place of the list as it then is', () => {
  const list = ['a', 'b', 'c', 'd']
  assert.deepEqual(bots.moved(list, 'a', 2), ['b', 'c', 'a', 'd'])
  assert.deepEqual(bots.moved(list, 'd', 0), ['d', 'a', 'b', 'c'])
  assert.deepEqual(bots.moved(list, 'b', 1), list)
  assert.deepEqual(bots.moved(list, 'b', 99), ['a', 'c', 'd', 'b'])
  assert.deepEqual(bots.moved(list, 'c', -1), ['c', 'a', 'b', 'd'])
})
