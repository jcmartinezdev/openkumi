/// <reference lib="webworker" />
// The connection to the environment, on a thread of its own. It keeps the socket open, reads what
// arrives, and draws the pictures of a bot's browser straight onto the canvas it was given. The
// window's own thread only hears about changes it has to show, at most once per frame, so a busy
// bot or a fast-moving page never makes typing or scrolling stutter.
import type { ClientEvent, ServerEvent } from '@openbot/shared'

export type Command =
  /** Connect to this address, leaving whichever was connected before. */
  | { type: 'connect'; url: string; epoch: number }
  /** The same environment has a new access code: use this address the next time the connection is made. */
  | { type: 'retarget'; url: string }
  | { type: 'disconnect' }
  /** The connection turned out not to be usable: drop it and try again. */
  | { type: 'reconnect' }
  | { type: 'send'; event: ClientEvent }
  /** Draw the pictures of this view ("<bot>:<tab>") onto this canvas. */
  | { type: 'view'; key: string; canvas: OffscreenCanvas }
  | { type: 'unview'; key: string }

/** `epoch` says which connection a report is about, so one about an earlier connection can be ignored. */
export type Report =
  | { type: 'open'; epoch: number }
  | { type: 'close'; epoch: number }
  | { type: 'events'; epoch: number; events: ServerEvent[] }
  /** A view showed its first picture, or the page in it changed size. */
  | { type: 'frame'; key: string; width: number; height: number }

const report = (message: Report) => postMessage(message)

// ---- the socket

let target: { url: string; epoch: number } | null = null
let socket: WebSocket | null = null
let retry: ReturnType<typeof setTimeout> | undefined

function open() {
  clearTimeout(retry)
  const at = target
  if (!at) return
  const ws = new WebSocket(at.url)
  ws.binaryType = 'arraybuffer'
  socket = ws
  ws.onopen = () => ws === socket && report({ type: 'open', epoch: at.epoch })
  ws.onmessage = (e) => {
    if (ws !== socket) return
    if (typeof e.data === 'string') queue(JSON.parse(e.data))
    else picture(e.data)
  }
  ws.onclose = () => {
    if (ws !== socket) return
    socket = null
    flush()
    report({ type: 'close', epoch: at.epoch })
    retry = setTimeout(open, 1000)
  }
}

function hangUp() {
  clearTimeout(retry)
  const ws = socket
  // Cleared first, so that nothing more from this socket is passed on.
  socket = null
  ws?.close()
  clearTimeout(timer)
  timer = undefined
  pending = []
}

// ---- events: passed on in batches, at most one per frame

const FRAME = 16
let pending: ServerEvent[] = []
let timer: ReturnType<typeof setTimeout> | undefined
let lastFlush = 0

function queue(event: ServerEvent) {
  const last = pending.at(-1)
  // A reply arrives a few characters at a time; what came since the last batch is sent as one piece.
  if (event.type === 'stream.delta' && last?.type === 'stream.delta' && last.threadId === event.threadId && last.kind === event.kind) last.delta += event.delta
  else pending.push(event)
  // After a quiet moment the first event goes out at once; the ones behind it wait for the next frame.
  timer ??= setTimeout(flush, Math.max(0, lastFlush + FRAME - performance.now()))
}

function flush() {
  clearTimeout(timer)
  timer = undefined
  if (!pending.length || !target) return
  lastFlush = performance.now()
  report({ type: 'events', epoch: target.epoch, events: pending })
  pending = []
}

// ---- pictures of a bot's browser

interface View {
  canvas: OffscreenCanvas
  context: ImageBitmapRenderingContext
  /** The size of the page, as last reported to the window. */
  width: number
  height: number
  drawing: boolean
  /** The newest picture that has not been drawn yet. Older ones it replaced are never drawn. */
  next: { jpeg: Uint8Array<ArrayBuffer>; width: number; height: number } | null
}
const views = new Map<string, View>()
const text = new TextDecoder()

/** A picture as the server sends it: see `sendFrame` in apps/server/src/http.ts for the layout. */
function picture(data: ArrayBuffer) {
  const head = new DataView(data)
  if (data.byteLength < 7 || head.getUint8(0) !== 1) return
  const named = head.getUint16(5)
  const key = text.decode(new Uint8Array(data, 7, named))
  const view = views.get(key)
  if (!view) return
  view.next = { jpeg: new Uint8Array(data, 7 + named), width: head.getUint16(1), height: head.getUint16(3) }
  if (!view.drawing) void draw(key, view)
}

async function draw(key: string, view: View) {
  view.drawing = true
  while (view.next && views.get(key) === view) {
    const { jpeg, width, height } = view.next
    view.next = null
    try {
      const bitmap = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }))
      if (views.get(key) !== view) {
        bitmap.close()
        break
      }
      if (view.canvas.width !== bitmap.width || view.canvas.height !== bitmap.height) {
        view.canvas.width = bitmap.width
        view.canvas.height = bitmap.height
      }
      view.context.transferFromImageBitmap(bitmap)
      if (view.width !== width || view.height !== height) {
        view.width = width
        view.height = height
        report({ type: 'frame', key, width, height })
      }
    } catch {
      // A picture that cannot be read is skipped; the next one replaces it anyway.
    }
  }
  view.drawing = false
}

onmessage = ({ data }: MessageEvent<Command>) => {
  switch (data.type) {
    case 'connect':
      hangUp()
      target = { url: data.url, epoch: data.epoch }
      return open()
    case 'retarget':
      if (target) target.url = data.url
      return
    case 'disconnect':
      target = null
      return hangUp()
    case 'reconnect':
      // Closing goes the usual way: the window is told, and the connection is tried again.
      return void socket?.close()
    case 'send':
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data.event))
      return
    case 'view': {
      const context = data.canvas.getContext('bitmaprenderer')
      if (context) views.set(data.key, { canvas: data.canvas, context, width: 0, height: 0, drawing: false, next: null })
      return
    }
    case 'unview':
      return void views.delete(data.key)
  }
}
