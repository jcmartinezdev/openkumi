// A bot's secrets: the API keys, passwords and tokens it works with. Each has a name, the sites it
// may be sent to, and a value that is kept encrypted (vault.ts) in the bot's private folder,
// which its file tools cannot reach:
//   bots/<id>/private/secrets.json
// The bot uses a secret by its name and never sees the value. The server puts it in as a request
// leaves (web_fetch) or types it into a page (browser_type), and only where the secret is for; and
// whatever comes back to the bot has the value taken out of it again. So a secret is neither in
// the conversation, nor in what the model's service is sent, nor in a file the bot keeps.
//
// A value gets in three ways: the owner types it into a card the bot asked for (ask_secret) or
// into the bot's settings, the bot keeps one it came to hold (save_secret), or OpenKumi makes up a
// password the bot never sees. Only the owner replaces, removes or shows one, or changes where it
// may go.
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { Secret, Secrets } from '@openkumi/shared'
import { emit, privateDir } from './config.ts'
import { served } from './network.ts'
import * as vault from './vault.ts'

/** A secret as it is kept: what the apps are shown of it, and its value, encrypted. */
interface Stored extends vault.Sealed {
  name: string
  what: string
  sites: string[]
  by: 'owner' | 'bot'
  createdAt: number
  changedAt: number
  usedAt: number | null
}

const fileOf = (botId: string) => path.join(privateDir(botId), 'secrets.json')

function load(botId: string): Stored[] {
  let text: string
  try {
    text = fs.readFileSync(fileOf(botId), 'utf8')
  } catch (e: any) {
    if (e?.code === 'ENOENT') return []
    throw e
  }
  // A file that cannot be read as what it is, is not taken for an empty one: the next save would write over it.
  const kept = JSON.parse(text)?.secrets
  if (!Array.isArray(kept)) throw new Error('The file this bot’s secrets are kept in is damaged.')
  return kept
}

function store(botId: string, secrets: Stored[], tell = true) {
  const file = fileOf(botId)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // Written beside it and moved into place, so that a write cut short leaves what was there.
  const next = `${file}.new`
  fs.writeFileSync(next, JSON.stringify({ secrets }, null, 2) + '\n', { mode: 0o600 })
  fs.chmodSync(next, 0o600)
  fs.renameSync(next, file)
  if (tell) emit({ type: 'secrets.changed', botId })
}

/** What a value is the value of. A secret moved to another bot or another name does not open. */
const about = (botId: string, name: string) => `${botId}/${name}`

/**
 * Values read so far, so that the vault is not opened anew for every tool result. Each is kept
 * under everything that was checked when it was read: whose it is, under which name, and all that
 * is kept of it. Something copied to another bot or name is not found here, and does not open.
 */
const opened = new Map<string, string>()
const readAs = (botId: string, secret: Stored) => [about(botId, secret.name), secret.key, secret.iv, secret.data].join('\n')
function valueOf(botId: string, secret: Stored): string {
  const known = opened.get(readAs(botId, secret))
  if (known !== undefined) return known
  const value = vault.open(secret, about(botId, secret.name))
  opened.set(readAs(botId, secret), value)
  return value
}

// ---- names and sites

/** Names are typed by a model between {{secret: and }}, and by the owner: short, and nothing to trip over. */
const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/
const MOST = 100
const LONGEST = 10_000

/** A name as the owner typed it: "Plausible key" is "plausible-key". */
export function nameOf(given: unknown): string {
  const name = String(given ?? '').trim().toLowerCase().replace(/[\s.]+/g, '-')
  if (!NAME.test(name)) throw new Error('A secret’s name is up to 40 lower-case letters, digits, "-" and "_", such as "plausible".')
  return name
}

/**
 * The site in what was given, which may be a whole address: its host, with the port when that is
 * not the usual one. A secret goes to exactly the hosts it names, and to none of their subdomains.
 */
