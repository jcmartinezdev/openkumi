// Where a paired server can be reached, and making sure an address is that server before its key
// is sent there. A server can have several addresses: on the home network, on Tailscale, or one its
// owner put in front of it. They are tried in that order, and the first that shows it is the server
// is used. Whatever answers at an address is asked who it is without being sent the key: it has to
// sign a value made up here with the key's hash, which only that server and this device know (the
// server's side is in apps/server/src/clients.ts). Something else, or another Open Bot server,
// answering at a saved address is told nothing it could use.
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'

/** An address of a paired server, as a device keeps it. */
export interface SavedAddress {
  url: string
  /** Reported by the server itself, which keeps it up to date. The others were put in by hand. */
  found?: boolean
}

export type Kind = 'this computer' | 'home' | 'tailscale' | 'internet'
export const KIND_NAMES: Record<Kind, string> = { 'this computer': 'This computer', home: 'Home network', tailscale: 'Tailscale', internet: 'Internet' }

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch {
    return ''
  }
}

/** What kind of network an address is on. */
export function kindOf(url: string): Kind {
  const host = hostOf(url)
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number)
  if (v4) {
    const [a, b] = v4
    if (a === 127) return 'this computer'
    if (a === 100 && b >= 64 && b < 128) return 'tailscale'
    if (a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 169 && b === 254)) return 'home'
    return 'internet'
  }
  if (host === 'localhost' || host === '::1') return 'this computer'
  if (host.endsWith('.ts.net') || host.startsWith('fd7a:115c:a1e0:')) return 'tailscale'
  if (host.includes(':')) return /^f[cd]|^fe[89ab]/.test(host) ? 'home' : 'internet'
  // A computer's own name on the network ("mac-mini", "mac-mini.local").
  if (host && (!host.includes('.') || /\.(local|lan|home|internal|home\.arpa)$/.test(host))) return 'home'
  return 'internet'
}

/**
 * Why a key may never go to this address, or null. Plain http is only for this computer, the home
 * network and Tailscale (which encrypts on its own): anywhere else, whoever is in between could read it.
 */
