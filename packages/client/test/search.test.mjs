// Finding things by what was typed (src/search.ts), as the desktop app's palette does.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rank, score, wordsOf } from '../src/search.ts'

const titles = (ranked) => ranked.map(({ group, things }) => [group, things.map((t) => t.title)])

test('every word typed must be there; a name that begins with it beats a word that begins with it, which beats one inside a word', () => {
  assert.deepEqual(wordsOf('  Dark   MODE '), ['dark', 'mode'])
  assert.deepEqual(wordsOf('Grüße'), ['gruße'])
  const theme = { title: 'Theme', keywords: 'dark light mode' }
  assert.equal(score(theme, wordsOf('dark mode')), 1)
  assert.equal(score(theme, wordsOf('dark sepia')), -1)
  assert.equal(score({ title: 'Scheduler' }, wordsOf('sch')), 4)
  assert.equal(score({ title: 'Call Scheduler' }, wordsOf('sch')), 3)
  assert.equal(score({ title: 'Call Scheduler' }, wordsOf('sched call')), 3)
  assert.equal(score({ title: 'Reschedule' }, wordsOf('sched')), 2)
  assert.equal(score({ title: 'Inbox sweep', owner: 'Scheduler' }, wordsOf('sched')), 1.5)
  assert.equal(score({ title: 'Ümlaut' }, wordsOf('um')), 4, 'accents are not needed to find a name')
  assert.equal(score({ title: 'Anything' }, []), -1, 'nothing typed matches nothing')
})

test('groups come by their best kind of match, then in their own order; what only its keywords find comes last but stays', () => {
  const things = [
    { key: 'a', group: 'settings', title: 'Order of the bots', keywords: 'schedule sort' },
    { key: 'b', group: 'automations', title: 'Inbox sweep', owner: 'Scheduler' },
    { key: 'c', group: 'bots', title: 'Scheduler' },
    { key: 'd', group: 'conversations', title: 'Run: Inbox sweep', owner: 'Scheduler' },
    { key: 'e', group: 'places', title: 'Automations', keywords: 'scheduled tasks' },
  ]
  const order = ['bots', 'places', 'settings', 'automations', 'conversations']
  // The bot by its name, then what is its own, then what only has the word among its keywords.
  assert.deepEqual(titles(rank(things, wordsOf('sch'), { order })), [
    ['bots', ['Scheduler']],
    ['automations', ['Inbox sweep']],
    ['conversations', ['Run: Inbox sweep']],
    ['places', ['Automations']],
    ['settings', ['Order of the bots']],
  ])
  assert.deepEqual(titles(rank(things, wordsOf('tasks'), { order })), [['places', ['Automations']]])
})

test('what was picked lately moves up within its kind of match, and each group is cut short only beside others', () => {
  const many = ['Alpha one', 'Alpha two', 'Alpha three', 'Alpha four', 'Alpha five'].map((title, i) => ({ key: `k${i}`, group: 'settings', title }))
  assert.equal(rank(many, wordsOf('alpha'), { order: [] })[0].things.length, 5, 'one group alone shows all it has')
  const withBot = [...many, { key: 'bot', group: 'bots', title: 'Alpha bot' }]
  const ranked = rank(withBot, wordsOf('alpha'), { order: ['bots', 'settings'], recent: ['k3'], perGroup: 3 })
  assert.deepEqual(titles(ranked), [
    ['bots', ['Alpha bot']],
    ['settings', ['Alpha four', 'Alpha one', 'Alpha two']],
  ])
  // A recent pick that only its keywords find stays below a name that matches.
  const mixed = [
    { key: 'x', group: 'g', title: 'Notes', keywords: 'theme' },
    { key: 'y', group: 'g', title: 'Theme' },
  ]
  assert.deepEqual(titles(rank(mixed, wordsOf('theme'), { order: [], recent: ['x'] })), [['g', ['Theme', 'Notes']]])
})

test('the row that is picked keeps its place while it matches, when better ones come in above it', () => {
  const local = { key: 'held', group: 'conversations', title: 'Notes from the trip' }
  const later = ['Trip', 'Trip plan', 'Trip budget', 'Trip photos'].map((title, i) => ({ key: `server${i}`, group: 'conversations', title }))
  const bot = { key: 'bot', group: 'bots', title: 'Tripper' }
  const all = [local, ...later, bot]
  const shown = (keep) => titles(rank(all, wordsOf('trip'), { order: ['bots', 'conversations'], keep }))[1][1]
  assert.deepEqual(shown(null), ['Trip', 'Trip plan', 'Trip budget', 'Trip photos'], 'four better ones fill the group')
  assert.deepEqual(shown('held'), ['Trip', 'Trip plan', 'Trip budget', 'Notes from the trip'], 'the picked one takes the last place')
  assert.deepEqual(shown('gone'), ['Trip', 'Trip plan', 'Trip budget', 'Trip photos'], 'one that no longer matches keeps nothing')
})
