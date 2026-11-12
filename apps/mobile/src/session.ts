// The server this phone is paired with, and the connection to it. The key the server gave this
// phone is kept in the phone's keychain. The connection and the state kept from it are the same
// code the desktop app uses (packages/client); here the connection runs where the app does.
import { useSyncExternalStore } from 'react'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { type Picture, createConnection } from '@openbot/client/connection'
import { pair, parseAddress } from '@openbot/client/pair'
import { follow, receive, send, useStore, useTransport } from '@openbot/client/store'

export interface Server {
  name: string
  url: string
  key: string
}

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
  follow(next && { id: 'paired', name: next.name, url: next.url, token: next.key, local: false })
  changed()
}

export const useSession = () => useSyncExternalStore(subscribe, () => snapshot)

/** How the connection to the server stands, in a few words and in one, and whether that is good. */
export function useServerStatus(): { text: string; word: string; ok: boolean } {
  const connected = useStore((s) => s.connected)
  const loaded = useStore((s) => s.loaded)
  const refused = useStore((s) => s.refused)
  const failures = useStore((s) => s.failures)
  const version = useStore((s) => s.about.version)
  if (refused) return { text: 'No longer lets this phone in', word: 'Refused', ok: false }
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
  let saved: Server | null = null
  try {
    saved = JSON.parse((await SecureStore.getItemAsync(SAVED)) ?? 'null')
  } catch {
    // Nothing saved, or it cannot be read: the app asks to be paired.
  }
  set(saved?.url && saved.key ? saved : null)
}

/** Pairs this phone with a server, using the code its owner's computer shows, and remembers it. */
export async function pairWith(address: string, code: string, phone: string) {
  const url = parseAddress(address)
  const key = await pair(url, code, phone, () => Crypto.getRandomBytes(16))
  const next = { name: new URL(url).host, url, key }
  await SecureStore.setItemAsync(SAVED, JSON.stringify(next))
  set(next)
}

/** What the phone calls the server. Empty goes back to its address. */
export async function rename(name: string) {
  if (!server) return
  const next = { ...server, name: name.trim() || new URL(server.url).host }
  await SecureStore.setItemAsync(SAVED, JSON.stringify(next))
  set(next)
}

/** Forgets the server. (The server still lists this phone until it is removed there.) */
export async function forget() {
  await SecureStore.deleteItemAsync(SAVED)
  set(null)
}
