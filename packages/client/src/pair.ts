// Pairing this device with an OpenKumi server, using the code shown on the computer that runs it.
// The code itself is never sent. First the server has to show that it has the code, so this cannot
// be talked into pairing with something else at that address; then this device shows the same, and
// is given a key of its own. The server's side is in apps/server/src/clients.ts.
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const sign = (code: string, who: 'server' | 'computer', ours: string, theirs: string) => hex(hmac(sha256, new TextEncoder().encode(code), new TextEncoder().encode(`${who}:${ours}:${theirs}`)))
/** Compares without stopping at the first difference, so how long it takes says nothing. */
const same = (a: string, b: string) => a.length === b.length && [...a].reduce((diff, char, i) => diff | (char.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0

const unreachable = (url: string) => `Could not reach OpenKumi at ${url}. Check that the other computer is on, that “Let other computers connect” is switched on in its Settings, under Environments, and that both are on the same network.`

/** The server's address as typed: with or without http://, with or without the port. */
export function parseAddress(address: unknown): string {
  const text = String(address ?? '').trim()
  if (!text) throw new Error('Enter the address of the other computer.')
  const found = text.match(/^(https?):\/\/([^/?#]+)/i) ?? text.match(/^()([^/?#\s]+)$/)
  const host = found?.[2] ?? ''
  if (!/^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-fA-F:]+\](:\d{1,5})?$/.test(host)) throw new Error('That does not look like an address. It should be like 192.168.1.20:4317')
  const scheme = (found![1] || 'http').toLowerCase()
  // OpenKumi's usual port, unless one was given or the address is a secure one.
  return `${scheme}://${host}${/:\d+$/.test(host) || scheme === 'https' ? '' : ':4317'}`
}

/** What a pairing link or QR code carries: the address and the code. Null when the text is not one. */
export function parsePairingLink(text: string): { address: string; code: string } | null {
  const found = text.trim().match(/^openkumi:\/\/pair\?(.*)$/i)
  if (!found) return null
  const given = Object.fromEntries(found[1].split('&').map((pair) => pair.split('=').map(decodeURIComponent) as [string, string]))
  return given.address && given.code ? { address: given.address, code: given.code } : null
}
export const pairingLink = (address: string, code: string) => `openkumi://pair?address=${encodeURIComponent(address)}&code=${encodeURIComponent(code)}`

/**
 * Pairs with the server at `url` and returns the key it gives this device, with the server's own id
 * (missing from older servers). `name` is what the server lists the device as; `random` makes 16
 * unpredictable bytes (the platform's own way of doing so).
 */
export async function pair(url: string, typed: unknown, name: string, random: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(16))): Promise<{ key: string; serverId?: string }> {
  const code = String(typed ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length !== 12) throw new Error('Enter the pairing code shown on the other computer. It looks like ABCD-EFGH-JKMN.')
  const post = async (path: string, body: unknown) => {
    const stop = new AbortController()
    const late = setTimeout(() => stop.abort(), 8000)
    const res = await fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: stop.signal }).catch(() => null)
    clearTimeout(late)
    if (!res) throw new Error(unreachable(url))
    const said = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(said.error ?? `${url} answered, but it is not OpenKumi.`)
    return said
  }
  const nonce = hex(random())
  const begun = await post('/api/pair/begin', { nonce })
  if (!same(String(begun.proof ?? ''), sign(code, 'server', nonce, String(begun.nonce)))) throw new Error('The pairing code is not the one that computer is showing. Check it, or make a new one there.')
  const done = await post('/api/pair/finish', { nonce, serverNonce: begun.nonce, proof: sign(code, 'computer', nonce, String(begun.nonce)), name })
  if (typeof done.key !== 'string' || !done.key) throw new Error('Pairing did not finish. Make a new code on the other computer and try again.')
  return { key: done.key, serverId: typeof done.server === 'string' ? done.server : undefined }
}