export function siteOf(given: unknown): string {
  const text = String(given ?? '').trim().toLowerCase()
  if (!text) throw new Error('Say which site the secret is for, such as "plausible.io".')
  if (text.includes('*')) throw new Error('A secret is for the sites it names, one by one: "*" does not stand for the rest. Name each, such as "plausible.io, app.plausible.io".')
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`)
  } catch {
    throw new Error(`"${text.slice(0, 80)}" is not a site. Give its host, such as "plausible.io".`)
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) throw new Error(`"${text.slice(0, 80)}" is not a site. Give its host, such as "plausible.io".`)
  return url.host
}

/** The sites in a list, or in text that names them one after another. */
export function sitesOf(given: unknown): string[] {
  const all = (Array.isArray(given) ? given : String(given ?? '').split(/[\s,;]+/)).map((site) => String(site).trim()).filter(Boolean)
  const sites = [...new Set(all.map(siteOf))]
  if (!sites.length) throw new Error('Say which site the secret is for, such as "plausible.io".')
  if (sites.length > 10) throw new Error('A secret can be for ten sites at most.')
  return sites
}

function valueGiven(given: unknown): string {
  if (typeof given !== 'string' || !given) throw new Error('No value was given.')
  if (given.length > LONGEST) throw new Error(`A secret can be ${LONGEST.toLocaleString('en')} characters at most.`)
  return given
}

const whatOf = (given: unknown) => String(given ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
/** A text with a secret's value taken out of it, a short one too (down to a PIN): the secret's name stands there instead. */
const plainly = (text: string, value: string, name: string) => (value.length < 4 ? text : taker([{ name, value }])(text))
/**
 * What a secret is said to be, as it is kept: tidied up, and without the value. The value is
 * taken out as it was written and again once it is tidied, since either may be how it stands
 * there (several spaces in a row in the one, a line break where the other has a space).
 */
const said = (given: unknown, value: string, name: string) => plainly(whatOf(plainly(String(given ?? ''), value, name)), value, name)

// ---- what the owner sees and does

function shown(botId: string, secret: Stored): Secret {
  const { name, what, sites, by, createdAt, changedAt, usedAt } = secret
  let problem: string | undefined
  try {
    valueOf(botId, secret)
  } catch (e: any) {
    problem = String(e?.message ?? e)
  }
  return { name, what, sites, by, createdAt, changedAt, usedAt, ...(problem ? { problem } : {}) }
}

export const list = (botId: string): Secrets => ({ secrets: load(botId).map((secret) => shown(botId, secret)), kept: vault.keptIn() })

/**
 * Keeps a value under a name. One that is there already is only replaced when `replace` says so:
 * the owner replaces, a bot does not, since what was there may be kept nowhere else.
 */
export function save(botId: string, given: { name: string; sites: string[]; value: unknown; what?: unknown; by: 'owner' | 'bot' }, { replace = false } = {}): Secret {
  if (!NAME.test(given.name)) throw new Error('A secret’s name is up to 40 lower-case letters, digits, "-" and "_", such as "plausible".')
  const value = valueGiven(given.value)
  if (value.length >= SHORTEST && given.name.includes(value)) throw new Error('A secret’s name is what it is called, not the secret itself.')
  const all = load(botId)
  const before = all.find((s) => s.name === given.name)
  if (before && !replace) throw new Error(`There is already a secret named "${given.name}".`)
  if (!before && all.length >= MOST) throw new Error(`A bot keeps ${MOST} secrets at most.`)
  const now = Date.now()
  const secret: Stored = {
    name: given.name,
    // What it is said to be is kept as it is, and told to the bot: the value itself has no place in it.
    what: said(given.what, value, given.name) || before?.what || '',
    sites: given.sites,
    by: given.by,
    createdAt: before?.createdAt ?? now,
    changedAt: now,
    usedAt: before?.usedAt ?? null,
    ...vault.seal(value, about(botId, given.name)),
  }
  if (before) opened.delete(readAs(botId, before))
  store(botId, before ? all.map((s) => (s === before ? secret : s)) : [...all, secret])
  return shown(botId, secret)
}

/** The owner changes what a secret is, where it may go, or its value. */
export function change(botId: string, name: string, patch: { sites?: unknown; what?: unknown; value?: unknown }): Secret {
  const all = load(botId)
  const before = all.find((s) => s.name === name)
  if (!before) throw new Error(`There is no secret named "${name}".`)
  const next: Stored = { ...before }
  if (patch.sites !== undefined) next.sites = sitesOf(patch.sites)
  // As it was written, for now: the value is taken out of it below, before it is tidied up.
  if (patch.what !== undefined) next.what = String(patch.what ?? '')
  if (patch.value !== undefined && patch.value !== '') {
    if (String(patch.value).length >= SHORTEST && name.includes(valueGiven(patch.value))) throw new Error('A secret’s name is what it is called, not the secret itself.')
    Object.assign(next, vault.seal(valueGiven(patch.value), about(botId, name)), { changedAt: Date.now(), by: 'owner' })
    opened.delete(readAs(botId, before))
  }
  // What it is said to be is kept as it is, and told to the bot: the value itself has no place in it.
  try {
    next.what = said(next.what, valueOf(botId, next), name)
  } catch {
    // One that cannot be read: there is no telling what its value was.
    next.what = whatOf(next.what)
  }
  store(botId, all.map((s) => (s === before ? next : s)))
  return shown(botId, next)
}

export function remove(botId: string, name: string) {
  const all = load(botId)
  const gone = all.find((s) => s.name === name)
  if (!gone) return
  opened.delete(readAs(botId, gone))
  store(botId, all.filter((s) => s !== gone))
}

/** The value itself, for its owner to read. */
export function reveal(botId: string, name: string): string {
  const secret = load(botId).find((s) => s.name === name)
  if (!secret) throw new Error(`There is no secret named "${name}".`)
  return valueOf(botId, secret)
}

/** A password nobody has to remember: 24 characters unless told otherwise, some of every kind, none that are easily mistaken for another. */
export function generate(length: unknown = 24): string {
  const size = Math.min(64, Math.max(12, Math.round(Number(length)) || 24))
  const kinds = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '-_!@#%+=']
  const pick = (from: string) => from[crypto.randomInt(from.length)]
  const chars = [...kinds.map(pick), ...Array.from({ length: size - kinds.length }, () => pick(kinds.join('')))]
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

// ---- what a bot is told, and how its secrets are used

/** What the bot is told of its secrets: one line each, with what it is and where it goes. Never a value. */
export function index(botId: string): string[] {
  let all: Stored[]
  try {
    all = load(botId)
  } catch {
    return []
  }
  return all.map((s) => `- ${s.name}${s.what ? `: ${s.what}` : ''} (for ${s.sites.join(', ')})`)
}

/**
 * Whether plain http may carry a secret to this host: only to an address written out as numbers,
 * of this computer or of the local network, where OpenKumi's own apps use plain http too (not
 * Tailscale, nor anywhere else). A name is not taken for where it leads, "localhost" neither:
 * looking a name up says where it led a moment ago, on this computer's word, and not where the
 * request will go.
 */
const plainAllowed = (hostname: string) => {
  const host = hostname.replace(/^\[|\]$/g, '')
  return net.isIP(host) !== 0 && served(host)
}

/**
 * The values this server has handed out for each bot since it started, with the name each went
 * under. What comes back to a bot is searched for these as well as for what is in its vault now: a
 * value that its owner replaced or removed meanwhile may still be on its way back, or in a field
 * of a page that is open.
 */
const handedOut = new Map<string, Map<string, string>>()

/**
 * The value of one of a bot's secrets, to be sent to `url`: given only when the secret is for that
 * site, and the way there is not open to others. Nothing is waited for between reading the vault
 * and giving the value, so what the owner changes takes effect at once.
 */
export async function use(botId: string, name: string, url: URL): Promise<string> {
  const all = load(botId)
  const secret = all.find((s) => s.name === name)
  if (!secret) throw new Error(all.length ? `You have no secret named "${name}". Yours: ${all.map((s) => s.name).join(', ')}.` : `You have no secret named "${name}", or any other yet.`)
  if (!secret.sites.includes(url.host)) {
    throw new Error(`The secret "${name}" is for ${secret.sites.join(', ')}, not for ${url.host}, so it was not sent. Only the user can change where a secret may go, in your settings under Secrets.`)
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && plainAllowed(url.hostname))) {
    throw new Error(
      `The secret "${name}" was not sent: ${url.protocol}//${url.host} is not an https address, and anyone on the way could read it. Without https a secret only goes to an address written as numbers, of this computer (127.0.0.1) or of the local network (such as 192.168.1.20).`,
    )
  }
  const value = valueOf(botId, secret)
  handedOut.set(botId, (handedOut.get(botId) ?? new Map()).set(value, name))
  // When it was last used is for the owner to see, not worth a write on every call.
  const now = Date.now()
  if (now - (secret.usedAt ?? 0) > 60_000) {
    secret.usedAt = now
    store(botId, all, false)
  }
  return value
}

