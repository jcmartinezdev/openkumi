// An app's copy of the environment it shows: one snapshot fetched over HTTP, then kept current by
// the server's events. Shared by the desktop app's window and the phone app; each brings its own
// connection (see connection.ts) and hands it over with `useTransport`.
import { useSyncExternalStore } from 'react'
import type { AppState, ClientEvent, Item, Partial, ServerEvent, Settings, Skill, Thread } from '@openbot/shared'
import type { Link } from '@openbot/shared/desktop'
import type { Command, Report } from './connection'

export interface State extends AppState {
  /** Items of threads that have been opened, by thread id. */
  items: Record<string, Item[]>
  partial: Record<string, Partial>
  /** Counts changes to each bot's workspace, so views of its files know when to refetch. */
  filesVersion: Record<string, number>
  connected: boolean
  loaded: boolean
  /** How many times in a row the environment could not be reached. */
  failures: number
  /** The environment answered, but did not accept the access code. */
  refused: boolean
}

/** What is known before an environment has answered. */
const EMPTY: State = {
  bots: [],
  threads: [],
  tasks: [],
  providers: [],
  browsers: {},
  skills: [],
  connections: [],
  plugins: [],
  connectionStatus: {},
  home: '',
  settings: {} as Settings,
  defaults: {} as Settings,
  about: { version: '', node: '', platform: '', port: 0, lanForced: false, timeZone: '' },
  items: {},
  partial: {},
  filesVersion: {},
  connected: false,
  loaded: false,
  failures: 0,
  refused: false,
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

/** Where requests go: the address and access code of the environment the window shows. */
let link: Link | null = null
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

/** A request to the environment, carrying its access code. `body` is sent as it is. */
export async function request(method: string, path: string, body?: BodyInit, type?: string): Promise<Response> {
  if (!link) throw new Error('No environment is connected.')
  const res = await fetch(link.url + path, { method, headers: { Authorization: `Bearer ${link.token}`, ...(type ? { 'Content-Type': type } : {}) }, body })
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

/** The skill catalog is a folder the user can add to by hand, so views of it ask again when they open. */
export async function refreshSkills() {
  const asked = epoch
  const skills = await api<Skill[]>('GET', '/api/skills')
  if (asked === epoch) set({ skills })
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
      return set({ threads: state.threads.filter((t) => t.id !== ev.id), items: omit(state.items, ev.id) })
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
    case 'skills':
      return set({ skills: ev.skills })
    case 'connections':
      return set({ connections: ev.connections })
    case 'plugins':
      return set({ plugins: ev.plugins })
    case 'connection.status': {
      const { [ev.name]: _, ...rest } = state.connectionStatus[ev.botId] ?? {}
      return set({ connectionStatus: { ...state.connectionStatus, [ev.botId]: ev.status ? { ...rest, [ev.name]: ev.status } : rest } })
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

/**
 * Shows this environment, leaving the one shown before. With null there is nothing to show. The
 * window stays as it is; only what it is connected to changes.
 */
export function follow(next: Link | null) {
  if (next?.id === link?.id && next?.url === link?.url && next?.token === link?.token) return
  const address = next && `${next.url.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(next.token)}`
  // The same environment with a new access code: what is on screen stays, and the code is used from now on.
  const sameServer = !!next && next.id === link?.id && next.url === link?.url
  link = next
  if (sameServer) return tell({ type: 'retarget', url: address! })
  epoch++
  opens++
  waiting = null
  // Whatever was being fetched belonged to the environment that is being left.
  loading.clear()
  leaving.forEach((fn) => fn())
  set(EMPTY)
  if (address) tell({ type: 'connect', epoch, url: address })
  else tell({ type: 'disconnect' })
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
  set({ ...snapshot, items: {}, partial: {}, connected: true, loaded: true, failures: 0, refused: false })
  apply(events)
  for (const id of interrupted) loadThread(id).catch(() => {})
}

/** What the connection reports: it opened, it closed, or events arrived. */
export function receive(data: Report) {
  // About an environment that has been left.
  if (data.epoch !== epoch) return
  if (data.type === 'open') return void opened()
  if (data.type === 'events') return waiting ? void waiting.push(...data.events) : apply(data.events)
  // Closed, or never opened. The worker keeps trying.
  opens++
  waiting = null
  set({ connected: false, failures: state.connected ? 0 : state.failures + 1 })
  if (state.failures) void diagnose()
}

/**
 * A socket that will not open does not say why. This asks the environment plainly, to tell one
 * that is not there from one that is there and no longer accepts the access code.
 */
async function diagnose() {
  const asked = epoch
  if (!link) return
  const stop = new AbortController()
  const late = setTimeout(() => stop.abort(), 4000)
  const said = await fetch(`${link.url}/api/hello`, { headers: { Authorization: `Bearer ${link.token}` }, signal: stop.signal })
    .then((res) => res.json())
    .catch(() => null)
  clearTimeout(late)
  if (asked === epoch && !state.connected) set({ refused: said?.app === 'open-bot' && said.authorized === false })
}

/** Joins the server's copy of streaming text with what the socket delivered since, without repeating the overlap. */
function join(server: string, live: string): string {
  for (let k = Math.min(server.length, live.length); k > 0; k--) {
    if (server.endsWith(live.slice(0, k))) return server + live.slice(k)
  }
  return server + live
}

export async function loadThread(id: string) {
  // One request per thread at a time: a second, overlapping one could finish first and then be
  // overwritten by the older response. The request already in flight will deliver the result.
  if (loading.has(id)) return
  // While the request is in flight the socket keeps delivering; record it so it can be laid over the response.
  const during: Loading = { items: [], text: '', reasoning: '', cutText: false, cutReasoning: false, upserted: false }
  loading.set(id, during)
  try {
    const res = await api<{ thread: Thread; items: Item[]; partial: Partial }>('GET', `/api/threads/${id}`)
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
      partial: { ...state.partial, [id]: partial },
    })
  } finally {
    if (loading.get(id) === during) loading.delete(id)
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
