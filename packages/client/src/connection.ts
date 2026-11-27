// The connection to an environment: it holds the socket and passes on what arrives in batches, at
// most one per frame. When the socket drops it says so and waits to be told where to connect again:
// the store first makes sure the address is still the environment's server (see store.ts). On the
// desktop this runs on a worker thread (apps/web/src/connection.worker.ts); on a phone it runs
// where the app does.
//
// A socket can also die without closing: a phone that was put away, a computer that slept. A server
// sends a ping every 20 seconds (apps/server/src/http.ts), so a socket that has been quiet for longer
// than that is asked whether it is still there, and one that does not answer is taken as gone. The
// app asks at once with `check` when it comes back to the front. A server that never sent a ping is
// from before there were any, and is not asked.
import type { ClientEvent, ServerEvent } from '@openkumi/shared'

export type Command =
  /** Connect to this address, leaving whichever was connected before. */
  | { type: 'connect'; url: string; epoch: number }
  | { type: 'disconnect' }
  /** The connection turned out not to be usable: drop it, which is reported as a close. */
  | { type: 'reconnect' }
  /** Ask the server whether the connection is still there, rather than wait for it to go quiet: the app is back in front. */
  | { type: 'check' }
  | { type: 'send'; event: ClientEvent }

/** `epoch` says which connection a report is about, so one about an earlier connection can be ignored. */
export type Report =
  | { type: 'open'; epoch: number }
  /** `gone`: the socket did not answer when asked, so it was closed here, and there is no need to wait before connecting again. */
  | { type: 'close'; epoch: number; gone?: boolean }
  | { type: 'events'; epoch: number; events: ServerEvent[] }

/** A picture of a bot's browser: which view it is of ("<bot>:<tab>"), the page's size, and the JPEG. */
export interface Picture {
  key: string
  width: number
  height: number
  jpeg: Uint8Array<ArrayBuffer>
}

/** How long a socket may be quiet before it is asked whether it is still there: a little over two of the server's pings. */
const QUIET = 45_000
/** How long it has to answer before it is taken as gone. */
const ANSWER = 5_000

/**
 * Makes a connection. `report` hears about it opening, closing and what arrived; `picture` is
 * given each picture of a bot's browser as it comes. Returns the function that takes commands.
 * `timing` is for tests, which cannot wait as long.
 */
export function createConnection(report: (message: Report) => void, picture: (picture: Picture) => void, timing = { quiet: QUIET, answer: ANSWER }): (command: Command) => void {
  // ---- the socket

  let target: { url: string; epoch: number } | null = null
  let socket: WebSocket | null = null

  function open() {
    const at = target
    if (!at) return
    const ws = new WebSocket(at.url)
    ws.binaryType = 'arraybuffer'
    socket = ws
    heard = Date.now()
    pings = false
    ws.onopen = () => {
      if (ws !== socket) return
      heard = Date.now()
      watching = setInterval(watch, Math.min(5_000, timing.quiet / 4))
      report({ type: 'open', epoch: at.epoch })
    }
    ws.onmessage = (e) => {
      if (ws !== socket) return
      heard = Date.now()
      clearTimeout(asking)
      asking = undefined
      if (typeof e.data !== 'string') return read(e.data)
      const event = JSON.parse(e.data) as ServerEvent
      // Only says the server is there, which is now known: nothing for the store.
      if (event.type === 'ping') pings = true
      else queue(event)
    }
    ws.onclose = () => {
      if (ws !== socket) return
      socket = null
      stopWatching()
      flush()
      report({ type: 'close', epoch: at.epoch })
    }
  }

  function hangUp() {
    const ws = socket
    // Cleared first, so that nothing more from this socket is passed on.
    socket = null
    ws?.close()
    stopWatching()
    clearTimeout(timer)
    timer = undefined
    pending = []
  }

  // ---- whether the socket is still there

  /** When the socket last heard anything. */
  let heard = 0
  /** The server sends pings, so it answers one: one from before there were any is never asked. */
  let pings = false
  let watching: ReturnType<typeof setInterval> | undefined
  /** Set while the socket has been asked and has not answered yet. */
  let asking: ReturnType<typeof setTimeout> | undefined

  function stopWatching() {
    clearInterval(watching)
    clearTimeout(asking)
    watching = asking = undefined
  }

  /** Asks whether the socket is still there, unless it is being asked already. Anything that arrives is an answer. */
  function ask() {
    const ws = socket
    if (!ws || !pings || asking || ws.readyState !== WebSocket.OPEN) return
    try {
      ws.send(JSON.stringify({ type: 'ping' } satisfies ClientEvent))
    } catch {
      // A socket that cannot even send is not there: it is let go when the time to answer is up.
    }
    asking = setTimeout(() => ws === socket && gone(), timing.answer)
  }

  /** The socket did not answer: it is closed here, without waiting to hear that it closed, and reported as closed. */
  function gone() {
    const at = target
    const ws = socket
    socket = null
    stopWatching()
    ws?.close()
    flush()
    if (at) report({ type: 'close', epoch: at.epoch, gone: true })
  }

  // Checked now and then rather than after each message, which can come many times a second. After a
  // phone or a computer wakes up, this runs late, finds the socket quiet for long, and asks.
  function watch() {
    if (socket && Date.now() - heard > timing.quiet) ask()
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
      case 'check':
        return ask()
      case 'send':
        if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command.event))
        return
    }
  }
}
