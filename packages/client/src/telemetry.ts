// What an app records about itself: that it was opened, which screens, that dictation was used,
// that something went wrong in it. It is handed to the server the app is connected to, which
// checks it against its list and sends it, when its owner has agreed (apps/server/src/telemetry.ts).
// The apps send nothing themselves. What happens before a server is reached (the welcome) waits
// here, in memory, and is dropped when the server sends nothing or its owner said no.
import type { AppEvent } from '@openkumi/shared'
import { ApiError, api, appInfo, onState } from './store'

type Waiting = { event: string; at: string; carries: Record<string, unknown> }
let waiting: Waiting[] = []
let timer: ReturnType<typeof setTimeout> | undefined
/** Whether there is a server to hand things to right now. */
let reached = false
/** Whether that server takes them: it sends, and its owner has not said no. */
let taken = false

/** Records that something happened in the app. */
export function note(happened: AppEvent) {
  // With no server yet (the welcome), it waits: the one that is reached may take it.
  if ((reached && !taken) || waiting.length >= 100) return
  const { event, ...carries } = happened
  waiting.push({ event, at: new Date().toISOString(), carries })
  soon()
}

const opened = new Set<string>()
/** Records that a screen was opened, the first time it is each time the app runs. The name is the screen's, never what it shows. */
export function screen(name: string) {
  if (opened.has(name)) return
  opened.add(name)
  note({ event: 'screen opened', screen: name })
}

let errors = 0
/**
 * Records that something went wrong in the app: the kind of error, and where in the app's own
 * program, as file, line and column. Never the message, which can hold something a person wrote.
 */
export function wentWrong(error: unknown) {
  if (++errors > 10) return
  const name = (error as Error)?.name
  const at = String((error as Error)?.stack ?? '').match(/([\w.-]+\.(?:js|jsbundle|bundle|hbc))(?:\?[^:\s)]*)?:(\d+):(\d+)/)
  note({ event: 'app error', type: typeof name === 'string' && /^[A-Za-z]\w{0,59}$/.test(name) ? name : 'Error', position: at ? `${at[1]}:${at[2]}:${at[3]}` : 'unknown' })
}

function soon() {
  if (timer || !waiting.length) return
  timer = setTimeout(() => {
    timer = undefined
    void hand()
  }, 2000)
}

async function hand() {
  if (!reached || !taken || !waiting.length) return
  const batch = waiting.splice(0, 50)
  try {
    await api('POST', '/api/telemetry/events', { app: appInfo(), events: batch })
    soon()
  } catch (e) {
    // The server went away as it was asked: they wait for it to be back. Refused, they are let go.
    if (!(e instanceof ApiError)) waiting = [...batch, ...waiting].slice(0, 100)
  }
}

onState((s) => {
  reached = s.loaded && s.connected
  if (!reached) return
  // Asked of the server each time: a window can move to another one, which may have another answer.
  taken = !!s.about.telemetry?.can && s.settings.telemetry !== false
  if (!taken) waiting = []
  else soon()
})
