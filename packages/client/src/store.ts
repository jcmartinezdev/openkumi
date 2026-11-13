// An app's copy of the environment it shows: one snapshot fetched over HTTP, then kept current by
// the server's events. Shared by the desktop app's window and the phone app; each brings its own
// connection (see connection.ts) and hands it over with `useTransport`.
import { useSyncExternalStore } from 'react'
import type { AppState, ClientEvent, Item, Partial, Principles, ServerEvent, Settings, Thread } from '@openkumi/shared'
import type { Link } from '@openkumi/shared/desktop'
import { reach } from './addresses'
import type { Command, Report } from './connection'

export interface State extends AppState {
  /** Items of threads that have been opened, by thread id: the newest pages of each, not all of it. */
  items: Record<string, Item[]>
  /** Whether a thread that has been opened has older items than the ones held, to load with `loadOlder`. */
  older: Record<string, boolean>
  partial: Record<string, Partial>
  /** Counts changes to each bot's workspace, so views of its files know when to refetch. */
  filesVersion: Record<string, number>
  connected: boolean
  loaded: boolean
  /** How many times in a row the environment could not be reached. */
  failures: number
  /** The environment answered, but did not accept the access code. */
  refused: boolean
  /** The environment runs an OpenKumi too old to show who it is, so it is not sent the key. */
  outdated: boolean
  /** The address the connection uses, once one has shown it is the environment's server. */
  address: string | null
}

/** What is known before an environment has answered. */
const EMPTY: State = {
  bots: [],
  threads: [],
  tasks: [],
  providers: [],
  browsers: {},
  superpowers: [],
  superpowerCategories: [],
  superpowerStatus: {},
  home: '',
  settings: {} as Settings,
  defaults: {} as Settings,
  principles: { text: '', custom: false, default: '' },
  about: { version: '', node: '', platform: '', port: 0, lanForced: false, timeZone: '' },
  items: {},
  older: {},
  partial: {},
  filesVersion: {},
  connected: false,
  loaded: false,
  failures: 0,
  refused: false,
  outdated: false,
  address: null,
}
let state = EMPTY
const subscribers = new Set<() => void>()
/** While a batch of events is applied, the views are told once at the end instead of after each one. */
let batching = false
let changed = false

function set(patch: globalThis.Partial<State>) {
  state = { ...state, ...patch }
  if (batching) changed = true
  else subscribers.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

/** Selectors must return a value that is stable while the state is unchanged (a slice, not a new object). */
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state))
}

// ---- the environment being shown

/** The environment the window shows: its addresses and access code. */
let link: Link | null = null
/** Where requests go: the address that last showed it is the environment's server. Null while there is none. */
let at: string | null = null
const leaving = new Set<() => void>()
/** `fn` is called when the window moves to another environment, to forget what was kept about the one left. */
export function onEnvironmentChange(fn: () => void) {
  leaving.add(fn)
}
/** Counts the environments shown, so an answer from one that was left behind can be told apart. */
let epoch = 0

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * A request to the environment, carrying its access code. `body` is sent as it is. Made while no
 * address has shown it is the server (the connection is being made again), it waits for one.
 */
export async function request(method: string, path: string, body?: BodyInit, type?: string): Promise<Response> {
  if (!link) throw new Error('No environment is connected.')
  const base = at ?? (await arrival())
  const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${link!.token}`, ...(type ? { 'Content-Type': type } : {}) }, body })
  if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`)
  return res
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = body ? await request(method, path, JSON.stringify(body), 'application/json') : await request(method, path)
  return res.json().catch(() => ({}))
}

/** Changes app-wide settings. The page shows the new values at once; the server confirms them or the old ones come back. */
export async function saveSettings(patch: globalThis.Partial<Settings>) {
  const before = state.settings
  const asked = epoch
  set({ settings: { ...before, ...patch } })
  try {
    const saved = await api<Settings>('PATCH', '/api/settings', patch)
    // Another environment is showing by now; the answer is about the one that was left.
    if (asked === epoch) set({ settings: saved })
  } catch (e) {
    if (asked === epoch) set({ settings: before })
    throw e
  }
}

