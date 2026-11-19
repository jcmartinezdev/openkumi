// What OpenKumi tells the people who make it: how it is used, and what goes wrong in it.
//
// Only the server sends, never an app, and only once its owner has said yes. Until someone has
// answered (settings().telemetry is null) what happens is kept in memory: it is sent after a yes
// and dropped after a no. The apps ask the question, once, the first time they meet a server that
// has not been asked. A server that would send nothing whatever the answer (one run from its
// source, one told not to where it is started) says so, and is not asked about.
//
// EVENTS (telemetry-events.ts) is the whole of what can be sent, and the page in the docs is written from it
// (apps/docs/scripts/telemetry.mjs). Nothing a person wrote or named is in it: no message, no
// name of a bot or a file, no address. What an event carries is checked against the list as it is
// recorded, so a value that is not one of the choices listed for it never leaves this computer.
//
// It goes to PostHog, in the EU, as plain web requests: one random id per server, made when its
// owner agrees and thrown away when they switch this off.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { HOME, ROOT, VERSION } from './config.ts'
import { onSettingsChange, settings } from './settings.ts'
import { ALWAYS, type Carried, ENGINES, EVENTS, FROM_APP, type Kind, type Spec } from './telemetry-events.ts'
import { HOW } from './update.ts'

/**
 * The PostHog project everything goes to (in the EU). A project's key can only be used to write
 * to it, so it is no secret and is kept here in the code, as PostHog means it to be.
 */
const PROJECT_KEY = 'phc_CGoZDfLwmmpZwbgDTuVWEKnzhrGWyGfyt9XEoKChQBqY'
const KEY = process.env.OPENKUMI_TELEMETRY_KEY ?? PROJECT_KEY
/** Where it is sent. Tests, and anyone trying this out from the source, name another place. */
const ELSEWHERE = (process.env.OPENKUMI_TELEMETRY_URL ?? '').replace(/\/+$/, '')
/**
 * An address of OpenKumi's own that PostHog answers at (its "managed reverse proxy"), and behind
 * it PostHog in the EU. Being OpenKumi's, it can be pointed elsewhere without a version that is
 * already installed having to change.
 */
const ADDRESS = ELSEWHERE || 'https://pulse.openkumi.ai'

/**
 * Run from the repository: by hand, or inside the desktop app as someone working on OpenKumi
 * starts it. What is tried out there is not how OpenKumi is used, so it is not sent.
 */
const FROM_SOURCE = HOW === 'source' || fs.existsSync(path.join(ROOT, '..', '..', '.git'))

/** Why this server sends nothing whatever its owner answers, or '' when it would send. */
const WHY_NOT =
  process.env.OPENKUMI_TELEMETRY === '0' || ['1', 'true'].includes(process.env.DO_NOT_TRACK ?? '')
    ? 'It is switched off where this server is started (OPENKUMI_TELEMETRY=0 or DO_NOT_TRACK=1).'
    : FROM_SOURCE && !ELSEWHERE
      ? 'This OpenKumi runs from its source, and a server run that way sends nothing.'
      : !KEY
        ? 'This version of OpenKumi has nowhere to send anything.'
        : ''

/** What the apps are told: whether to ask, and what to say when there is nothing to ask. */
export const telemetryInfo = () => ({ can: !WHY_NOT, why: WHY_NOT })
const sending = () => !WHY_NOT && settings().telemetry === true
const collecting = () => !WHY_NOT && settings().telemetry !== false

// ---- what can be sent (telemetry-events.ts has the list)

export type EventName = keyof typeof EVENTS
// A list with "other" in it takes any name: one that is not listed is sent as "other".
type ValueOf<K> = K extends readonly string[] ? ('other' extends K[number] ? string : K[number]) : K extends 'count' ? number : K extends 'flag' ? boolean : K extends 'names' ? string[] : string
type Carries<E extends EventName> = { -readonly [P in keyof (typeof EVENTS)[E]['carries']]?: (typeof EVENTS)[E]['carries'][P] extends { is: infer K } ? ValueOf<K> : never }

const VERSION_LIKE = /^\d+\.\d+\.\d+(-[\w.]+)?$/
const NAME_LIKE = /^[A-Za-z0-9$<][\w.:/<>$-]{0,119}$/

/** The value as it may be sent, or undefined when it is not what the list says it can be. */
function allowed(kind: Kind, value: unknown): unknown {
  if (typeof kind !== 'string') return (kind as readonly string[]).includes(value as string) ? value : (kind as readonly string[]).includes('other') && typeof value === 'string' ? 'other' : undefined
  if (kind === 'count') return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined
  if (kind === 'flag') return typeof value === 'boolean' ? value : undefined
  if (kind === 'version') return typeof value === 'string' && VERSION_LIKE.test(value) ? value : undefined
  if (kind === 'name') return typeof value === 'string' && NAME_LIKE.test(value) ? value : undefined
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && NAME_LIKE.test(v)).slice(0, 100) : undefined
}

