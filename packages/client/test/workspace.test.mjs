// A bot's workspace in words: what is in it, what changed when, and what a change did.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { byDay, childrenOf, findFiles, hintOf, isRecorded, parseDiff, since, summarize } from '../src/workspace.ts'

const entry = (path, dir = false, size = 10) => ({ path, dir, size, modified: 0 })
const entries = [
  entry('AGENTS.md'),
  entry('files', true),
  entry('files/inbox', true),
  entry('files/inbox/boarding-pass.pdf'),
  entry('files/budget.csv'),
  entry('memory', true),
  entry('memory/people.md'),
  entry('memory/trips.md'),
]

test('a workspace is summed up by its notes and working files, and each top folder says what it is', () => {
  const summary = summarize(entries)
  assert.deepEqual(summary, { notes: 2, working: 2, inbox: 1, files: 5, bytes: 50 })
  assert.equal(hintOf('AGENTS.md', summary), 'Its instructions')
  assert.equal(hintOf('memory', summary), '2 notes')
  assert.equal(hintOf('files', summary), '2 working files')
  assert.equal(hintOf('files/inbox', summary), '1 from you')
  assert.equal(hintOf('memory/people.md', summary), '')
})

test('a folder lists what is directly in it, folders first, each folder with the files in it', () => {
  assert.deepEqual(childrenOf(entries, '').map((c) => [c.entry.path, c.count]), [['files', 2], ['memory', 2], ['AGENTS.md', 0]])
  assert.deepEqual(childrenOf(entries, 'files').map((c) => [c.entry.path, c.count]), [['files/inbox', 1], ['files/budget.csv', 0]])
  assert.deepEqual(findFiles(entries, 'PEO').map((e) => e.path), ['memory/people.md'])
})

test('working files are the only part left out of the recorded changes', () => {
  assert.equal(isRecorded('AGENTS.md'), true)
  assert.equal(isRecorded('memory/people.md'), true)
  assert.equal(isRecorded('files/budget.csv'), false)
  assert.equal(isRecorded('files'), false)
})

test('changes are put under the day they were made, and times are told in words', () => {
  const now = new Date(2026, 10, 14, 15, 0).getTime()
  const at = (day, hour) => ({ id: `${day}-${hour}`, time: new Date(2026, 10, day, hour).getTime(), author: 'bot', message: 'Edit memory/people.md', files: [] })
  assert.deepEqual(
    byDay([at(14, 12), at(14, 9), at(13, 18), at(11, 8)], now).map((g) => [g.day, g.changes.length]),
    [['Today', 2], ['Yesterday', 1], ['Wed 11 Nov', 1]],
  )
  assert.equal(since(now - 30_000, now), 'just now')
  assert.equal(since(now - 5 * 60_000, now), '5 minutes ago')
  assert.equal(since(now - 2 * 3_600_000, now), '2 hours ago')
  assert.equal(since(new Date(2026, 10, 13, 23).getTime(), now), 'yesterday')
  assert.equal(since(new Date(2026, 9, 2).getTime(), now), 'on 2 Oct')
})

test('a change from git is read into its files and their lines', () => {
  const diff = [
    'diff --git a/memory/people.md b/memory/people.md',
    'index 1..2 100644',
    '--- a/memory/people.md',
    '+++ b/memory/people.md',
    '@@ -1,2 +1,3 @@',
    ' ## Ana',
    '-- Likes trains.',
    '+- Prefers an aisle seat.',
    'diff --git a/AGENTS.md b/AGENTS.md',
    'new file mode 100644',
    '@@ -0,0 +1 @@',
    '+# Juno',
  ].join('\n')
  assert.deepEqual(parseDiff(diff), [
    { file: 'memory/people.md', lines: [{ kind: 'same', text: '## Ana' }, { kind: 'del', text: '- Likes trains.' }, { kind: 'add', text: '- Prefers an aisle seat.' }] },
    { file: 'AGENTS.md', lines: [{ kind: 'add', text: '# Juno' }] },
  ])
})