/** How a bot writes a secret into a request: {{secret:name}}. */
const PLACE = /\{\{\s*secret:\s*([^\s{}]+)\s*\}\}/g
/** The text with something else where its secrets go, to read an address before any value is in it. */
export const withoutPlaces = (text: string, instead = 'secret') => text.replace(PLACE, instead)

/**
 * Puts the values in where `text` names secrets, for a request to `url`. `as` says how a value is
 * written there (in an address it is escaped). Gives the names that were used, too.
 */
export async function fill(botId: string, text: string, url: URL, as: (value: string) => string = (value) => value): Promise<{ text: string; used: string[] }> {
  const used: string[] = []
  const values = new Map<string, string>()
  for (const [, name] of text.matchAll(PLACE)) {
    if (!values.has(name)) values.set(name, await use(botId, name, url))
    if (!used.includes(name)) used.push(name)
  }
  return { text: used.length ? text.replace(PLACE, (_, name: string) => as(values.get(name)!)) : text, used }
}

/** A value shorter than this is not looked for in what comes back: it would be found in words that have nothing to do with it. */
const SHORTEST = 6
/**
 * A longer value is known by this many of its first characters. What shows it may cut it short (a
 * page's outline gives the first 80 characters of a field), and the part that is left is as much
 * the secret as the whole.
 */
