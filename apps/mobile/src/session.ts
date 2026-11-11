// The server this phone is paired with, and the connection to it. The key the server gave this
// phone is kept in the phone's keychain. The connection and the state kept from it are the same
// code the desktop app uses (packages/client); here the connection runs where the app does.
import { useSyncExternalStore } from 'react'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { type Picture, createConnection } from '@openbot/client/connection'
import { pair, parseAddress } from '@openbot/client/pair'
import { follow, receive, useTransport } from '@openbot/client/store'

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

// ---- pictures of a bot's browser: handed to whichever screen is watching that view

const watchers = new Map<string, (picture: Picture) => void>()
export function watch(key: string, fn: (picture: Picture) => void) {
  watchers.set(key, fn)
  return () => void (watchers.get(key) === fn && watchers.delete(key))
}

useTransport(createConnection(receive, (picture) => watchers.get(picture.key)?.(picture)))

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

/** Forgets the server. (The server still lists this phone until it is removed there.) */
export async function forget() {
  await SecureStore.deleteItemAsync(SAVED)
  set(null)
}
