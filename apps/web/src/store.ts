// The window's copy of the environment it shows. The state and the rules for keeping it current
// are shared with the phone app (packages/client); what is added here is what only a window has:
// the connection on its own thread, saving files, the canvas for a bot's browser, and the address bar.
import { useEffect, useState } from 'react'
import type { Bot } from '@openkumi/shared'
import { receive, request, useApp, useStore, useTransport } from '@openkumi/client/store'
import { desktopState } from './desktop'
import type { WorkerCommand, WorkerReport } from './connection.worker'

export * from '@openkumi/client/store'

// ---- the connection, which lives on its own thread

const worker = new Worker(new URL('./connection.worker.ts', import.meta.url), { type: 'module' })
const tell = (command: WorkerCommand, transfer: Transferable[] = []) => worker.postMessage(command, transfer)
useTransport(tell)
// Which app this is, for the server to count: the desktop app, its version and what it runs on.
const SYSTEMS = { darwin: 'macos', win32: 'windows', linux: 'linux' } as const
if (desktopState().version) useApp({ app: 'desktop', version: desktopState().version, os: SYSTEMS[desktopState().platform as keyof typeof SYSTEMS] ?? 'other' })
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
// thread or an earlier conversation (and a message in it), #/automations[/<id> or /new[/<botId>]]
// for the automations, #/-usage for what the models used, #/settings/<page>/… for the settings

export interface Route {
  botId: string
  threadId: string
  /** A message to bring into view, when one was asked for. */
  itemId: number
  /** The path inside the settings (page, then whatever that page takes), or null when a chat is showing. */
  settings: string[] | null
  /** The automations are showing: [] for all of them, or [an automation's id], or ['new'] and maybe the bot it is for. Null otherwise. */
  automations: string[] | null
  /** What the models used is showing. */
  usage: boolean
}

/** Where the usage page is. */
const USAGE = '-usage'
export const USAGE_ADDRESS = `#/${USAGE}`

function parseHash(): Route {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map((p) => decodeURIComponent(p))
  if (parts[0] === 'settings') return { botId: '', threadId: '', itemId: 0, settings: parts.slice(1).filter(Boolean), automations: null, usage: false }
  if (parts[0] === 'automations') return { botId: '', threadId: '', itemId: 0, settings: null, automations: parts.slice(1, parts[1] === 'new' ? 3 : 2).filter(Boolean), usage: false }
  // An address no bot can have: a bot's is the name of its folder, which never begins with a dash, and bots there already may be called "usage".
  if (parts[0] === USAGE) return { botId: '', threadId: '', itemId: 0, settings: null, automations: null, usage: true }
  return { botId: parts[0] ?? '', threadId: parts[1] ?? '', itemId: Number(parts[2]) || 0, settings: null, automations: null, usage: false }
}

/** The automations, or one of them ('new' for one being made, for `botId` when given). */
export function openAutomations(id = '', botId = '') {
  location.hash = `/automations${id ? `/${encodeURIComponent(id)}` : ''}${id === 'new' && botId ? `/${encodeURIComponent(botId)}` : ''}`
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
  const bots = useStore((s) => s.bots)
  useEffect(() => {
    const update = () => setRoute(parseHash())
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => followMoved(bots), [bots, route])
  return route
}

/**
 * An address with an id a bot had before (Bot.formerIds) is changed to the one it has now: the
 * page that was showing when its id changed, a notification or a link in a message from before.
 */
function followMoved(bots: Bot[]) {
  const parts = location.hash.replace(/^#\/?/, '').split('/')
  // Where an address names a bot: first, or after settings/bots/ or automations/new/.
  const at = parts[0] === 'settings' ? (parts[1] === 'bots' ? 2 : -1) : parts[0] === 'automations' ? (parts[1] === 'new' ? 2 : -1) : parts[0] === USAGE ? -1 : 0
  let id = ''
  try {
    id = at >= 0 ? decodeURIComponent(parts[at] ?? '') : ''
  } catch {
    return
  }
  if (!id || bots.some((bot) => bot.id === id)) return
  const bot = bots.find((b) => b.formerIds?.includes(id))
  if (!bot) return
  parts[at] = encodeURIComponent(bot.id)
  location.replace(`#/${parts.join('/')}`)
}
