// The server this phone is paired with, and the connection to it. The key the server gave this
// phone is kept in the phone's keychain, with the addresses the server can be reached at: on the
// home network, on Tailscale, or ones put in by hand. The connection and the state kept from it
// are the same code the desktop app uses (packages/client); here the connection runs where the app does.
import { useSyncExternalStore } from 'react'
import { AppState } from 'react-native'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { type SavedAddress, checkNew, ordered, refusal, useRandom, withFound } from '@openbot/client/addresses'
import { type Picture, createConnection } from '@openbot/client/connection'
import { pair, parseAddress } from '@openbot/client/pair'
import { follow, onLearn, receive, recheck, send, useStore, useTransport } from '@openbot/client/store'

export interface Server {
  name: string
  /** Where it can be reached, tried in the order `ordered` gives. */
  addresses: SavedAddress[]
  key: string
  /** The server's own id, once known: another server answering at one of the addresses is not it. */
  serverId?: string
}

useRandom(() => Crypto.getRandomBytes(16))

/** The server's first address, as the phone shows it when it has no name of its own. */
export const hostOf = (server: Server) => new URL(ordered(server.addresses)[0]).host

const SAVED = 'openbot.server'
let server: Server | null = null
/** False until the keychain has been read, so the first screen is not drawn on a guess. */
let ready = false
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((fn) => fn())
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn))
let snapshot: { server: Server | null; ready: boolean } = { server, ready }
const set = (next: Server | null) => {
  server = next
  ready = true
  snapshot = { server, ready }
  // The store shows this server from now on, or nothing.
  follow(next && { id: 'paired', name: next.name, addresses: ordered(next.addresses), token: next.key, local: false, serverId: next.serverId })
  changed()
}

/** Keeps a change to the server in the keychain, and shows it. */
async function keep(next: Server) {
  await SecureStore.setItemAsync(SAVED, JSON.stringify(next))
  set(next)
}

// What the connection learns about the server is kept with it: its id, and where else it can be
// reached, for when the address in use stops answering (away from home, say).
onLearn((_, learned) => {
  if (!server) return
  const next = { ...server, serverId: server.serverId ?? learned.serverId, addresses: learned.addresses ? withFound(server.addresses, learned.addresses) : server.addresses }
  if (JSON.stringify(next) !== JSON.stringify(server)) void keep(next)
})

// Back in the app, the addresses are asked again: the phone may have left home, or come back.
AppState.addEventListener('change', (now) => now === 'active' && recheck())

export const useSession = () => useSyncExternalStore(subscribe, () => snapshot)

/** How the connection to the server stands, in a few words and in one, and whether that is good. */
export function useServerStatus(): { text: string; word: string; ok: boolean } {
  const connected = useStore((s) => s.connected)
  const loaded = useStore((s) => s.loaded)
  const refused = useStore((s) => s.refused)
  const outdated = useStore((s) => s.outdated)
  const failures = useStore((s) => s.failures)
  const version = useStore((s) => s.about.version)
  if (refused) return { text: 'No longer lets this phone in', word: 'Refused', ok: false }
  if (outdated) return { text: 'Runs an older Open Bot', word: 'Needs update', ok: false }
  if (connected) return { text: version ? `Connected · Open Bot ${version}` : 'Connected', word: 'Connected', ok: true }
  if (failures >= 2) return { text: 'Cannot be reached. Still trying…', word: 'Unreachable', ok: false }
  const word = loaded ? 'Reconnecting…' : 'Connecting…'
  return { text: word, word, ok: false }
}

// ---- pictures of a bot's browser: handed to every screen watching that tab (the chat's floating
// view and the browser screen can watch the same one). The server is asked for them while anyone watches.

const watchers = new Map<string, { fns: Set<(picture: Picture) => void>; last: Picture | null }>()
export function watch(botId: string, tabId: string, fn: (picture: Picture) => void) {
  const key = `${botId}:${tabId}`
  let watching = watchers.get(key)
  if (!watching) {
    watchers.set(key, (watching = { fns: new Set(), last: null }))
    send({ type: 'browser.subscribe', botId, tabId })
  }
  const mine = watching
  mine.fns.add(fn)
  // One who joins starts from the picture there is: a page that is not changing sends no new one.
  if (mine.last) fn(mine.last)
  return () => {
    mine.fns.delete(fn)
    if (mine.fns.size || watchers.get(key) !== mine) return
    watchers.delete(key)
    send({ type: 'browser.unsubscribe', botId, tabId })
  }
}

useTransport(
  createConnection(receive, (picture) => {
    const watching = watchers.get(picture.key)
    if (!watching) return
    watching.last = picture
    watching.fns.forEach((fn) => fn(picture))
  }),
)

/** Reads the paired server from the keychain, once, when the app starts. */
export async function restore() {
  if (ready) return
  let saved: (Server & { url?: string }) | null = null
  try {
    saved = JSON.parse((await SecureStore.getItemAsync(SAVED)) ?? 'null')
  } catch {
    // Nothing saved, or it cannot be read: the app asks to be paired.
  }
  // An earlier version kept a single address.
  const { url, ...rest } = saved ?? ({} as Partial<Server & { url: string }>)
  const addresses = rest.addresses ?? (url ? [{ url }] : [])
  set(addresses.length && rest.key && rest.name ? { ...rest, name: rest.name, key: rest.key, addresses } : null)
}

/** Pairs this phone with a server, using the code its owner's computer shows, and remembers it. */
export async function pairWith(address: string, code: string, phone: string) {
  const url = parseAddress(address)
  const refused = refusal(url)
  if (refused) throw new Error(refused)
  const { key, serverId } = await pair(url, code, phone, () => Crypto.getRandomBytes(16))
  // Pairing again with the same server keeps its name and the addresses it had.
  const again = server && serverId && server.serverId === serverId ? server : null
  await keep({ name: again?.name ?? new URL(url).host, addresses: [...(again?.addresses.filter((a) => a.url !== url) ?? []), { url }], key, serverId })
}

/** What the phone calls the server. Empty goes back to its address. */
export async function rename(name: string) {
  if (!server) return
  await keep({ ...server, name: name.trim() || hostOf(server) })
}

/**
 * Adds an address the server can be reached at, once whatever answers there has shown it is the
 * server (or nothing answers yet: it is sent the key only once it has). Says whether it answered.
 */
export async function addAddress(address: string): Promise<{ checked: boolean }> {
  if (!server) throw new Error('This phone is not paired.')
  const url = parseAddress(address)
  if (server.addresses.some((a) => a.url === url)) return { checked: true }
  const { checked, serverId } = await checkNew(url, server.key, server)
  await keep({ ...server, serverId: server.serverId ?? serverId, addresses: [...server.addresses, { url }] })
  return { checked }
}

/** Forgets an address put in by hand. The server's own stay while it reports them. */
export async function removeAddress(url: string) {
  if (!server || server.addresses.length === 1) return
  await keep({ ...server, addresses: server.addresses.filter((a) => a.url !== url || a.found) })
}

/** Forgets the server. (The server still lists this phone until it is removed there.) */
export async function forget() {
  await SecureStore.deleteItemAsync(SAVED)
  set(null)
}
