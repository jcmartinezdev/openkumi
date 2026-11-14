// Watches: what an automation that runs "when something changes" looks at. OpenKumi looks, not a
// model: it reads the thing, reduces what it read to a fingerprint, and compares that with the one
// from the look before, so a run is only spent when there is news. What can be watched is one of
// the bot's superpower tools that only reads, or a public web address. When it runs what it found
// is decided in automations.ts.
import crypto from 'node:crypto'
import dns from 'node:dns'
import https from 'node:https'
import net from 'node:net'
import type { Watch } from '@openkumi/shared'
import { NeedsSignIn, serviceTool } from './mcp.ts'
import { nearby } from './network.ts'

/** The shortest time, in minutes, between two looks: often enough for news, seldom enough for the service watched. */
export const MIN_EVERY = 5
const DEFAULT_EVERY = 15
const MAX_EVERY = 24 * 60
/** Above this many items a watch keeps only the fingerprint, and says how many there are. */
const MAX_ITEMS = 2000
/** How many items of each kind (new, updated, gone) a run is told by name. */
const MAX_LISTED = 20
const MAX_DETAIL = 1500
const MAX_BYTES = 1_000_000
const TIMEOUT = 60_000
/** What an item is called in what a run is told: the first of these it has. */
const TITLES = ['title', 'name', 'subject', 'summary', 'filename', 'identifier', 'key']

/** A watch that cannot work as it is set up, however often it is tried: the automation is paused. Any other failure may pass. */
export class WatchError extends Error {}

interface Item {
  /** The values of the tracked fields, as text. */
  fields: string
  title: string
}

/** What a look found, reduced to what the next look is compared with. */
export interface Reading {
  fingerprint: string
  /** With `track`: the items by what tells them apart, unless there are too many to keep. */
  items?: Record<string, Item>
  /** With `track`: how many items there are. */
  count?: number
  /** Without `track`: the start of what a tool gave back, for the run to read. */
  text?: string
}

/** What the last look that worked found, and since when every look after it has failed. */
export interface Seen extends Reading {
  failingSince?: number
}

const hash = (text: string) => crypto.createHash('sha256').update(text).digest('hex')
const clip = (text: string, most = MAX_DETAIL) => (text.length > most ? `${text.slice(0, most)}…` : text)

/** JSON with its keys in order, so the same data always reads the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((k) => `${JSON.stringify(k)}:${stable(record[k])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

// ---- what is watched

/** A watch from what was sent, checked: the tool is one of the bot's and only reads, the address is a public one. */
export async function cleanWatch(botId: string, input: any): Promise<Watch> {
  const every = input?.every === undefined || input?.every === null ? DEFAULT_EVERY : Math.round(Number(input.every))
  if (!Number.isFinite(every) || every < MIN_EVERY) throw new Error(`A watch can look at most every ${MIN_EVERY} minutes.`)
  const given: unknown[] = Array.isArray(input?.track) ? input.track : []
  const track = [...new Set(given.map((f) => String(f).trim()).filter((f) => f && f.length <= 100))]
  if (track.length > 5) throw new Error('A watch can track at most five fields: the one that tells items apart, and four more.')
  const base = { every: Math.min(every, MAX_EVERY), track }
  if (input?.on === 'page') return { ...base, on: 'page', url: publicUrl(String(input.url ?? '')).href }
  if (input?.on !== 'tool') throw new Error('A watch is on a "tool" or on a "page".')
  const args = input.arguments ?? {}
  if (typeof args !== 'object' || Array.isArray(args) || JSON.stringify(args).length > 4000) throw new Error('The arguments of a watched tool are a small JSON object.')
  const tool = await find(botId, String(input.tool ?? ''))
  return { ...base, on: 'tool', tool: tool.name, arguments: args, app: tool.app }
}

/** A watch in a few words, for the bot and for a run: "Linear (mcp__linear__list_issues)", or the address. */
export const describeWatch = (watch: Watch) => (watch.on === 'tool' ? `${watch.app} (${watch.tool})` : watch.url)

/** The tool a watch calls, if the bot still has it and it only reads. */
async function find(botId: string, name: string) {
  let tool: Awaited<ReturnType<typeof serviceTool>>
  try {
    tool = await serviceTool(botId, name)
  } catch (e: any) {
    // A sign-in that lapsed is the owner's to renew; until then no look can work.
    throw e instanceof NeedsSignIn ? new WatchError(e.message) : e
  }
  if (!tool) throw new WatchError(`The bot has no superpower tool named "${name}". A watch calls one of the tools a superpower brings.`)
  if (!tool.readOnly) throw new WatchError(`${name} can change things, so it cannot be watched. Choose a tool that only reads.`)
  return tool
}

// ---- looking

