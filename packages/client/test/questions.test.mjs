// What a bot asked its owner with ask_user (src/questions.ts): which questions wait in a
// conversation, how choosing and writing make up a reply, and the message the answers go as.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { build } from 'esbuild'

// Bundled as the apps bundle it, but without the store, which keeps a connection going that
// nothing here needs. What stands in for it does as `store` says.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-client-questions-'))
const noStore = {
  name: 'no-store',
  setup(bundling) {
    bundling.onResolve({ filter: /^\.\/store$/ }, () => ({ path: 'store', namespace: 'left-out' }))
    bundling.onLoad({ filter: /.*/, namespace: 'left-out' }, () => ({
      contents: `
        const store = globalThis.questionsTestStore
        export const api = (...args) => store.api(...args)
        export const assume = () => {}`,
      loader: 'js',
    }))
  },
}
const store = (globalThis.questionsTestStore = { api: () => Promise.resolve() })
let questions
before(async () => {
  const bundle = path.join(out, 'questions.mjs')
  await build({ entryPoints: [path.join(import.meta.dirname, '../src/questions.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'warning', plugins: [noStore] })
  questions = await import(bundle)
})
after(() => fs.rmSync(out, { recursive: true, force: true }))

const option = (label, description = '') => ({ label, description })
const flight = { header: 'Flight', question: 'Which flight should I book?', options: [option('Lufthansa, 9:40', 'Direct'), option('Iberia, 11:15')], multiple: false }
const extras = { header: '', question: 'Which extras?', options: [option('Checked bag'), option('Window seat'), option('Meal')], multiple: true }
const company = { header: '', question: 'Who travels with you?', options: [], multiple: false }
const chat = (flag, more = {}) => ({ id: 't_kumi', botId: 'kumi', parentId: null, archivedAt: null, kind: 'chat', status: 'idle', held: false, told: 9, readTo: 9, flag, ...more })
const asking = { kind: 'answer', reason: flight.question, item: 9, at: 1, questions: [flight, extras] }

test('the questions that wait are the ones on the mark of a bot’s own conversation', () => {
  assert.deepEqual(questions.openQuestions(chat(asking)), [flight, extras])
  assert.deepEqual(questions.openQuestions(chat({ kind: 'answer', reason: 'Go ahead?', item: 9, at: 1 })), [], 'a bot that only said it needs its owner asked nothing to choose from')
  assert.deepEqual(questions.openQuestions(chat(null)), [])
  assert.deepEqual(questions.openQuestions(undefined), [])
  assert.deepEqual(questions.openQuestions(chat(asking, { archivedAt: 5 })), [], 'a conversation that was set aside is only read')
  assert.deepEqual(questions.openQuestions(chat(asking, { parentId: 't_above' })), [])
})

test('a reply: one option is the answer, several add up, and words of one’s own count too', () => {
  const { choose, write, replied } = questions
  // One of them: pressing another takes its place, pressing it again takes it back, and writing replaces it.
  let reply = choose(flight, undefined, 'Lufthansa, 9:40')
  reply = choose(flight, reply, 'Iberia, 11:15')
  assert.deepEqual(reply, { chosen: ['Iberia, 11:15'], written: '' })
  assert.deepEqual(choose(flight, reply, 'Iberia, 11:15'), { chosen: [], written: '' })
  reply = write(flight, reply, 'The cheapest')
  assert.deepEqual(reply, { chosen: [], written: 'The cheapest' })
  assert.deepEqual(choose(flight, reply, 'Lufthansa, 9:40'), { chosen: ['Lufthansa, 9:40'], written: '' })
  // Emptying the field again takes nothing away.
  assert.deepEqual(write(flight, { chosen: ['Iberia, 11:15'], written: '' }, ' '), { chosen: ['Iberia, 11:15'], written: ' ' })

  // Any that fit: each goes on or off by itself, and what is written is one more.
  let several = choose(extras, undefined, 'Meal')
  several = choose(extras, several, 'Checked bag')
  several = write(extras, several, 'A vegetarian one')
  assert.deepEqual(several, { chosen: ['Meal', 'Checked bag'], written: 'A vegetarian one' })
  assert.deepEqual(choose(extras, several, 'Meal').chosen, ['Checked bag'])

  assert.equal(replied(undefined), false)
  assert.equal(replied({ chosen: [], written: '  ' }), false)
  assert.equal(replied({ chosen: [], written: 'x' }), true)
  assert.equal(replied({ chosen: ['Meal'], written: '' }), true)
})

test('the answers go as a message that reads as questions and answers, in the order the bot offered them', async () => {
  const replies = [{ chosen: ['Iberia, 11:15'], written: '' }, { chosen: ['Meal', 'Checked bag'], written: ' A vegetarian one ' }]
  const text = 'Which flight should I book?\n→ Iberia, 11:15\n\nWhich extras?\n→ Checked bag\n→ Meal\n→ A vegetarian one\n\nWho travels with you?\n→ (no answer)'
  assert.equal(questions.answerText([flight, extras, company], replies), text)
  assert.equal(questions.answerText([company], [{ chosen: [], written: 'Ana' }]), 'Who travels with you?\n→ Ana')

  // Sent to the conversation that asked, as a message from its owner.
  const calls = []
  store.api = (...args) => (calls.push(args), Promise.resolve())
  const thread = chat({ ...asking, questions: [flight, extras, company] })
  await questions.sendAnswers(thread, thread.flag.questions, replies)
  assert.deepEqual(calls, [['POST', '/api/threads/t_kumi/messages', { text }]])
  store.api = () => Promise.reject(new Error('Offline'))
  await assert.rejects(questions.sendAnswers(thread, thread.flag.questions, replies), /Offline/)
})

test('what a call asked is read back from it, in the questions’ words', () => {
  const asked = (args) => questions.askedIn({ arguments: typeof args === 'string' ? args : JSON.stringify(args) })
  assert.deepEqual(asked({ questions: [{ question: ' Which flight\n should I book? ', options: ['a', 'b'] }, { question: 'Which extras?' }, { question: ' ' }, 'x'] }), ['Which flight should I book?', 'Which extras?'])
  assert.deepEqual(asked({ questions: 'Which?' }), [])
  assert.deepEqual(asked('{not json'), [])
})