const HEAD = 16
/** How JSON writes a text, without the quotes around it. */
const inJson = (value: string) => JSON.stringify(value).slice(1, -1)
/**
 * The ways a value may be written where it comes back: as it is, in an address, inside JSON, and
 * inside JSON that is itself kept as text (a service that says back the body it was sent). They
 * only differ for a value with something to escape in it.
 */
const forms = (value: string) => [...new Set([value, encodeURIComponent(value), inJson(value), inJson(inJson(value))])]

/**
 * What takes values out of a text, in every way each may be written there, leaving the name of
 * its secret: whole, or cut short after at least its first HEAD characters. It goes through the
 * text once for all of them, and where one stands takes as much as the value and the way that fit
 * best account for. One value after another would not do, nor one way after another: two keys of
 * a kind begin alike (every such token of a service has the same first part), and a value written
 * plainly begins like the same value written for an address, up to its first "@". Taking what
 * they share under the first one's name would leave the rest of the other standing.
 */
function taker(values: { name: string; value: string; ways?: string[] }[]): (text: string) => string {
  const found = values.flatMap(({ name, value, ways = forms(value) }) => ways.map((form) => ({ form, head: form.slice(0, HEAD), mark: `[secret: ${name}]` })))
  if (!found.length) return (text) => text
  return (text) => {
    // Every stretch of the text that is a value, or the beginning of one.
    const spans: { from: number; to: number; mark: string }[] = []
    for (const { form, head, mark } of found) {
      for (let at = text.indexOf(head); at >= 0; at = text.indexOf(head, at + 1)) {
        let same = head.length
        while (same < form.length && text[at + same] === form[same]) same++
        // A short value is only itself; a long one is known by how it begins.
        if (same >= Math.min(form.length, HEAD)) spans.push({ from: at, to: at + same, mark })
      }
    }
    if (!spans.length) return text
    // Where they run into one another (one key begins inside what looked like the beginning of another), all of it
    // goes as one, under the name of the one that accounts for most.
    spans.sort((a, b) => a.from - b.from || b.to - a.to)
    let out = ''
    let from = 0
    for (let i = 0; i < spans.length; ) {
      let { to, mark } = spans[i]
      let most = to - spans[i].from
      let next = i + 1
      for (; next < spans.length && spans[next].from < to; next++) {
        if (spans[next].to - spans[next].from > most) (most = spans[next].to - spans[next].from), (mark = spans[next].mark)
        to = Math.max(to, spans[next].to)
      }
      out += text.slice(from, spans[i].from) + mark
      from = to
      i = next
    }
    return out + text.slice(from)
  }
}

/** The secrets of a bot that can be read, with their values, and the values it was handed since the server started. */
function readable(botId: string): { name: string; value: string }[] {
  let all: Stored[]
  try {
    all = load(botId)
  } catch {
    all = []
  }
  const found = new Map<string, string>(handedOut.get(botId))
  for (const secret of all) {
    try {
      found.set(valueOf(botId, secret), secret.name)
    } catch {
      // One that cannot be read cannot have been sent anywhere either.
    }
  }
  return [...found].filter(([value]) => value.length >= SHORTEST).map(([value, name]) => ({ name, value }))
}

