// What the window may ask of the app behind it (the contract is in packages/shared/src/desktop.ts).
// This runs inside the window before its page does, and is the only way from one to the other.
import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, DesktopState } from '@openkumi/shared/desktop'
import type { DictationEvent } from '@openkumi/shared/dictation'

// Asked for before the page starts, so the first thing it draws is already right. The app only
// answers its own pages; anything else that ends up in a window gets nothing.
const initial: DesktopState | null = ipcRenderer.sendSync('desktop:initial')

// Listened to from now, not from when the page asks: a change that happens while the page is
// still loading (the local environment finishing its start, say) is kept and handed over then.
let latest = initial
const listeners = new Set<(state: DesktopState) => void>()
ipcRenderer.on('desktop:state', (_event, state: DesktopState) => {
  latest = state
  listeners.forEach((listener) => listener(state))
})

// The way back from a sign-in in this computer's browser, kept until the page is there to take it.
let returned: string | null = null
const returns = new Set<(url: string) => void>()
ipcRenderer.on('desktop:sign-in', (_event, url: string) => {
  if (returns.size) returns.forEach((listener) => listener(url))
  else returned = url
})

const heard = new Set<(event: DictationEvent) => void>()
ipcRenderer.on('desktop:dictation', (_event, event: DictationEvent) => heard.forEach((listener) => listener(event)))

const bridge: DesktopBridge | null = initial && {
  initial,
  onState(listener) {
    listeners.add(listener)
    if (latest && latest !== initial) queueMicrotask(() => listeners.has(listener) && listener(latest!))
    return () => void listeners.delete(listener)
  },
  statuses: () => ipcRenderer.invoke('desktop:statuses'),
  open: (id) => ipcRenderer.invoke('desktop:open', id),
  setLocal: (on) => ipcRenderer.invoke('desktop:set-local', on),
  retry: () => ipcRenderer.invoke('desktop:retry'),
  add: (input) => ipcRenderer.invoke('desktop:add', input),
  update: (id, patch) => ipcRenderer.invoke('desktop:update', id, patch),
  remove: (id) => ipcRenderer.invoke('desktop:remove', id),
  addAddress: (id, address) => ipcRenderer.invoke('desktop:add-address', id, address),
  removeAddress: (id, url) => ipcRenderer.invoke('desktop:remove-address', id, url),
  learn: (id, learned) => ipcRenderer.invoke('desktop:learn', id, learned),
  showPage: (html) => ipcRenderer.invoke('desktop:page', html),
  dictation: {
    available: () => ipcRenderer.invoke('desktop:can-dictate'),
    start: (locale) => ipcRenderer.invoke('desktop:dictate', locale),
    stop: () => ipcRenderer.invoke('desktop:dictate-stop'),
    cancel: () => ipcRenderer.invoke('desktop:dictate-cancel'),
    onEvent(listener) {
      heard.add(listener)
      return () => void heard.delete(listener)
    },
    openMicrophoneSettings: () => ipcRenderer.invoke('desktop:microphone-settings'),
  },
  onSignIn(listener) {
    returns.add(listener)
    if (returned) {
      const url = returned
      returned = null
      queueMicrotask(() => listener(url))
    }
    return () => void returns.delete(listener)
  },
}

if (bridge) contextBridge.exposeInMainWorld('openkumiDesktop', bridge)
