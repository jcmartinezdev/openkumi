// What both apps' usage pages are built on (src/usage.ts): adding up what the server counted, the
// columns of the chart, and how numbers are worded. The server's side is tested in its own tests.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { build } from 'esbuild'

// The file is bundled as the apps bundle it, but without the store it fetches through: that one
// keeps a connection going, which nothing here needs and which would keep this test from ending.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-client-usage-'))
const noStore = {
  name: 'no-store',
  setup(bundling) {
    bundling.onResolve({ filter: /^\.\/store$/ }, () => ({ path: 'store', namespace: 'left-out' }))
    bundling.onLoad({ filter: /.*/, namespace: 'left-out' }, () => ({ contents: 'export const api = () => {}; export const useStore = () => {}; export class ApiError extends Error {}', loader: 'js' }))
  },
}
let usage
before(async () => {
  const bundle = path.join(out, 'usage.mjs')
  await build({ entryPoints: [path.join(import.meta.dirname, '../src/usage.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'warning', plugins: [noStore] })
  usage = await import(bundle)
})
after(() => fs.rmSync(out, { recursive: true, force: true }))

const row = (at, provider, model, input, cached, output, cost, botId = 'kumi') => ({ at, botId, provider, model, input, cached, output, cost })
const ROWS = [
  row(0, 'codex', 'gpt-x', 1000, 400, 100, 0.5),
  row(1, 'codex', 'gpt-x', 3000, 0, 300, 1.5, 'scout'),
  row(1, 'claude-code', 'claude-x', 2000, 1000, 200, 4),
  row(1, 'local', 'qwen', 500, 0, 50, null),
  row(2, 'some-later-provider', 'm', 10, 0, 1, null),
]

test('what was used is added up, with what has no price counted apart from the cost', () => {
  const all = usage.total(ROWS)
  assert.deepEqual(all, { input: 6510, cached: 1400, output: 651, tokens: 7161, cost: 6, unpriced: 561 })
  // The most tokens first.
  const providers = usage.groupBy(ROWS, (r) => r.provider)
  assert.deepEqual(providers.map((g) => [g.key, g.tokens, g.cost, g.unpriced]), [['codex', 4400, 2, 0], ['claude-code', 2200, 4, 0], ['local', 550, 0, 550], ['some-later-provider', 11, 0, 11]])
  assert.deepEqual(usage.groupBy(ROWS, (r) => r.botId).map((g) => g.key), ['kumi', 'scout'])
  // A cost is a dash only when none of it has a price.
  assert.equal(usage.costOf(providers[0]), '$2.00')
  assert.equal(usage.costOf(providers[2]), '–')
  assert.equal(usage.costOf(usage.total([])), '$0.00')
})

test('the chart stacks each stretch of time by provider, always in the same order and the same colours', () => {
  const counted = { step: 'day', starts: ['2026-11-21', '2026-11-22', '2026-11-23'], rows: ROWS, since: 0, pricedAt: 0 }
  const byTokens = usage.columns(counted, 'tokens')
  // Codex below Claude Code below local models, whichever used the most; a provider without a colour of its own is "other", on top.
  assert.deepEqual(byTokens.series, ['codex', 'claude-code', 'local', 'other'])
  assert.deepEqual(byTokens.values, [[1100, 0, 0, 0], [3300, 2200, 550, 0], [0, 0, 0, 11]])
  assert.equal(byTokens.most, 6050)
  // By cost, what has no price is not in the chart at all.
  const byCost = usage.columns(counted, 'cost')
  assert.deepEqual(byCost.series, ['codex', 'claude-code'])
  assert.deepEqual(byCost.values, [[0.5, 0], [1.5, 4], [0, 0]])
  // A provider keeps its colour when others are filtered out, and each appearance has its own step of it.
  assert.equal(usage.colorOf('claude-code', 'light'), '#eb6834')
  assert.equal(usage.colorOf('claude-code', 'dark'), '#d95926')
  assert.notEqual(usage.colorOf('some-later-provider', 'light'), usage.colorOf('codex', 'light'))
  assert.equal(usage.colorOf('some-later-provider', 'dark'), usage.colorOf('other', 'dark'))
})

test('the lines of a chart are round numbers close above the tallest column', () => {
  assert.deepEqual(usage.scale(0), [0])
  assert.deepEqual(usage.scale(5_600_000), [0, 3_000_000, 6_000_000])
  assert.deepEqual(usage.scale(1_000_000), [0, 500_000, 1_000_000])
  assert.deepEqual(usage.scale(11), [0, 6, 12])
  assert.deepEqual(usage.scale(0.0071).map((n) => Number(n.toFixed(6))), [0, 0.004, 0.008])
  for (const most of [1, 7, 99, 101, 12_345, 987_654_321, 0.03]) {
    const top = usage.scale(most).at(-1)
    assert.ok(top >= most && top <= most * 1.6, `${top} is not close above ${most}`)
  }
})

test('numbers are worded short, and the same way everywhere', () => {
  assert.deepEqual([0, 950, 1000, 12_340, 99_960, 123_456, 999_499, 999_500, 4_100_000, 123_400_000, 999_600_000, 2_050_000_000].map(usage.tokens), ['0', '950', '1K', '12.3K', '100K', '123K', '999K', '1M', '4.1M', '123M', '1B', '2.05B'])
  assert.deepEqual([0, 0.004, 0.005, 0.42, 12.3, 999.994, 1204.4].map(usage.dollars), ['$0.00', '<$0.01', '$0.01', '$0.42', '$12.30', '$999.99', '$1,204'])
  assert.deepEqual([usage.lineLabel(3_000_000, 'tokens'), usage.lineLabel(0, 'cost'), usage.lineLabel(2.5, 'cost'), usage.lineLabel(40, 'cost')], ['3M', '$0', '$2.50', '$40'])
  assert.deepEqual([usage.share(0, 10), usage.share(1, 0), usage.share(1, 1000), usage.share(1, 3), usage.share(5, 5)], ['0%', '0%', '<1%', '33%', '100%'])
  // A day is a date on the server's calendar, shown as that date wherever the app is.
  assert.equal(usage.stretch('2026-11-23', 'day'), '23 Nov')
  assert.equal(usage.stretch('2026-11-23', 'day', true), 'Mon 23 Nov')
  assert.match(usage.stretch('2026-11-23T14:00:00.000Z', 'hour'), /^\d\d:00$/)
  assert.equal(usage.modelLabel('default'), 'Default model')
  assert.equal(usage.providerName('claude-code', []), 'Claude Code')
  assert.equal(usage.providerName('claude-code', [{ id: 'claude-code', name: 'Claude Code (work)' }]), 'Claude Code (work)')
  assert.equal(usage.botName('gone', []), 'gone (deleted)')
  assert.deepEqual([79, 80, 94.9, 95, 100].map(usage.pressure), ['fine', 'high', 'high', 'full', 'full'])
  assert.equal(usage.startsOver(null), '')
  assert.match(usage.startsOver(Date.now() + 3 * 60 * 60_000), /^Starts over (today|tomorrow) \d\d:\d\d$/)
})

test('why something has no cost is said for what applies', () => {
  assert.equal(usage.unpricedNote([ROWS[0]], 1), '')
  assert.match(usage.unpricedNote([ROWS[0], ROWS[3]], 1), /run on your computer/)
  assert.match(usage.unpricedNote(ROWS, null), /could not be fetched/)
  assert.match(usage.unpricedNote(ROWS, 1), /price list does not have them/)
})
