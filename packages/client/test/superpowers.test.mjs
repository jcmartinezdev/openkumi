// Superpowers in words: what a search found, how a file reads formatted, and how one a bot has stands.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { foundIn, matches, searchWords, shortStanding, unwrap } from '../src/superpowers.ts'

const power = (over = {}) => ({
  id: 'granola',
  name: 'Granola',
  icon: '',
  categories: ['Productivity', 'Work'],
  tagline: 'Ask about your meetings: what was said, decided and promised.',
  about: '',
  can: ['Find your meetings by date, person or topic', 'Read a meeting’s transcript on paid plans'],
  instructions: true,
  files: ['instructions.md'],
  signIn: true,
  service: 'mcp.granola.ai',
  site: '',
  onFor: [],
  hooks: null,
  ...over,
})

test('a search looks in the name, the tagline, the groups and what it can do', () => {
  assert.equal(matches(power(), searchWords('meetings')), true)
  assert.equal(matches(power(), searchWords('WORK')), true)
  assert.equal(matches(power(), searchWords('transcript paid')), true)
  assert.equal(matches(power(), searchWords('travel')), false)
})

test('a match the name and tagline do not show says where it was', () => {
  assert.deepEqual(foundIn(power(), searchWords('meetings')), {})
  assert.deepEqual(foundIn(power(), searchWords('transcript')), { can: 'Read a meeting’s transcript on paid plans' })
  assert.deepEqual(foundIn(power(), searchWords('work')), { group: 'Work' })
  assert.deepEqual(foundIn(power(), []), {})
})

test('formatted, hard-wrapped lines flow together, while lists, headings and code stay as written', () => {
  const text = '# Title\n\nOne line\nand the next.\n\n- an item\n  that wraps\n- another\n\n```js\nconst a = 1\nconst b = 2\n```'
  assert.equal(unwrap(text), '# Title\n\nOne line and the next.\n\n- an item that wraps\n- another\n\n```js\nconst a = 1\nconst b = 2\n```')
})

test('a list says how one a bot has stands in a few words', () => {
  assert.deepEqual(shortStanding(power({ service: null, signIn: false }), undefined), { words: 'Active', tone: 'ok', settled: true })
  assert.deepEqual(shortStanding(power(), { state: 'connected', tools: 9, signedIn: true }), { words: 'Signed in · 9 tools', tone: 'ok', settled: true })
  assert.deepEqual(shortStanding(power(), { state: 'connected', tools: 1, signedIn: false }), { words: 'Connected · 1 tool', tone: 'ok', settled: true })
  assert.equal(shortStanding(power(), { state: 'needs-login', tools: 0, signedIn: false }).words, 'Not signed in')
  assert.equal(shortStanding(power(), { state: 'error', tools: 0, signedIn: true, error: '503' }).words, 'Not working')
  assert.deepEqual(shortStanding(power(), { state: 'connecting', tools: 0, signedIn: true }), { words: 'Connecting…', tone: 'muted', settled: false })
  assert.equal(shortStanding(power(), undefined).settled, false)
})
