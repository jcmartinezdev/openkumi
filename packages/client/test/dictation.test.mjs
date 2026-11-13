// Where spoken words go in a draft: at the cursor, with spaces where they would otherwise run into what is there.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spokenInto } from '../src/dictation.ts'

test('spoken words go where the cursor was, with a space either side only where one is missing', () => {
  assert.deepEqual(spokenInto('', ' Hello there. ', ''), { draft: 'Hello there.', cursor: 12 })
  assert.deepEqual(spokenInto('Hi.', 'Can you help?', ''), { draft: 'Hi. Can you help?', cursor: 17 })
  assert.deepEqual(spokenInto('Hi. ', 'Can you help?', ' Thanks'), { draft: 'Hi. Can you help? Thanks', cursor: 17 })
  assert.deepEqual(spokenInto('Hi.', 'Can you help', 'Thanks'), { draft: 'Hi. Can you help Thanks', cursor: 17 })
  // Punctuation after the cursor stays against the words.
  assert.deepEqual(spokenInto('Book it for', 'Friday', '.'), { draft: 'Book it for Friday.', cursor: 18 })
  assert.deepEqual(spokenInto('Line one\n', 'line two', ''), { draft: 'Line one\nline two', cursor: 17 })
  // Nothing said leaves the draft as it was.
  assert.deepEqual(spokenInto('Hi', '  ', ' there'), { draft: 'Hi there', cursor: 2 })
})
