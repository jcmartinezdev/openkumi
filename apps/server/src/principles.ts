// The principles every bot is told before anything else: how to behave, and how to work with the
// other bots. They are the owner's, like a bot's rules: kept in ~/.openkumi/principles.md, which no
// bot can reach, and changed in Settings. Until the owner writes their own, the ones OpenKumi comes
// with (principles.md beside src/) apply, so improvements to those reach everyone who kept them.
import fs from 'node:fs'
import path from 'node:path'
import type { Principles } from '@openkumi/shared'
import { HOME, ROOT, emit } from './config.ts'

const FILE = path.join(HOME, 'principles.md')
const MAX = 20_000
const DEFAULT = fs.readFileSync(path.join(ROOT, 'principles.md'), 'utf8').trim()

/** Read on every turn, so a change, also one made to the file by hand, takes effect at once. */
export function principles(): Principles {
  try {
    return { text: fs.readFileSync(FILE, 'utf8').trim(), custom: true, default: DEFAULT }
  } catch {
    return { text: DEFAULT, custom: false, default: DEFAULT }
  }
}

/** Saves the owner's own principles. Null, or the text OpenKumi comes with, goes back to those. */
export function setPrinciples(text: unknown): Principles {
  if (text !== null && typeof text !== 'string') throw new Error('The principles must be text')
  const next = text === null ? null : text.replace(/\r\n/g, '\n').trim().slice(0, MAX)
  if (next === null || next === DEFAULT) fs.rmSync(FILE, { force: true })
  else fs.writeFileSync(FILE, next + '\n')
  const now = principles()
  emit({ type: 'principles', principles: now })
  return now
}