/** Changes what every bot is told first; null puts back the ones OpenKumi comes with. */
export async function savePrinciples(text: string | null) {
  const asked = epoch
  const saved = await api<Principles>('PUT', '/api/principles', { text })
  if (asked === epoch) set({ principles: saved })
}

const upsert = <T extends { id: string }>(list: T[], value: T) =>
  list.some((x) => x.id === value.id) ? list.map((x) => (x.id === value.id ? value : x)) : [...list, value]

const omit = <T,>(record: Record<string, T>, key: string) => {
  const { [key]: _, ...rest } = record
  return rest
}

/** What the socket delivered for a thread while its history was being fetched. */
interface Loading {
  items: Item[]
  text: string
  reasoning: string
  /** A finished message/thought arrived, so streaming text from before it is obsolete. */
  cutText: boolean
  cutReasoning: boolean
  upserted: boolean
}
const loading = new Map<string, Loading>()


function handle(ev: ServerEvent) {
  switch (ev.type) {
    case 'bot.upsert':
      return set({ bots: upsert(state.bots, ev.bot) })
    case 'bot.delete':
      return set({ bots: state.bots.filter((b) => b.id !== ev.id) })
    case 'thread.upsert': {
      const during = loading.get(ev.thread.id)
      if (during) during.upserted = true
      const patch: globalThis.Partial<State> = { threads: upsert(state.threads, ev.thread) }
      if (ev.thread.status !== 'running') patch.partial = omit(state.partial, ev.thread.id)
      return set(patch)
    }
    case 'thread.delete':
      return set({ threads: state.threads.filter((t) => t.id !== ev.id), items: omit(state.items, ev.id), older: omit(state.older, ev.id) })
    case 'task.upsert':
      return set({ tasks: upsert(state.tasks, ev.task) })
    case 'task.delete':
      return set({ tasks: state.tasks.filter((t) => t.id !== ev.id) })
    case 'item.add': {
      const { threadId, data } = ev.item
      const list = state.items[threadId]
      if (!list) {
        // The thread may be loading right now; keep the item so the load can merge it in.
        const during = loading.get(threadId)
        if (during) {
          during.items.push(ev.item)
          if (data.type === 'message' && data.role === 'assistant') (during.text = ''), (during.cutText = true)
          if (data.type === 'reasoning') (during.reasoning = ''), (during.cutReasoning = true)
        }
        return
      }
      if ((list.at(-1)?.id ?? 0) >= ev.item.id) return
      const partial = state.partial[threadId]
      const cleared =
        partial && data.type === 'message' && data.role === 'assistant' ? { ...partial, text: '' }
        : partial && data.type === 'reasoning' ? { ...partial, reasoning: '' }
        : partial
      return set({
        items: { ...state.items, [threadId]: [...list, ev.item] },
        partial: cleared ? { ...state.partial, [threadId]: cleared } : state.partial,
      })
    }
    case 'stream.delta': {
      const during = loading.get(ev.threadId)
      if (during) during[ev.kind] += ev.delta
      const partial = state.partial[ev.threadId] ?? { text: '', reasoning: '' }
      return set({ partial: { ...state.partial, [ev.threadId]: { ...partial, [ev.kind]: partial[ev.kind] + ev.delta } } })
    }
    case 'providers':
      return set({ providers: ev.providers })
    case 'settings':
      return set({ settings: ev.settings })
    case 'principles':
      return set({ principles: ev.principles })
    case 'superpowers':
      return set({ superpowers: ev.superpowers, superpowerCategories: ev.categories })
    case 'superpower.status': {
      const { [ev.id]: _, ...rest } = state.superpowerStatus[ev.botId] ?? {}
      return set({ superpowerStatus: { ...state.superpowerStatus, [ev.botId]: ev.status ? { ...rest, [ev.id]: ev.status } : rest } })
    }
    case 'files.changed':
      return set({ filesVersion: { ...state.filesVersion, [ev.botId]: (state.filesVersion[ev.botId] ?? 0) + 1 } })
    case 'browser.state':
      return set({ browsers: { ...state.browsers, [ev.botId]: ev.state } })
  }
}