function checked(carries: Record<string, Carried>, given: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [name, { is }] of Object.entries(carries)) {
    const value = given[name] === undefined ? undefined : allowed(is, given[name])
    if (value !== undefined) out[name] = value
  }
  return out
}

// ---- recording and sending

/** One event as it is sent, and as it is shown to the owner afterwards. */
export interface Sent {
  event: string
  at: string
  properties: Record<string, unknown>
}

const STATE = path.join(HOME, 'telemetry.json')
/** What was sent, for the owner to read: the last few hundred events. */
const LOG = path.join(HOME, 'logs', 'telemetry.ndjson')
/** What a crash left behind for the next start to send (see crashed). */
const CRASH = path.join(HOME, 'telemetry-crash.json')

/** What is remembered between starts: the id (only while this is on), the version last started, and the day of the last summary. */
interface State {
  id?: string
  version?: string
  day?: string
}
function readState(): State {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'))
  } catch {
    return {}
  }
}
let state = readState()
// Switched off while no server ran (“openkumi telemetry off”): the id goes as it would have.
if (settings().telemetry === false && state.id) keep({ id: undefined })

function keep(patch: State) {
  state = { ...state, ...patch }
  for (const key of Object.keys(state) as (keyof State)[]) if (state[key] === undefined) delete state[key]
  try {
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 })
  } catch {
    // Nowhere to write it: the next start asks itself the same things again.
  }
}

/** This server's id, made the first time something is sent. It says nothing about the computer or its owner. */
function identity(): string {
  if (!state.id) keep({ id: crypto.randomUUID() })
  return state.id!
}

/** Recorded and not yet sent. */
let waiting: Sent[] = []
const MOST = 1000
let busy = false
let timer: NodeJS.Timeout | undefined

const common = () => checked(ALWAYS, { version: VERSION, how: HOW, os: process.platform, arch: process.arch })

/** Records that something happened. What it carries has to be in EVENTS; anything else is left out. */
export function track<E extends EventName>(event: E, carries: Carries<E> = {}) {
  if (!collecting()) return
  record(event, { ...checked(EVENTS[event].carries, carries as Record<string, unknown>), ...common() })
}

function record(event: string, properties: Record<string, unknown>, at = new Date()) {
  waiting.push({ event, at: at.toISOString(), properties })
  if (waiting.length > MOST) waiting = waiting.slice(-MOST)
  if (waiting.length >= 50) void flush()
}

