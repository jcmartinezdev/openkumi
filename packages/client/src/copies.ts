// The copy an app keeps on its device of what an environment on another computer sent it: the
// list of threads with everything else the app is sent when it connects, and the newest part of
// the chats opened most recently. It is shown at once when the app starts, and can be read while
// the environment cannot be reached; once it answers, the store catches up from the copy's change
// number (see store.ts). The server keeps everything, so a copy can always be thrown away.
//
// Each app brings its own place to keep it (IndexedDB on the desktop, SQLite on the phone). Keys:
//   <environment>/state            the list, the change number and what else was sent
//   <environment>/thread/<id>      the newest items of one chat
import type { Item } from '@openkumi/shared'
import type { Link } from '@openkumi/shared/desktop'
import { type State, currentLink, onEnvironmentChange, onState, useCopies } from './store'

/** A place to keep text under keys, such as a table of an on-device database. */
export interface Shelf {
  get(keys: string[]): Promise<(string | null)[]>
  /** Writes these entries in one go; null removes one. */
  set(entries: [key: string, value: string | null][]): Promise<void>
  /** Removes every entry whose key begins with this. */
  clear(prefix: string): Promise<void>
  /** The keys that begin with this. */
  keys(prefix: string): Promise<string[]>
}

/** Bumped when what is kept changes shape: an older copy is thrown away. */
const VERSION = 1
/** The most chats kept per environment, the ones opened most recently. */
const MOST_CHATS = 50
/** About the most kept per environment, counted in characters. */
const MOST_SIZE = 32_000_000
/** The most items kept of one chat: its newest, from something said to the bot. */
const MOST_ITEMS = 300
/** The first save waits this long for things to settle; the next ones come at most this often. */
const FIRST = 500
const EVERY = 10_000

interface Kept {
  version: number
  /** The server it came from, and its database. A copy from another one is not shown. */
  server: string | null
  database: string
  seq: number
  /** The chats kept, most recently changed first, and how much each takes. */
  recent: string[]
  sizes: Record<string, number>
  state: globalThis.Partial<State>
}

let shelf: Shelf | null = null
/** What is kept of the environment being shown: what was last written of each chat, and the order and sizes of the chats. */
let saved: { environment: string; database: string; items: Record<string, Item[]>; recent: string[]; sizes: Map<string, number> } | null = null
let latest: State | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let lastSave = 0

/**
 * Everything done to the shelf, in the order it was asked for: what is written of an environment
 * that is being left must not land after its copy was thrown away.
 */
let queue: Promise<unknown> = Promise.resolve()
function inTurn<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job)
  queue = next.catch(() => {})
  return next
}

/** The parts of the state that are kept; the live state of the bots' browsers is not. */
const KEPT = ['bots', 'threads', 'automations', 'providers', 'superpowers', 'superpowerCategories', 'superpowerStatus', 'home', 'settings', 'defaults', 'about'] as const

const stateKey = (environment: string) => `${environment}/state`
const threadKey = (environment: string, id: string) => `${environment}/thread/${id}`
const kept = (shown: Link | null): shown is Link => !!shown && !shown.local

/** The newest items of a chat, beginning at something said to the bot so that no turn is split. */
function newest(items: Item[]): Item[] {
  if (items.length <= MOST_ITEMS) return items
  const from = items.length - MOST_ITEMS
  const ask = items.findIndex((i, at) => at >= from && i.data.type === 'message' && i.data.role === 'user')
  return items.slice(ask < 0 ? from : ask)
}