/** Applies what arrived since the last frame, then tells the views once. */
function apply(events: ServerEvent[]) {
  batching = true
  try {
    for (const event of events) handle(event)
  } finally {
    batching = false
    if (changed) {
      changed = false
      subscribers.forEach((fn) => fn())
    }
  }
}

// ---- the connection, which the app provides

let tell: (command: Command) => void = () => {}
/** Gives the store the connection to use. What the connection reports goes to `receive`. */
export function useTransport(command: (command: Command) => void) {
  tell = command
}

export function send(event: ClientEvent) {
  tell({ type: 'send', event })
}

let learn: (id: string, learned: { serverId?: string; addresses?: string[] }) => void = () => {}
/**
 * `fn` is told what was learned about the environment being shown: its server's id, once an
 * address has shown it, and the addresses the server reports. The app keeps them with the environment.
 */
export function onLearn(fn: typeof learn) {
  learn = fn
}

/**
 * Shows this environment, leaving the one shown before. With null there is nothing to show. The
 * window stays as it is; only what it is connected to changes.
 */
export function follow(next: Link | null) {
  if (next && link && next.id === link.id) {
    // The same environment with its addresses brought up to date, or with a new access code: what
    // is on screen stays. An address it no longer has is left; a new code is used from now on.
    const renewed = next.token !== link.token
    link = { ...next, serverId: next.serverId ?? link.serverId }
    if (at && !next.addresses.includes(at)) tell({ type: 'reconnect' })
    else if (renewed && !state.connected) void find()
    return
  }
  epoch++
  opens++
  waiting = null
  at = null
  arrived(null)
  clearTimeout(again)
  // Whatever was being fetched belonged to the environment that is being left.
  loading.clear()
  leaving.forEach((fn) => fn())
  set(EMPTY)
  link = next
  if (next) void find()
  else tell({ type: 'disconnect' })
}

// ---- finding the address to connect to
// A remote environment is only sent its key at an address that has just shown it is the
// environment's server (see addresses.ts). The connection is made there, and again after every
// drop, each time after asking. On this computer the app has already made sure who it is talking
// to (apps/desktop/src/local.ts), so the one address is used as it is.

/** Set while the addresses are being asked, so two askings never overlap. */
let finding = false
let again: ReturnType<typeof setTimeout> | undefined

function connectTo(url: string) {
  at = url
  set({ address: url })
  tell({ type: 'connect', epoch, url: `${url.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(link!.token)}` })
  arrived(url)
}

/** Finds an address where the environment's server answers, and connects there. Tries again until one does. */
async function find() {
  clearTimeout(again)
  if (!link) return
  // The addresses are being asked already (by `keep`): once that is done, this asks afresh.
  if (finding) return void (again = setTimeout(find, 1000))
  if (link.local) return connectTo(link.addresses[0])
  const asked = epoch
  finding = true
  try {
    const { found, answers } = await reach(link.addresses, link.token, link.serverId)
    if (asked !== epoch || !link) return
    if (found) {
      if (!link.serverId && found.serverId) {
        link = { ...link, serverId: found.serverId }
        learn(link.id, { serverId: found.serverId })
      }
      return connectTo(found.url)
    }
    const refused = answers.some((probe) => probe.answer === 'refused')
    const outdated = !refused && answers.some((probe) => probe.answer === 'outdated')
    set({ refused, outdated, failures: state.failures + 1 })
    again = setTimeout(find, refused || outdated ? 5000 : 2000)
  } finally {
    finding = false
  }
}

/**
 * While connected, asks the addresses again: moves to an earlier one that answers (home again,
 * after Tailscale), or to a later one when the one in use stopped answering, and leaves the one in
 * use at once if something else answers there now.
 */
async function keep() {
  if (finding || !link || link.local || !at || !state.connected) return
  const asked = epoch
  const was = at
  finding = true
  try {
    const { found, answers } = await reach(link.addresses, link.token, link.serverId)
    if (asked !== epoch || at !== was) return
    if (found && found.url !== was) return connectTo(found.url)
    const here = answers.find((probe) => probe.url === was)?.answer
    if (here === 'other' || here === 'refused') tell({ type: 'reconnect' })
  } finally {
    finding = false
  }
}