/**
 * Takes the values of a bot's secrets out of text that is on its way to the bot or into the
 * conversation: a page that shows the key it was sent, a field that still holds a password. In
 * their place is the secret's name. It finds a value as it is, whole or cut short; one a site
 * hands back in another shape is not found.
 */
export function scrub(botId: string, text: string): string {
  return text ? taker(readable(botId))(text) : text
}

/** Whether a bot has any secret at all. */
export function any(botId: string): boolean {
  try {
    return load(botId).length > 0
  } catch {
    // Something is kept there, though it cannot be read as what it is.
    return true
  }
}

/** Whether one of a bot's secrets is for this site. */
export function anyFor(botId: string, host: string): boolean {
  try {
    return load(botId).some((secret) => secret.sites.includes(host))
  } catch {
    return false
  }
}

/**
 * What takes one value out of what is kept of a conversation, where it was written out before it
 * was put in the vault: in a message, in what a tool gave back, in JSON within that. `heads` are
 * texts that stand wherever the value does, to find what has it by.
 */
export function eraser(value: string, name: string): { heads: string[]; take: (text: string) => string } {
  if (value.length < SHORTEST) return { heads: [], take: (text) => text }
  const ways = forms(value)
  // What is kept is JSON, in which each of them is written once more as JSON writes text: that is what it is found by.
  return { heads: [...new Set(ways.flatMap((form) => [form, inJson(form)]).map((form) => form.slice(0, HEAD)))], take: taker([{ name, value, ways }]) }
}

// ---- asking the owner for one

export type AskOutcome = 'saved' | 'declined' | 'timeout' | 'hurried' | 'stopped'

interface Ask {
  botId: string
  name: string
  site: string
  what: string
  /** The bot asked for one it has to be replaced, and the card said so. */
  replace: boolean
  settle: (outcome: AskOutcome) => void
}

/** Whether a bot has a secret of this name: one that can be read, or with `any` one that cannot be either, which is there to be entered again. */
export function has(botId: string, name: string, any = false): boolean {
  const secret = load(botId).find((s) => s.name === name)
  if (!secret) return false
  if (any) return true
  try {
    valueOf(botId, secret)
    return true
  } catch {
    return false
  }
}

/** The bots waiting for their owner to type a secret, each by the call that asked: the card in the conversation answers to that call. */
const asks = new Map<string, Ask>()

/**
 * Waits for the owner to type a secret into the card the call shows in the conversation, until
 * they do, say no, `timeoutMs` passes, the bot is stopped, or they want it to read a message now.
 */
export function ask(callId: string, wanted: Omit<Ask, 'settle'>, signal: AbortSignal, hurry: AbortSignal, timeoutMs: number): Promise<AskOutcome> {
  signal.throwIfAborted()
  return new Promise<AskOutcome>((done) => {
    const settle = (outcome: AskOutcome) => {
      if (asks.get(callId)?.settle !== settle) return
      asks.delete(callId)
      clearTimeout(timer)
      signal.removeEventListener('abort', stopped)
      hurry.removeEventListener('abort', hurried)
      done(outcome)
    }
    const timer = setTimeout(() => settle('timeout'), timeoutMs)
    const stopped = () => settle('stopped')
    const hurried = () => settle('hurried')
    signal.addEventListener('abort', stopped, { once: true })
    hurry.addEventListener('abort', hurried, { once: true })
    asks.set(callId, { ...wanted, settle })
    if (hurry.aborted) hurried()
  })
}

/** The owner's answer to a card: the value, which is kept under the name and for the site the card showed, or no. */
export function answer(callId: string, given: { value?: unknown; declined?: unknown }) {
  const asked = asks.get(callId)
  if (!asked) throw new Error('The bot is no longer waiting for this. Add it under the bot’s Secrets, or have the bot ask again.')
  if (given.declined === true) return asked.settle('declined')
  // What the owner types takes the place of one that is there only when the card said it would, or when that one
  // cannot be read any more. One that was added under the name while the card waited is not written over.
  save(asked.botId, { name: asked.name, sites: [asked.site], value: given.value, what: asked.what, by: 'owner' }, { replace: asked.replace || !has(asked.botId, asked.name) })
  asked.settle('saved')
}
