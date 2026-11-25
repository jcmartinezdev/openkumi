// Finding things by what was typed, for the desktop app's palette (apps/web/src/Palette.tsx). Every
// word typed must be somewhere in a thing's name or its keywords, the rule the settings' own search
// has, so the two never disagree; names that start with what was typed come first.

/** Text as it is compared: without accents and capitals, so "u" finds "Ü". */
export const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** The words typed, as they are compared. */
export const wordsOf = (query: string): string[] => fold(query).split(/\s+/).filter(Boolean)

export interface Findable {
  /** What it is called, as shown. */
  title: string
  /** Other words it is found by, which are not shown. */
  keywords?: string
  /** The name of the bot it belongs to. It is found by that too, below what its own name finds. */
  owner?: string
}

/**
 * How well something matches the words typed: -1 not at all; 1 only through its keywords; 1.5
 * through the name of the bot it belongs to; 2 every word is in its name; 3 every word begins a
 * word of its name; 4 its name begins with what was typed.
 */
export function score(thing: Findable, words: string[]): number {
  const title = fold(thing.title)
  const owner = thing.owner ? fold(thing.owner) : ''
  const all = `${title} ${thing.keywords ? fold(thing.keywords) : ''} ${owner}`
  if (!words.length || !words.every((w) => all.includes(w))) return -1
  if (title.startsWith(words.join(' '))) return 4
  const starts = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (words.every((w) => starts.some((s) => s.startsWith(w)))) return 3
  if (words.every((w) => title.includes(w))) return 2
  if (owner && words.every((w) => owner.includes(w))) return 1.5
  return 1
}

export interface Ranked<T> {
  group: string
  things: T[]
}

export interface RankOptions {
  /** The groups in the order they come in when they match equally well. Others come after them. */
  order: string[]
  /** Keys of what was picked lately: it moves up a little, never past a better kind of match. */
  recent?: string[]
  /** How many of each group are shown when several groups have something. */
  perGroup?: number
  /** The key of the row that is picked: while it matches, it keeps a place, whatever comes in above it. */
  keep?: string | null
}

/**
 * What matches the words, in groups: the group with the best kind of match first, the best of each
 * group first, and what is equally good in the order it was given in. What only has the words in its
 * keywords comes after what has them in its name, but is never left out: the settings' own search
 * would find it.
 */
export function rank<T extends Findable & { key: string; group: string }>(things: T[], words: string[], { order, recent = [], perGroup = 4, keep }: RankOptions): Ranked<T>[] {
  const scored = things.map((thing) => ({ thing, s: score(thing, words) })).filter((x) => x.s >= 0)
  const groups = new Map<string, { best: number; items: { thing: T; s: number }[] }>()
  for (const { thing, s } of scored) {
    const shown = s + (recent.includes(thing.key) ? 0.25 : 0)
    const group = groups.get(thing.group) ?? { best: -1, items: [] }
    group.items.push({ thing, s: shown })
    group.best = Math.max(group.best, s)
    groups.set(thing.group, group)
  }
  const place = (group: string) => (order.includes(group) ? order.indexOf(group) : order.length)
  const sorted = [...groups].sort(([a, x], [b, y]) => y.best - x.best || place(a) - place(b))
  return sorted.map(([group, { items }]) => {
    const best = items.sort((a, b) => b.s - a.s).map((item) => item.thing)
    const shown = sorted.length > 1 ? best.slice(0, perGroup) : best
    const kept = keep ? best.find((thing) => thing.key === keep) : undefined
    return { group, things: kept && !shown.includes(kept) ? [...shown.slice(0, -1), kept] : shown }
  })
}