setInterval(() => void keep(), 60_000)

/** Asks again now: the app calls it when the network changes or the app comes back to the front. */
export function recheck() {
  if (!link || link.local) return
  if (state.connected) void keep()
  else void find()
}

let arrivals: ((url: string | null) => void)[] = []
function arrived(url: string | null) {
  const waiting = arrivals
  arrivals = []
  waiting.forEach((fn) => fn(url))
}
/** The address requests go to, once there is one. */
function arrival(): Promise<string> {
  return new Promise((resolve, reject) => {
    const done = (url: string | null) => {
      clearTimeout(late)
      arrivals = arrivals.filter((fn) => fn !== done)
      if (url) resolve(url)
      else reject(new Error(`${link?.name ?? 'The environment'} cannot be reached right now.`))
    }
    const late = setTimeout(() => done(null), 15_000)
    arrivals.push(done)
  })
}

/** Counts the times the socket opened, so a snapshot fetched for an earlier opening is dropped. */
let opens = 0
// Events that arrive while the snapshot is being fetched are newer than it, so they wait and
// are applied on top once it is in place.
let waiting: ServerEvent[] | null = null

async function opened() {
  const mine = ++opens
  waiting = []
  // Anything may have changed while disconnected: refetch, and drop cached threads so they reload.
  const snapshot = await api<AppState>('GET', '/api/state').catch((e: unknown) => (e instanceof ApiError ? e.status : 0))
  if (mine !== opens) return
  if (typeof snapshot === 'number') {
    // A failed snapshot means the connection is not usable; dropping it triggers the normal retry.
    waiting = null
    set({ refused: snapshot === 401, failures: state.failures + 1 })
    return tell({ type: 'reconnect' })
  }
  // History requests still in flight were recording the old connection and missed whatever
  // happened while disconnected, so their responses are abandoned and the loads start over.
  const interrupted = [...loading.keys()]
  loading.clear()
  const events = waiting ?? []
  waiting = null
  batching = true
  set({ ...snapshot, items: {}, older: {}, partial: {}, connected: true, loaded: true, failures: 0, refused: false, outdated: false })
  apply(events)
  for (const id of interrupted) loadThread(id).catch(() => {})
  // The server says where else it can be reached; the app keeps that, for when this address stops answering.
  const shown = link
  if (shown && !shown.local)
    void api<{ addresses?: string[] }>('GET', '/api/addresses')
      .then(({ addresses }) => mine === opens && Array.isArray(addresses) && learn(shown.id, { addresses }))
      .catch(() => {})
}

/** What the connection reports: it opened, it closed, or events arrived. */
export function receive(data: Report) {
  // About an environment that has been left.
  if (data.epoch !== epoch) return
  if (data.type === 'open') return void opened()
  if (data.type === 'events') return waiting ? void waiting.push(...data.events) : apply(data.events)
  // Closed, or never opened. Before connecting again, the address is asked who it is again.
  opens++
  waiting = null
  at = null
  set({ connected: false, address: null, failures: state.connected ? 0 : state.failures + 1 })
  clearTimeout(again)
  again = setTimeout(find, 1000)
}

/** Joins the server's copy of streaming text with what the socket delivered since, without repeating the overlap. */
function join(server: string, live: string): string {
  for (let k = Math.min(server.length, live.length); k > 0; k--) {
    if (server.endsWith(live.slice(0, k))) return server + live.slice(k)
  }
  return server + live
}

/**
 * Fetches a thread with its newest page of items, and adds the thread to the list if it was not
 * in it (the list holds only recent subagents and runs). Resolves with the thread.
 */
