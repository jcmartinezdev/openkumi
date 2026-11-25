// How both apps sort and describe the voices a bot can have on a call (src/voices.ts).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aboutVoice, isVoice, shelvesOf, voiceOf } from '../src/voices.ts'

// As the real Codex lists them, less the ones the server leaves out, with one added later.
const known = {
  voices: ['juniper', 'maple', 'spruce', 'ember', 'vale', 'breeze', 'arbor', 'sol', 'cove', 'aube', 'bubbie', 'haetsal', 'hanul', 'himari', 'leher', 'miko', 'neer', 'rindo', 'rio', 'rivage', 'sonna', 'tinta', 'viola', 'quill'],
  usual: 'cove',
}
const names = (shelf) => shelf.voices.map((choice) => choice.name)

test('voices are sorted female, male, by language, then the ones nothing is known of', () => {
  const shelves = shelvesOf(known, '')
  assert.deepEqual(shelves.map((shelf) => shelf.title), ['Female', 'Male', 'Languages', 'Other'])
  assert.deepEqual(names(shelves[0]), ['Juniper', 'Maple', 'Sol', 'Vale'])
  assert.deepEqual(names(shelves[1]), ['Arbor', 'Breeze', 'Cove', 'Ember', 'Spruce'])
  // By language, then by name within one.
  assert.deepEqual(names(shelves[2]), ['Bubbie', 'Aube', 'Rivage', 'Miko', 'Sonna', 'Leher', 'Neer', 'Himari', 'Rindo', 'Haetsal', 'Hanul', 'Rio', 'Viola', 'Tinta'])
  assert.deepEqual(names(shelves[3]), ['Quill'])
  // Every voice Codex offers is somewhere, once.
  assert.equal(shelves.flatMap((shelf) => shelf.voices).length, known.voices.length)
})

test('a shelf with nothing on it is left out', () => {
  assert.deepEqual(shelvesOf({ voices: ['maple', 'cove'], usual: 'cove' }, '').map((shelf) => shelf.title), ['Female', 'Male'])
})

test('each voice says what it is like, in OpenAI’s words where there are any', () => {
  const all = shelvesOf(known, '').flatMap((shelf) => shelf.voices)
  const about = (name) => aboutVoice(all.find((choice) => choice.name === name))
  assert.equal(about('Cove'), 'Male · Composed and direct')
  assert.equal(about('Juniper'), 'Female · Open and upbeat')
  assert.equal(about('Tinta'), 'Spanish (Mexico)')
  assert.equal(about('Quill'), '')
})

test('the usual voice is kept as none, and a bot given it by name has it all the same', () => {
  const cove = shelvesOf(known, '').flatMap((shelf) => shelf.voices).find((choice) => choice.voice === 'cove')
  assert.equal(cove.value, '')
  assert.equal(cove.usual, true)
  assert.ok(isVoice(cove, ''))
  assert.ok(isVoice(cove, 'cove'))
  assert.ok(!isVoice(cove, 'maple'))
})

test('a voice the bot has that Codex no longer offers stays listed, on its own shelf', () => {
  const shelves = shelvesOf(known, 'marin')
  const marin = shelves.find((shelf) => shelf.title === 'Female').voices.find((choice) => choice.voice === 'marin')
  assert.equal(marin.gone, true)
  assert.equal(marin.value, 'marin')
  const lost = shelvesOf(known, 'zephyr').find((shelf) => shelf.title === 'Other').voices.find((choice) => choice.voice === 'zephyr')
  assert.equal(lost.gone, true)
})

test('the voice a bot has, for its settings', () => {
  assert.equal(voiceOf(null, 'maple'), null)
  assert.equal(voiceOf(known, '').name, 'Cove')
  assert.equal(voiceOf(known, 'maple').about, 'Cheerful and candid')
  assert.equal(voiceOf(known, 'marin').gone, true)
})
