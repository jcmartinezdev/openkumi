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

// ---- routing: #/<botId> for a bot's conversation, #/<botId>/<threadId>[/<itemId>] for a subagent's
// thread or an earlier conversation (and a message in it), #/tasks[/<taskId> or /new] for the
// scheduled tasks, #/settings/<page>/… for the settings

export interface Route {
  botId: string
  threadId: string
  /** A message to bring into view, when one was asked for. */
  itemId: number
  /** The path inside the settings (page, then whatever that page takes), or null when a chat is showing. */
  settings: string[] | null
  /** The scheduled tasks are showing: [] for all of them, or [task id] or ['new']. Null otherwise. */
  tasks: string[] | null
}

function parseHash(): Route {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p))
  if (parts[0] === 'settings') return { botId: '', threadId: '', itemId: 0, settings: parts.slice(1).filter(Boolean), tasks: null }
  if (parts[0] === 'tasks') return { botId: '', threadId: '', itemId: 0, settings: null, tasks: parts.slice(1, 2).filter(Boolean) }
  return { botId: parts[0] ?? '', threadId: parts[1] ?? '', itemId: Number(parts[2]) || 0, settings: null, tasks: null }
}

/** The scheduled tasks, or one of them ('new' for a task being made). */
export function openTasks(taskId = '') {
  location.hash = `/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ''}`
}

export function navigate(botId: string, threadId = '', itemId = 0) {
  location.hash = `/${botId}${threadId ? `/${threadId}${itemId ? `/${itemId}` : ''}` : ''}`
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