export async function loadThread(id: string): Promise<Thread | undefined> {
  // One request per thread at a time: a second, overlapping one could finish first and then be
  // overwritten by the older response. The request already in flight will deliver the result.
  if (loading.has(id)) return
  // While the request is in flight the socket keeps delivering; record it so it can be laid over the response.
  const during: Loading = { items: [], text: '', reasoning: '', cutText: false, cutReasoning: false, upserted: false }
  loading.set(id, during)
  try {
    const res = await api<{ thread: Thread; items: Item[]; more: boolean; partial: Partial }>('GET', `/api/threads/${id}`)
    // Abandoned by a reconnect or a change of environment: a fresh load has replaced this one.
    if (loading.get(id) !== during) return
    // Items are append-only, so any that arrived meanwhile can simply be added on.
    const last = res.items.at(-1)?.id ?? 0
    const extra = during.items.filter((i) => i.id > last)
    // A status the socket reported is newer than the response's.
    const thread = (during.upserted && state.threads.find((t) => t.id === id)) || res.thread
    const running = thread.status === 'running'
    // A finished message that arrived meanwhile supersedes the server's streaming text for it.
    const partial = {
      text: !running ? '' : during.cutText ? during.text : join(res.partial.text, during.text),
      reasoning: !running ? '' : during.cutReasoning ? during.reasoning : join(res.partial.reasoning, during.reasoning),
    }
    set({
      threads: upsert(state.threads, thread),
      items: { ...state.items, [id]: [...res.items, ...extra] },
      older: { ...state.older, [id]: res.more },
      partial: { ...state.partial, [id]: partial },
    })
    return thread
  } finally {
    if (loading.get(id) === during) loading.delete(id)
  }
}

/** Threads whose older items are being fetched: one page at a time each. */
const fetchingOlder = new Set<string>()

/**
 * Fetches the page that comes before the oldest item held of an opened thread, or with `to`
 * everything back to that item (a message found by searching). An answer that arrives after the
 * thread was loaded afresh (the connection came back meanwhile) is dropped. Resolves with whether
 * anything was put in front of what was held.
 */
export async function loadOlder(id: string, to?: number): Promise<boolean> {
  const held = state.items[id]
  if (!held?.length || !state.older[id] || fetchingOlder.has(id)) return false
  const first = held[0].id
  const asked = epoch
  fetchingOlder.add(id)
  try {
    const res = await api<{ items: Item[]; more: boolean }>('GET', `/api/threads/${id}?before=${first}${to ? `&from=${to}` : ''}`)
    if (asked !== epoch || state.items[id]?.[0]?.id !== first) return false
    const earlier = res.items.filter((i) => i.id < first)
    set({ items: { ...state.items, [id]: [...earlier, ...state.items[id]] }, older: { ...state.older, [id]: res.more } })
    return earlier.length > 0
  } finally {
    fetchingOlder.delete(id)
  }
}

/** A bot's conversation with its owner: its one chat that is not archived. There is none until something has been said. */
export function mainThread(threads: Thread[], botId: string): Thread | undefined {
  return threads.find((t) => t.botId === botId && !t.parentId && !t.archivedAt)
}

/** The subagents (and scheduled runs) under a thread, at every depth, that are at work or were until a moment ago: the ones worth showing beside it. */
export function recentSubagents(threads: Thread[], root: Thread, withinMs = 60 * 60_000): Thread[] {
  const found: Thread[] = []
  const collect = (parent: Thread) => {
    for (const t of threads) {
      if (t.parentId !== parent.id) continue
      if (t.status === 'running' || Date.now() - t.updatedAt < withinMs) found.push(t)
      collect(t)
    }
  }
  collect(root)
  return found
}

/** The top-level chat a (possibly nested) subagent thread belongs to. */
export function rootOf(threads: Thread[], thread: Thread): Thread {
  let t = thread
  while (t.parentId) {
    const parent = threads.find((x) => x.id === t.parentId)
    if (!parent) break
    t = parent
  }
  return t
}

/** The environment being shown, for the few places that need its address. */
export const currentLink = () => link

/**
 * Where to load something of the environment's from (`path`, such as "/api/threads/…"), with the
 * key to send, for a view that loads it itself (a picture on the phone). Null while the environment
 * cannot be reached; the view is drawn again when it can.
 */
export function useServerFile(path: string): { uri: string; headers: Record<string, string> } | null {
  const address = useStore((s) => s.address)
  if (!address || !link) return null
  return { uri: address + path, headers: { Authorization: `Bearer ${link.token}` } }
}
