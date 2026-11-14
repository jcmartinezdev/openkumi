// Superpowers in words, the same in every app: what a search found in one, how its files read
// when formatted, and how one a bot has stands, in the few words a list has room for.
import type { Superpower, SuperpowerStatus } from '@openkumi/shared'

/** The words looked for, from what was typed. */
export const searchWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

/** Whether every word looked for is somewhere in what the superpower says about itself. */
export function matches(power: Superpower, words: string[]): boolean {
  const text = [power.name, power.tagline, ...power.categories, ...power.can].join(' ').toLowerCase()
  return words.every((word) => text.includes(word))
}

/**
 * Where a search found a superpower, when its name and tagline do not show it: a group it is in, or
 * a line of what it can do. A list shows that too, so a match never looks like a mistake.
 */
export function foundIn(power: Superpower, words: string[]): { group?: string; can?: string } {
  const has = (text: string) => words.every((word) => text.toLowerCase().includes(word))
  if (!words.length || has(`${power.name} ${power.tagline}`)) return {}
  const can = power.can.find(has)
  if (can) return { can }
  return { group: power.categories.find((c) => words.some((word) => c.toLowerCase().includes(word))) }
}

/**
 * A superpower's files are written with their lines wrapped for reading as text; shown formatted,
 * each paragraph and list item is one flowing piece. Code, tables and headings stay as they are.
 */
export function unwrap(text: string): string {
  const out: string[] = []
  let code = false
  for (const line of text.split('\n')) {
    const fence = /^\s*(```|~~~)/.test(line)
    const prev = out.at(-1) ?? ''
    const joins = !code && !fence && line.trim() && prev.trim() && !/^\s*(```|~~~|#|\|)/.test(prev) && !/^\s*([-*+>#|]|\d+\.\s)/.test(line)
    if (joins) out[out.length - 1] = `${prev} ${line.trim()}`
    else out.push(line)
    if (fence) code = !code
  }
  return out.join('\n')
}

/** How one a bot has stands, settled or not. */
export type Standing = { words: string; tone: 'ok' | 'bad' | 'muted'; settled: boolean }

/**
 * How a superpower a bot has stands, in the words a list has room for: the bot's settings and the
 * catalog say it the same way. A skill is simply active; an app is signed in (or connected) with
 * its tools, being connected, signed out, or not working.
 */
export function shortStanding(power: Superpower, status: SuperpowerStatus | undefined): Standing {
  if (!power.service) return { words: 'Active', tone: 'ok', settled: true }
  if (status?.state === 'connected') {
    const tools = `${status.tools} ${status.tools === 1 ? 'tool' : 'tools'}`
    return { words: `${status.signedIn ? 'Signed in' : 'Connected'} · ${tools}`, tone: 'ok', settled: true }
  }
  if (status?.state === 'needs-login') return { words: 'Not signed in', tone: 'bad', settled: true }
  if (status?.state === 'error') return { words: 'Not working', tone: 'bad', settled: true }
  return { words: 'Connecting…', tone: 'muted', settled: false }
}
