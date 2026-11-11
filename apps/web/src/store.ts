// The window's copy of the environment it shows. The state and the rules for keeping it current
// are shared with the phone app (packages/client); what is added here is what only a window has:
// the connection on its own thread, saving files, the canvas for a bot's browser, and the address bar.
import { useEffect, useState } from 'react'
import { receive, request, useTransport } from '@openbot/client/store'
import type { WorkerCommand, WorkerReport } from './connection.worker'

export * from '@openbot/client/store'

// ---- the connection, which lives on its own thread

const worker = new Worker(new URL('./connection.worker.ts', import.meta.url), { type: 'module' })
const tell = (command: WorkerCommand, transfer: Transferable[] = []) => worker.postMessage(command, transfer)
useTransport(tell)
worker.onmessage = ({ data }: MessageEvent<WorkerReport>) => (data.type === 'frame' ? void watching.get(data.key)?.(data) : receive(data))

/** Saves a file from the environment onto this computer, through the app's usual "save as". */
export async function download(path: string, name: string) {
  const url = URL.createObjectURL(await (await request('GET', path)).blob())
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}


interface PageSize {
  width: number
  height: number
}
const watching = new Map<string, (size: PageSize) => void>()

/**
 * Has the pictures of a bot's browser tab drawn onto this canvas, by the connection's thread and
 * without passing through this one. `onSize` is called when the first picture is showing and
 * whenever the page changes size. A canvas can be handed over only once, so each view needs a new one.
 */
export function watch(key: string, canvas: HTMLCanvasElement, onSize: (size: PageSize) => void) {
  let offscreen: OffscreenCanvas
  try {
    offscreen = canvas.transferControlToOffscreen()
  } catch {
    // Already handed over (the view was set up twice for one canvas): the first hand-over stands.
    return () => {}
  }
  watching.set(key, onSize)
  tell({ type: 'view', key, canvas: offscreen }, [offscreen])
  return () => {
    if (watching.get(key) === onSize) watching.delete(key)
    tell({ type: 'unview', key })
  }
}

// ---- routing: #/<botId>/<threadId> for a chat, #/settings/<page>/… for the settings

export interface Route {
  botId: string
  threadId: string
  /** The path inside the settings (page, then whatever that page takes), or null when a chat is showing. */
  settings: string[] | null
}

function parseHash(): Route {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p))
  if (parts[0] === 'settings') return { botId: '', threadId: '', settings: parts.slice(1).filter(Boolean) }
  return { botId: parts[0] ?? '', threadId: parts[1] ?? '', settings: null }
}

export function navigate(botId: string, threadId = '') {
  location.hash = `/${botId}${threadId ? `/${threadId}` : ''}`
}

/** Where the settings were opened from, to go back to when they are closed. */
let beforeSettings = ''

export function openSettings(...path: string[]) {
  if (!parseHash().settings) beforeSettings = location.hash
  location.hash = `/settings/${(path.length ? path : ['general']).map(encodeURIComponent).join('/')}`
}

export function closeSettings() {
  location.hash = beforeSettings || '/'
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const update = () => setRoute(parseHash())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return route
}