/** How a public page is fetched; a test brings its own. */
export type Get = (address: string, signal: AbortSignal) => Promise<{ status: number; type: string; body: string }>

/** One look at what a watch watches. */
export async function read(botId: string, watch: Watch, signal?: AbortSignal, get: Get = getPublic): Promise<Reading> {
  const within = AbortSignal.any([AbortSignal.timeout(TIMEOUT), ...(signal ? [signal] : [])])
  if (watch.on === 'page') {
    const page = await get(watch.url, within)
    if (page.status === 408 || page.status === 429 || page.status >= 500) throw new Error(`The page answered ${page.status}.`)
    if (page.status < 200 || page.status >= 300) throw new WatchError(`The page answered ${page.status}.`)
    const data = json(page.body)
    if (watch.track.length) return itemsOf(data, watch.track)
    // A page is compared as the text a reader sees, so its scripts and styling do not count as news.
    return { fingerprint: hash(data === undefined ? (page.type.includes('html') ? htmlText(page.body) : page.body) : stable(data)) }
  }
  const tool = await find(botId, watch.tool)
  let result: Awaited<ReturnType<typeof tool.call>>
  try {
    result = await tool.call(watch.arguments, within)
  } catch (e) {
    throw e instanceof NeedsSignIn ? new WatchError(e.message) : e
  }
  const text = (result.content ?? []).map((block) => (block.type === 'text' ? block.text : '')).filter(Boolean).join('\n')
  if (result.isError) throw new Error(`${watch.tool} failed: ${clip(text || 'no reason given', 300)}`)
  const structured = result.structuredContent
  const data = structured && typeof structured === 'object' ? structured : json(text)
  if (watch.track.length) return itemsOf(data, watch.track)
  return { fingerprint: hash(data === undefined ? text : stable(data)), text: clip(text || stable(data)) }
}

function json(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * The items in a JSON result: the objects in a list, however deep the list is, that have the first
 * tracked field. What is inside an item is the item's own (its author, its attachments), not more
 * items. A result that is one such object and no list is one item.
 */
function itemsOf(data: unknown, track: string[]): Reading {
  if (data === undefined) throw new WatchError('What came back is not JSON, so items cannot be told apart in it. Leave out track to watch it as a whole.')
  const [identity, ...fields] = track
  const found = new Map<string, { fields: string[]; title: string }>()
  const named = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value) && ['string', 'number'].includes(typeof (value as Record<string, unknown>)[identity])
  const add = (record: Record<string, unknown>) => {
    const id = String(record[identity])
    const item = found.get(id) ?? { fields: [], title: '' }
    item.fields.push(stable(fields.map((f) => record[f] ?? null)))
    const title = TITLES.map((t) => record[t]).find((t) => typeof t === 'string' && t.trim())
    if (!item.title && typeof title === 'string') item.title = title.replace(/\s+/g, ' ').trim().slice(0, 120)
    found.set(id, item)
  }
  const pending: { value: unknown; depth: number; listed: boolean }[] = [{ value: data, depth: 0, listed: false }]
  while (pending.length) {
    const { value, depth, listed } = pending.pop()!
    if (!value || typeof value !== 'object') continue
    if (depth > 64) throw new WatchError('What came back is nested too deeply to look through.')
    if (listed && named(value)) add(value)
    else for (const child of Object.values(value)) pending.push({ value: child, depth: depth + 1, listed: Array.isArray(value) })
  }
  if (!found.size && named(data)) add(data)
  // An item found twice in one result keeps both sets of values, in an order that does not depend on where they were.
  const items: Record<string, Item> = {}
  for (const id of [...found.keys()].sort()) items[id] = { fields: found.get(id)!.fields.sort().join('|'), title: found.get(id)!.title || id }
  const fingerprint = hash(stable(Object.fromEntries(Object.entries(items).map(([id, item]) => [id, item.fields]))))
  return found.size > MAX_ITEMS ? { fingerprint, count: found.size } : { fingerprint, items, count: found.size }
}

/** Whether a look found news, and what the run is told about it. A first look only notes where things stand. */
export function compare(seen: Reading | null, reading: Reading): { outcome: 'baseline' | 'unchanged' | 'changed'; detail: string | null } {
  if (!seen) return { outcome: 'baseline', detail: standing(reading) }
  if (seen.fingerprint === reading.fingerprint) return { outcome: 'unchanged', detail: null }
  if (seen.items && reading.items) return { outcome: 'changed', detail: changes(seen.items, reading.items) }
  return { outcome: 'changed', detail: reading.count !== undefined ? `${reading.count} items; something among them changed.` : (reading.text ?? null) }
}

/** Where things stand at a first look, for whoever set the watch up to check it against what they meant. */
function standing(reading: Reading): string {
  if (reading.count === undefined) return 'Watching it as a whole: any change in it starts a run.'
  return `${reading.count} ${reading.count === 1 ? 'item' : 'items'} now. A run starts when one is new, updated or gone.`
}