/** Writes what changed since the last save. What it writes is taken now; the writing finishes later. */
function save(): Promise<void> {
  clearTimeout(timer)
  timer = undefined
  const shown = currentLink()
  const now = latest
  if (!shelf || !kept(shown) || !now?.connected || !now.database) return Promise.resolve()
  lastSave = Date.now()
  const environment = shown.id
  const entries: [string, string | null][] = []
  // Nothing kept yet, or what is kept came from another database: that goes, and this starts afresh.
  const afresh = saved?.environment !== environment || saved.database !== now.database
  if (afresh) saved = { environment, database: now.database, items: {}, recent: [], sizes: new Map() }
  const was = saved!
  for (const [id, items] of Object.entries(now.items)) {
    if (was.items[id] === items) continue
    const some = newest(items)
    const value = JSON.stringify({ items: some, older: !!now.older[id] || some.length < items.length })
    was.items[id] = items
    was.recent = [id, ...was.recent.filter((r) => r !== id)]
    was.sizes.set(id, value.length)
    entries.push([threadKey(environment, id), value])
  }
  const drop = (id: string) => {
    delete was.items[id]
    was.recent = was.recent.filter((r) => r !== id)
    was.sizes.delete(id)
    entries.push([threadKey(environment, id), null])
  }
  // A chat that was removed goes from the copy too.
  const listed = new Set(now.threads.map((t) => t.id))
  for (const id of was.recent) if (was.items[id] && !now.items[id] && !listed.has(id)) drop(id)
  // The ones changed longest ago go first, until what is left is within the limits.
  const size = () => [...was.sizes.values()].reduce((a, b) => a + b, 0)
  while (was.recent.length > MOST_CHATS || (was.recent.length > 1 && size() > MOST_SIZE)) drop(was.recent.at(-1)!)
  const state = Object.fromEntries(KEPT.map((k) => [k, now[k]]))
  const copy: Kept = { version: VERSION, server: shown.serverId ?? null, database: now.database, seq: now.seq, recent: was.recent, sizes: Object.fromEntries(was.sizes), state }
  entries.push([stateKey(environment), JSON.stringify(copy)])
  const writing = shelf
  return inTurn(async () => {
    if (afresh) await writing.clear(`${environment}/`)
    await writing.set(entries)
  }).catch(() => {})
}

function schedule() {
  if (timer || !shelf || !kept(currentLink()) || !latest?.connected) return
  timer = setTimeout(save, Math.max(FIRST, lastSave + EVERY - Date.now()))
}

/** Reads the copy kept of an environment, for the store to show before it answers. */
async function restore(link: Link): Promise<globalThis.Partial<State> | null> {
  const on = shelf
  if (!on) return null
  const [raw] = await inTurn(() => on.get([stateKey(link.id)]))
  if (!raw) return null
  let copy: Kept
  try {
    copy = JSON.parse(raw)
  } catch {
    await forgetCopy(link.id)
    return null
  }
  // Kept by an older app, or of another server than the one this environment now is.
  if (copy.version !== VERSION || (link.serverId && copy.server && copy.server !== link.serverId)) {
    await forgetCopy(link.id)
    return null
  }
  // The chats themselves are read when they are opened.
  saved = { environment: link.id, database: copy.database, items: {}, recent: copy.recent, sizes: new Map(Object.entries(copy.sizes ?? {})) }
  return { ...copy.state, browsers: {}, database: copy.database, seq: copy.seq, items: {}, older: {}, partial: {} }
}

/** Reads the copy kept of one chat. */
async function thread(link: Link, id: string): Promise<{ items: Item[]; older: boolean } | null> {
  const on = shelf
  if (!on || saved?.environment !== link.id) return null
  const [raw] = await inTurn(() => on.get([threadKey(link.id, id)]))
  if (!raw) return null
  try {
    const copy = JSON.parse(raw) as { items: Item[]; older: boolean }
    // It is what is kept already, so it is not written again until it changes.
    if (saved?.environment === link.id) saved.items[id] = copy.items
    return copy
  } catch {
    return null
  }
}

/** Starts keeping copies on this shelf. */
export function keepCopies(on: Shelf) {
  shelf = on
  useCopies({ restore, thread })
  onState((now) => {
    latest = now
    schedule()
  })
  // What changed of the environment being left is written before it goes.
  onEnvironmentChange(() => void (timer && save()))
}

/** Writes what changed now, rather than within the next few seconds: the app is going away. */
export function saveCopyNow(): Promise<void> {
  return timer ? save() : Promise.resolve()
}

/** Throws away the copy kept of an environment: it was removed, or the phone was unpaired. */
export async function forgetCopy(environment: string) {
  if (saved?.environment === environment) saved = null
  const on = shelf
  if (on) await inTurn(() => on.clear(`${environment}/`))
}

/** Throws away the copies of every environment but these. */
export async function keepOnlyCopies(environments: string[]) {
  if (!shelf) return
  const on = shelf
  const keep = new Set(environments)
  const all = new Set((await inTurn(() => on.keys(''))).map((key) => key.split('/')[0]))
  for (const environment of all) if (!keep.has(environment)) await forgetCopy(environment)
}
