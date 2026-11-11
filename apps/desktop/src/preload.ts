// What the window may ask of the app behind it (the contract is in packages/shared/src/desktop.ts).
// This runs inside the window before its page does, and is the only way from one to the other.
import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopBridge, DesktopState } from '@openbot/shared/desktop'

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
}

if (bridge) contextBridge.exposeInMainWorld('openbotDesktop', bridge)