/** Sends what is waiting, when the owner has agreed. What cannot be sent now waits for the next time. */
export async function flush(): Promise<void> {
  if (busy || !waiting.length || !sending()) return
  busy = true
  const batch = waiting.splice(0, 100)
  const id = identity()
  try {
    const res = await fetch(`${ADDRESS}/batch/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: KEY,
        // No profile of a person is kept for the id: these are a server's events, not someone's.
        batch: batch.map((e) => ({ event: e.event, distinct_id: id, timestamp: e.at, properties: { ...e.properties, $process_person_profile: false, $lib: 'openkumi-server' } })),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    // Refused as it is (a 4xx): sending it again would be refused again, so it is let go.
    if (!res.ok && (res.status >= 500 || res.status === 408 || res.status === 429)) throw new Error(String(res.status))
    if (res.ok) remember(batch)
  } catch {
    // Still agreed to: it is tried again with what comes next. Switched off meanwhile, it is gone.
    if (sending()) waiting = [...batch, ...waiting].slice(-MOST)
  } finally {
    busy = false
  }
}

function remember(batch: Sent[]) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true })
    fs.appendFileSync(LOG, batch.map((e) => JSON.stringify(e) + '\n').join(''))
    const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean)
    if (lines.length > 600) fs.writeFileSync(LOG, lines.slice(-300).join('\n') + '\n')
  } catch {
    // The record is for the owner to read. Without it, what was sent was still only what is listed above.
  }
}

/** What the owner is shown: the id, what was sent last (newest first), and how much waits to be sent. */
export function report(): { id: string | null; sent: Sent[]; waiting: number } {
  let sent: Sent[] = []
  try {
    sent = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).slice(-100).map((line) => JSON.parse(line)).reverse()
  } catch {
    // Nothing was sent yet.
  }
  return { id: state.id ?? null, sent, waiting: collecting() ? waiting.length : 0 }
}

/** A new id: what is sent from now on cannot be told to come from the server that sent what came before. */
export function newIdentity() {
  if (!sending()) return report()
  keep({ id: crypto.randomUUID() })
  return report()
}

onSettingsChange((now, before) => {
  if (now.telemetry === before.telemetry) return
  if (now.telemetry === true) {
    if (recorded) keep({ day: recorded })
    void flush()
  }
  // Switched off: what waited is dropped, and the id with it. Agreed to again, the server is a new one to PostHog.
  if (now.telemetry === false) {
    waiting = []
    keep({ id: undefined })
  }
})

// ---- what goes wrong

/** One step of the trail through OpenKumi's own code. */
interface Frame {
  file: string
  fn: string
  line: number
  column: number
}

/**
 * The steps of an error's trail that are in OpenKumi's own code, nearest first: the file as it
 * is named in the repository, the function and the line. Whatever else the trail went through
 * (Node, a package, a path on this computer) is left out.
 */
export function ownFrames(stack: unknown, root = ROOT): Frame[] {
  const frames: Frame[] = []
  for (const line of String(stack ?? '').split('\n')) {
    const at = line.match(/^\s+at (?:(?:async )?(.+?) \()?(?:file:\/\/)?(.+?):(\d+):(\d+)\)?$/)
    if (!at) continue
    let file = at[2]
    try {
      file = decodeURIComponent(file)
    } catch {
      // Used as it is.
    }
    file = file.replace(/^\/([A-Za-z]:)/, '$1').replace(/\\/g, '/')
    const base = root.replace(/\\/g, '/').replace(/\/+$/, '') + '/'
    if (!file.startsWith(base) || file.includes('/node_modules/')) continue
    const fn = (at[1] ?? '').replace(/^(?:new |Object\.|Module\.)/, '')
    frames.push({ file: file.slice(base.length), fn: NAME_LIKE.test(fn) ? fn : '', line: Number(at[3]), column: Number(at[4]) })
    if (frames.length >= 30) break
  }
  return frames
}

/** Where an error happened, as a name that stays the same from one time to the next: the file and function nearest to it in OpenKumi's code. */
export function whereOf(e: unknown): string {
  const [first] = ownFrames((e as Error)?.stack)
  return first ? `${first.file}:${first.fn || first.line}` : 'elsewhere'
}

const typeOf = (e: unknown) => {
  const name = (e as Error)?.name
  return typeof name === 'string' && /^[A-Za-z]\w{0,59}$/.test(name) ? name : 'Error'
}

/** What a step of the trail is called when its function has no name. */
const NAMELESS = '<anonymous>'

/** How many times each error was reported today, so that one going wrong over and over is not sent each time. */
let reported = { day: '', counts: new Map<string, number>() }
const today = () => new Date().toISOString().slice(0, 10)

interface Problem {
  type: string
  error: string
  frames: Frame[]
}
const problemOf = (e: unknown): Problem => ({ type: typeOf(e), error: whereOf(e), frames: ownFrames((e as Error)?.stack) })

/**
 * Reports that something went wrong: what kind of error, and where in OpenKumi's code. Never
 * what the error said, which can hold a path, an address or something a person wrote.
 */
export function failed(e: unknown, where: 'run' | 'background') {
  if (!collecting()) return
  problem(problemOf(e), where, true)
}

function problem({ type, error, frames }: Problem, where: 'run' | 'background' | 'crash', handled: boolean) {
  if (reported.day !== today()) reported = { day: today(), counts: new Map() }
  const times = (reported.counts.get(`${type}@${error}`) ?? 0) + 1
  reported.counts.set(`${type}@${error}`, times)
  if (times > 10) return
  const trail = frames.map((f) => `${f.file}:${f.fn || NAMELESS}:${f.line}`)
  record('$exception', {
    ...checked(EVENTS.$exception.carries, { where, error, type, frames: trail }),
    // The same, in the shape PostHog groups and shows errors by. `value` is where it failed, in place of the message.
    $exception_list: [
      {
        type,
        value: error,
        mechanism: { handled, synthetic: false },
        stacktrace: { type: 'raw', frames: frames.map((f) => ({ platform: 'custom', lang: 'javascript', function: f.fn || NAMELESS, filename: f.file, lineno: f.line, colno: f.column, in_app: true })) },
      },
    ],
    ...common(),
  })
}

/**
 * The server is about to end on an error nothing caught. There is no time to send anything, and
 * the owner may not have been asked yet, so what is known is written down for the next start.
 */
export function crashed(e: unknown) {
  if (!collecting()) return
  try {
    fs.writeFileSync(CRASH, JSON.stringify({ ...problemOf(e), version: VERSION, at: new Date().toISOString() }))
  } catch {
    // Then it goes unreported.
  }
}

function lastCrash() {
  let left: (Problem & { version?: string }) | undefined
  try {
    left = JSON.parse(fs.readFileSync(CRASH, 'utf8'))
  } catch {
    return
  }
  fs.rmSync(CRASH, { force: true })
  // Only what this version would itself have written is passed on: a file is not trusted for what it holds.
  if (!left || !collecting() || !Array.isArray(left.frames)) return
  const frames = left.frames.filter((f) => f && typeof f.file === 'string' && NAME_LIKE.test(f.file) && Number.isFinite(f.line) && Number.isFinite(f.column)).map((f) => ({ file: f.file, fn: typeof f.fn === 'string' && NAME_LIKE.test(f.fn) ? f.fn : '', line: Number(f.line), column: Number(f.column) }))
  problem({ type: typeOf({ name: left.type }), error: typeof left.error === 'string' ? left.error : 'elsewhere', frames }, 'crash', false)
}

// ---- the server's own events

/** What the daily summary counts, asked of the server when one is due. */
type Summary = () => Carries<'daily summary'>
let summary: Summary | undefined

/** The day a summary was recorded while nobody had answered yet. It only counts as that day's once it can be sent. */
let recorded = ''

function daily() {
  if (!summary || !collecting() || state.day === today() || recorded === today()) return
  try {
    track('daily summary', summary())
    if (sending()) keep({ day: today() })
    else recorded = today()
  } catch (e) {
    failed(e, 'background')
  }
}

/** Begins with the server: says that it started, passes on what a crash left behind, and sends what is recorded every half minute. */
export function startTelemetry(server: { summary: Summary }) {
  summary = server.summary
  if (WHY_NOT) return
  lastCrash()
  track('server started', state.version && state.version !== VERSION ? { updated_from: state.version } : {})
  if (state.version !== VERSION) keep({ version: VERSION })
  daily()
  timer = setInterval(() => {
    daily()
    void flush()
  }, 30_000)
  timer.unref()
  // A server nobody has an app open on is still waiting to be asked: said once, where it is started.
  if (settings().telemetry === null && HOW === 'installed') {
    console.log('OpenKumi would like to send its makers how it is used and what goes wrong, without anything you or your bots write.\nNothing is sent until you answer: in the app, or here with “openkumi telemetry on” or “openkumi telemetry off”.')
  }
}

/** For the server stopping: one last try to send what is waiting, without holding it up. */
export async function stopTelemetry() {
  clearInterval(timer)
  await Promise.race([flush(), new Promise((resolve) => setTimeout(resolve, 2000).unref())])
}

/**
 * What an app recorded about itself (which screens were opened, that it was opened), handed over
 * for this server to send: the apps send nothing themselves, and have no question of their own.
 * It is checked like anything else: only the events an app may record, and of what each carries
 * only what the list allows. `at` is when it happened, which may be before the app reached this server.
 */
export function fromApp(sender: unknown, events: unknown) {
  if (!collecting() || !Array.isArray(events)) return
  const said = (sender ?? {}) as Record<string, unknown>
  const app = checked(FROM_APP, { app: typeof said.app === 'string' ? said.app : 'other', app_version: said.version, app_os: typeof said.os === 'string' ? said.os : 'other' })
  for (const one of events.slice(0, 50)) {
    const name = typeof one?.event === 'string' ? one.event : ''
    const spec: Spec | undefined = Object.hasOwn(EVENTS, name) ? (EVENTS as Record<string, Spec>)[name] : undefined
    if (spec?.from !== 'app') continue
    const at = new Date(typeof one.at === 'string' ? one.at : NaN).getTime()
    // A time that makes no sense (long ago, or yet to come) is taken to be now.
    const when = at > Date.now() - 7 * 24 * 3600_000 && at < Date.now() + 5 * 60_000 ? new Date(at) : new Date()
    record(name, { ...checked(spec.carries, typeof one.carries === 'object' && one.carries ? one.carries : {}), ...app, ...common() }, when)
  }
  // An app hands things over a few at a time, seconds apart: they go on at once.
  void flush()
}

/**
 * A model as it is sent: the name its maker gives it, as Claude Code, Codex and Grok report it. A
 * local model, or one reached at an address the owner gave, is called whatever its owner called
 * it, so of those only "local" and "other" are said. So is anything that does not look like a
 * model's plain name (one at a cloud provider can be named with the account it is in).
 */
export function modelSent(provider: string, reported: string): string {
  if (provider === 'local') return 'local'
  if (!['codex', 'claude-code', 'grok'].includes(provider)) return 'other'
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(reported) ? reported : reported ? 'other' : 'default'
}

/** An engine as it is sent: one of OpenKumi's own by name, anything else as "other". */
export const engineName = (provider: string) => ((ENGINES as readonly string[]).includes(provider) ? provider : 'other')

/** Each app is counted once a day, however often it connects. */
const seen = new Map<string, string>()
export function appConnected(who: string, app: { app?: string | null; version?: string | null; os?: string | null }, local: boolean) {
  const key = `${who}:${app.app ?? ''}`
  if (seen.get(key) === today()) return
  seen.set(key, today())
  track('app connected', { app: app.app ?? 'other', app_version: app.version ?? undefined, app_os: app.os ?? 'other', local })
}
