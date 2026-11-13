// The master prompt: everything a bot is told, written out in master-prompt.md beside src/. It comes
// with OpenKumi and is the same for every bot; nothing in the app changes it. The server only fills
// in what it knows of the bot and the thread (instructions() in agent.ts).
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './config.ts'

const FILE = path.join(ROOT, 'master-prompt.md')

/** What goes into the master prompt: the text for a {{name}}, or whether a part is kept. */
export type Filling = Record<string, string | boolean>

/** Read on every step, so a change to the file takes effect without a restart. */
export const masterPrompt = (fill: Filling) => render(fs.readFileSync(FILE, 'utf8'), fill)

const TAG = /\{\{([#^/]?)(\w+)\}\}/g
const PART = /\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/g

/** Fills in a template written as master-prompt.md says. A name it is not given is a mistake in the file. */
export function render(template: string, fill: Filling): string {
  const text = template.replace(/<!--[\s\S]*?-->\n?/g, '')
  for (const [, kind, name] of text.matchAll(TAG)) {
    if (!(name in fill)) throw new Error(`master-prompt.md has {{${name}}}, which is not filled in`)
    if (!kind && typeof fill[name] !== 'string') throw new Error(`master-prompt.md puts {{${name}}} in as text, but it is only true or false`)
  }
  const parts = (text: string): string =>
    text.replace(PART, (_, kind: string, name: string, inside: string) => (!!fill[name] === (kind === '#') ? parts(inside) : ''))
  // A tag on a line of its own goes with that line.
  const kept = parts(text.replace(/^[ \t]*(\{\{[#^/]\w+\}\})[ \t]*\n/gm, '$1'))
  if (/\{\{[#^/]/.test(kept)) throw new Error('master-prompt.md has a part that is opened and not closed, or closed and not opened')
  // What is filled in goes in last, all at once, so nothing in it is taken for a tag or loses its empty lines.
  return kept
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(TAG, (_, __, name: string) => fill[name] as string)
}
