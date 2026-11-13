// The connection to an environment: it holds the socket and passes on what arrives in batches, at
// most one per frame. When the socket drops it says so and waits to be told where to connect again:
// the store first makes sure the address is still the environment's server (see store.ts). On the
// desktop this runs on a worker thread (apps/web/src/connection.worker.ts); on a phone it runs
// where the app does.
import type { ClientEvent, ServerEvent } from '@openkumi/shared'

export type Command =
  /** Connect to this address, leaving whichever was connected before. */
  | { type: 'connect'; url: string; epoch: number }
  | { type: 'disconnect' }
  /** The connection turned out not to be usable: drop it, which is reported as a close. */
  | { type: 'reconnect' }
  | { type: 'send'; event: ClientEvent }

/** `epoch` says which connection a report is about, so one about an earlier connection can be ignored. */
export type Report =
  | { type: 'open'; epoch: number }
  | { type: 'close'; epoch: number }
  | { type: 'events'; epoch: number; events: ServerEvent[] }

/** A picture of a bot's browser: which view it is of ("<bot>:<tab>"), the page's size, and the JPEG. */
export interface Picture {
  key: string
  width: number
  height: number
  jpeg: Uint8Array<ArrayBuffer>
}

/**
 * Makes a connection. `report` hears about it opening, closing and what arrived; `picture` is
 * given each picture of a bot's browser as it comes. Returns the function that takes commands.
 */
export function createConnection(report: (message: Report) => void, picture: (picture: Picture) => void): (command: Command) => void {
  // ---- the socket

  let target: { url: string; epoch: number } | null = null
  let socket: WebSocket | null = null

  function open() {
    const at = target
    if (!at) return
    const ws = new WebSocket(at.url)
    ws.binaryType = 'arraybuffer'
    socket = ws
    ws.onopen = () => ws === socket && report({ type: 'open', epoch: at.epoch })
    ws.onmessage = (e) => {
      if (ws !== socket) return
      if (typeof e.data === 'string') queue(JSON.parse(e.data))
      else read(e.data)
    }
    ws.onclose = () => {
      if (ws !== socket) return
      socket = null
      flush()
      report({ type: 'close', epoch: at.epoch })
    }
  }

  function hangUp() {
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

  
  /** A picture as the server sends it: see `sendFrame` in apps/server/src/http.ts for the layout. */
  function read(data: ArrayBuffer) {
    const head = new DataView(data)
    if (data.byteLength < 7 || head.getUint8(0) !== 1) return
    const named = head.getUint16(5)
    picture({ key: String.fromCharCode(...new Uint8Array(data, 7, named)), width: head.getUint16(1), height: head.getUint16(3), jpeg: new Uint8Array(data, 7 + named) })
  }

  return (command) => {
    switch (command.type) {
      case 'connect':
        hangUp()
        target = { url: command.url, epoch: command.epoch }
        return open()
      case 'disconnect':
        target = null
        return hangUp()
      case 'reconnect':
        // Closing goes the usual way: whoever listens is told, and the connection is tried again.
        return void socket?.close()
      case 'send':
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command.event))
        return
    }
  }
}