export function refusal(url: string): string | null {
  if (!/^https?:\/\//i.test(url) || !hostOf(url)) return `${url} is not an address.`
  return /^http:/i.test(url) && kindOf(url) === 'internet' ? `${new URL(url).host} is on the internet, where plain http would let others read this device’s key. Use an https address, or reach it over Tailscale.` : null
}

const RANK: Record<Kind, number> = { 'this computer': 0, home: 1, tailscale: 2, internet: 3 }

/** The addresses in the order they are tried: the home network first, then Tailscale, then the rest; within each, the server's own first. */
export function ordered(addresses: SavedAddress[]): string[] {
  return addresses
    .map((address, i) => ({ address, i }))
    .sort((x, y) => RANK[kindOf(x.address.url)] - RANK[kindOf(y.address.url)] || Number(!x.address.found) - Number(!y.address.found) || x.i - y.i)
    .map(({ address }) => address.url)
}

/**
 * The saved addresses with the ones the server reports now in place of the ones it reported before,
 * so an address it no longer has goes away. Those put in by hand are never touched. Only home
 * network and Tailscale addresses are taken from a server, and only a handful.
 */
export function withFound(saved: SavedAddress[], reported: unknown[]): SavedAddress[] {
  const typed = saved.filter((address) => !address.found)
  const found = reported
    .filter((url): url is string => typeof url === 'string' && !refusal(url) && ['home', 'tailscale'].includes(kindOf(url)))
    .map((url) => url.replace(/\/+$/, ''))
    .filter((url, i, all) => all.indexOf(url) === i && !typed.some((address) => address.url === url))
    .slice(0, 8)
  const next = [...typed, ...found.map((url) => ({ url, found: true }))]
  // A server that reports nothing (one reached through a tunnel to this computer, say) does not take away the way to it.
  return next.length ? next : saved
}

// ---- asking an address who it is

const text = (value: string) => new TextEncoder().encode(value)
const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const hashOf = (key: string) => hex(sha256(text(key)))
/** What this device is called when it asks who is at an address: made from its key in one direction only. */
export const deviceTag = (key: string) => hex(sha256(text(`device:${hashOf(key)}`)))
const signed = (key: string, server: string, challenge: string) => hex(hmac(sha256, text(hashOf(key)), text(`server:${server}:${challenge}`)))
/** Compares without stopping at the first difference, so how long it takes says nothing. */
const same = (a: string, b: string) => a.length === b.length && [...a].reduce((diff, char, i) => diff | (char.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0

let random: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(16))
/** Sets how unpredictable values are made, where the platform has its own way (the phone). */
export function useRandom(fn: () => Uint8Array) {
  random = fn
}

/**
 * What answered at an address: the server (`ok`), the server, no longer letting this device in
 * (`refused`), something else (`other`), an Open Bot too old to show who it is (`outdated`),
 * nothing (`unreachable`), or nothing was asked because the key may not go there (`blocked`).
 */
export type Answer = 'ok' | 'refused' | 'other' | 'outdated' | 'unreachable' | 'blocked'
export interface Probe {
  url: string
  answer: Answer
  /** The id the server there gave, when it was asked. */
  serverId?: string
}

/** How long an address has to answer: a home address answers at once or not at all. */
const PATIENCE: Record<Kind, number> = { 'this computer': 1500, home: 2500, tailscale: 5000, internet: 6000 }

/**
 * Asks who is at `url`, without sending the key. `serverId` is the id of the server the key came
 * from, once it is known: another one answering there is a different server.
 */
export async function probe(url: string, key: string, serverId?: string): Promise<Probe> {
  if (refusal(url)) return { url, answer: 'blocked' }
  const challenge = hex(random())
  const stop = new AbortController()
  const late = setTimeout(() => stop.abort(), PATIENCE[kindOf(url)])
  try {
    const res = await fetch(`${url}/api/hello?challenge=${challenge}&device=${deviceTag(key)}`, { signal: stop.signal })
    const said = await res.json()
    if (said?.app !== 'open-bot') return { url, answer: 'unreachable' }
    if (typeof said.id !== 'string' || !said.device) return { url, answer: 'outdated' }
    if (serverId && said.id !== serverId) return { url, answer: 'other', serverId: said.id }
    if (!said.device.known) return { url, answer: 'refused', serverId: said.id }
    // Says it knows this device, but cannot sign with the key's hash: it is not the server.
    if (!same(String(said.device.proof ?? ''), signed(key, said.id, challenge))) return { url, answer: 'other' }
    return { url, answer: 'ok', serverId: said.id }
  } catch {
    return { url, answer: 'unreachable' }
  } finally {
    clearTimeout(late)
  }
}

/**
 * Asks every address at once, and gives the first, in their order, where the server answered, as
 * soon as the ones before it have answered too. `answers` has what was heard up to there.
 */
export async function reach(urls: string[], key: string, serverId?: string): Promise<{ found: Probe | null; answers: Probe[] }> {
  const asked = urls.map((url) => probe(url, key, serverId))
  const answers: Probe[] = []
  for (const answer of asked) {
    answers.push(await answer)
    if (answers.at(-1)!.answer === 'ok') return { found: answers.at(-1)!, answers }
  }
  return { found: null, answers }
}

/** How a server stands, from what its addresses said. */
export function verdict(answers: Probe[]): 'connected' | 'refused' | 'outdated' | 'unreachable' {
  const said = (answer: Answer) => answers.some((probe) => probe.answer === answer)
  return said('ok') ? 'connected' : said('refused') ? 'refused' : said('outdated') ? 'outdated' : 'unreachable'
}

/**
 * Checks an address someone wants to add to a server before it is kept. It is kept when the server
 * answers there, or when nothing does yet (it gets the key only once it shows it is the server).
 * Throws, saying why, when something else answers there. `checked` says whether the server answered.
 */
export async function checkNew(url: string, key: string, server: { name: string; serverId?: string }): Promise<{ checked: boolean; serverId?: string }> {
  const refused = refusal(url)
  if (refused) throw new Error(refused)
  const { answer, serverId } = await probe(url, key, server.serverId)
  const host = new URL(url).host
  if (answer === 'other') throw new Error(`Something else answers at ${host}, not ${server.name}. Its key was not sent there.`)
  if (answer === 'refused') throw new Error(server.serverId ? `${server.name} answers at ${host}, but no longer lets this device in. Pair them again.` : `The Open Bot at ${host} does not know this device, so it may be a different one. Its key was not sent there.`)
  if (answer === 'outdated') throw new Error(`The Open Bot at ${host} is older than this app. Update it there, then add the address.`)
  return { checked: answer === 'ok', serverId }
}