function changes(before: Record<string, Item>, after: Record<string, Item>): string {
  const added = Object.keys(after).filter((id) => !(id in before))
  const updated = Object.keys(after).filter((id) => id in before && before[id].fields !== after[id].fields)
  const gone = Object.keys(before).filter((id) => !(id in after))
  const list = (label: string, ids: string[], from: Record<string, Item>) => {
    if (!ids.length) return []
    const shown = ids.slice(0, MAX_LISTED).map((id) => (from[id].title === id ? id : `${from[id].title} (${id})`))
    return [`${label}: ${shown.join('; ')}${ids.length > shown.length ? ` (and ${ids.length - shown.length} more)` : ''}`]
  }
  return clip([...list('New', added, after), ...list('Updated', updated, after), ...list('Gone', gone, before)].join('\n'))
}

/**
 * What a run a watch started is told after the automation's prompt. What changed was read from the
 * app or page being watched, so anyone may have written it: it is set apart, and nothing in it can
 * end the part it is in. Without a `change`, the run was started by hand.
 */
export function note(watch: Watch, change: { detail: string | null } | null): string {
  if (!change) return `\n\n<watch_change>\nThis run was started by hand, not by a change in what this automation watches: ${describeWatch(watch)}.\n</watch_change>`
  const what = change.detail ? `\nWhat changed since the last look:\n${change.detail.replace(/<\/?watch_change>/gi, '')}` : '\nWhat changed is not known: look at it yourself.'
  return `\n\n<watch_change>\nThis run was started because what this automation watches changed: ${describeWatch(watch)}.${what}\n</watch_change>`
}

// ---- public pages

/** The text of a web page as a reader sees it, without its scripts, styling and markup. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
}

/**
 * Whether an address is out on the internet. A watch is fetched by OpenKumi itself, again and again
 * with nobody looking, so it must not reach this computer, the home network or Tailscale, where
 * things answer that were never meant for a bot.
 */
export function isPublic(ip: string): boolean {
  const mapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  const plain = mapped ? [parseInt(mapped[1], 16) >> 8, parseInt(mapped[1], 16) & 255, parseInt(mapped[2], 16) >> 8, parseInt(mapped[2], 16) & 255].join('.') : ip.replace(/^::ffff:/i, '')
  if (!net.isIP(plain) || nearby(plain)) return false
  if (net.isIPv4(plain)) {
    const first = Number(plain.split('.')[0])
    return first !== 0 && first < 224
  }
  return plain !== '::' && !/^ff/i.test(plain)
}

/** A web address a watch may be on: https, without a sign-in in it, and not a private place written as a number. */
function publicUrl(address: string): URL {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw new WatchError('A watched page needs a web address, like https://example.com/prices.')
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw new WatchError('A watched page needs an https address, without a sign-in in it.')
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || (net.isIP(host) && !isPublic(host))) throw new WatchError('Only public web addresses can be watched, not this computer or its network.')
  return url
}

/** Looks a name up, and refuses it when it leads anywhere but the internet; checked at the moment the connection is made. */
const publicLookup: net.LookupFunction = (hostname, options, callback) =>
  dns.lookup(hostname, options, (error, address, family) => {
    const found = Array.isArray(address) ? address.map((a) => a.address) : [address]
    if (!error && !found.every(isPublic)) error = new WatchError('Only public web addresses can be watched, not this computer or its network.') as NodeJS.ErrnoException
    ;(callback as (...args: unknown[]) => void)(error, address, family)
  })

/** Fetches a public page: no sign-in, a size limit, and every redirect held to the same rules. */
const getPublic: Get = (address, signal) => {
  const hop = (url: URL, hops: number): Promise<Awaited<ReturnType<Get>>> =>
    new Promise((resolve, reject) => {
      const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; OpenKumi/0.1)', Accept: 'text/html,application/json,text/plain,*/*', 'Accept-Encoding': 'identity' }
      const request = https.get(url, { signal, lookup: publicLookup, headers }, (res) => {
        const status = res.statusCode ?? 0
        const next = status >= 300 && status < 400 ? res.headers.location : undefined
        if (next) {
          res.resume()
          if (hops >= 5) return reject(new WatchError('The page redirects too many times.'))
          try {
            return resolve(hop(publicUrl(new URL(next, url).href), hops + 1))
          } catch (e) {
            return reject(e)
          }
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_BYTES) request.destroy(new WatchError('The page is larger than a watch reads (1 MB).'))
          else chunks.push(chunk)
        })
        res.on('end', () => resolve({ status, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      })
      request.on('error', reject)
    })
  try {
    return hop(publicUrl(address), 0)
  } catch (e) {
    return Promise.reject(e)
  }
}
