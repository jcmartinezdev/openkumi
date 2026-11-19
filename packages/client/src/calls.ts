// Calling a bot: the owner talks with it out loud, and it talks back at once (see `Call` in
// @openkumi/shared, and apps/server/src/calls.ts). The app opens the microphone and makes its half
// of a WebRTC connection; the server gives back the other half, and from then on sound goes between
// this device and the speech model directly. What is said comes back as words, through the
// server's events, and is kept in the store.
//
// How a device makes such a connection is up to each app (the desktop window has WebRTC built in,
// the phone brings its own): each hands over a `Phone`. This is the part they share.
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ApiError, api, onEnvironmentChange, onState, useStore } from './store'

/** A microphone, or the other side's voice. */
interface Sound {
  getTracks(): { enabled: boolean; stop(): void }[]
}

/** The connection a call's sound goes over: a WebRTC peer connection, as far as a call uses one. */
interface Line {
  addTrack(track: any, sound: any): unknown
  createDataChannel(label: string): unknown
  createOffer(options?: any): Promise<{ sdp?: string }>
  setLocalDescription(description: any): Promise<void>
  setRemoteDescription(description: any): Promise<void>
  close(): void
  connectionState: string
  addEventListener(type: string, listener: (event: any) => void): void
}

/** What an app brings so that calls can be made from it. */
export interface Phone {
  /** Opens the microphone, asking the person first where the device wants that. Throws `Denied` when they said no. */
  microphone(): Promise<Sound>
  /** A new connection. */
  line(): Line
  /** Plays the other side's voice, and gives the way to stop. A device that plays it by itself has nothing to do. */
  play(sound: unknown): () => void
}

/** Thrown by `Phone.microphone` when the app may not use the microphone. */
export class Denied extends Error {}

export interface Calling {
  /** Not on a call; opening the microphone; setting the call up; talking. */
  phase: 'off' | 'asking' | 'connecting' | 'live'
  /** The bot being called. */
  botId: string
  /** The call's id, once the server has made it. */
  id: string
  muted: boolean
  /** When the voice came on the line, in milliseconds. */
  since: number
  /** Why the last call could not be made, or ended by itself, until another starts or it is dismissed. */
  error: string
  /** The microphone was refused, so the error is one the device's settings put right. */
  denied: boolean
  /** The call this app was on last, which the server may still be ending. */
  last: string
}

const OFF: Calling = { phase: 'off', botId: '', id: '', muted: false, since: 0, error: '', denied: false, last: '' }
let calling = OFF
const watchers = new Set<() => void>()
function set(patch: Partial<Calling>) {
  calling = { ...calling, ...patch }
  watchers.forEach((fn) => fn())
}

/** This app's own call: the one it is making, not one made from another device. */
export function useCalling(): Calling {
  return useSyncExternalStore(
    (fn) => (watchers.add(fn), () => void watchers.delete(fn)),
    () => calling,
  )
}

let phone: Phone | null = null
/** Gives the app's way of making calls. Without one, the app cannot call. */
export function usePhone(given: Phone) {
  phone = given
}
export const canCall = () => !!phone

/** What this app holds of the call it is on. */
interface Held {
  sound?: Sound
  line?: Line
  silence?: () => void
  beat?: ReturnType<typeof setInterval>
  lost?: ReturnType<typeof setTimeout>
  /** The server's events have told of this call: from then on, when they stop telling of it, it is over. */
  told?: boolean
}
let held: Held | null = null

/** Lets go of the microphone and the connection. */
function release() {
  const was = held
  held = null
  if (!was) return
  clearInterval(was.beat)
  clearTimeout(was.lost)
  was.silence?.()
  was.sound?.getTracks().forEach((track) => track.stop())
  try {
    was.line?.close()
  } catch {
    // Closed already.
  }
}

/** The call is over on this side. `error` is why, when the person did not hang up. */
function over(error = '', denied = false) {
  release()
  set({ ...OFF, error, denied, last: calling.id || calling.last })
}

/** Counts the calls started and the hang-ups, so that a call that had to wait before it starts can tell it was overtaken. */
let moves = 0

/** Calls a bot. A call this app is already on is hung up first. */
export async function call(botId: string) {
  if (!phone) return
  const move = ++moves
  if (calling.phase !== 'off') await end()
  // Overtaken while the call before was being hung up: by a newer call, which goes ahead in its place, or by the
  // person hanging up. Taking the place regardless would leave the other's microphone open with nothing to close it.
  if (move !== moves) return
  const mine: Held = {}
  held = mine
  /** Hung up, or replaced by another call, while this one was being set up. */
  const dropped = () => held !== mine
  set({ ...OFF, phase: 'asking', botId })
  try {
    mine.sound = await phone.microphone()
    if (dropped()) return void mine.sound.getTracks().forEach((track) => track.stop())
    set({ phase: 'connecting' })
    const line = (mine.line = phone.line())
    for (const track of mine.sound.getTracks()) line.addTrack(track, mine.sound)
    // The speech model sends what happens on the call over this; the app has no use for it, but a call is not set up without it.
    line.createDataChannel('oai-events')
    line.addEventListener('track', (event) => {
      if (dropped() || mine.silence) return
      mine.silence = phone!.play(event.streams?.[0])
    })
    line.addEventListener('connectionstatechange', () => {
      if (dropped()) return
      clearTimeout(mine.lost)
      if (line.connectionState === 'failed') void fail('The connection for the call was lost.')
      // A network that changes (Wi-Fi to mobile) often finds its way again by itself.
      else if (line.connectionState === 'disconnected') mine.lost = setTimeout(() => void fail('The connection for the call was lost.'), 8000)
    })
    const offer = await line.createOffer({ offerToReceiveAudio: true })
    await line.setLocalDescription(offer)
    if (dropped()) return
    const answered = await api<{ call: { id: string }; sdp: string }>('POST', `/api/bots/${encodeURIComponent(botId)}/call`, { sdp: offer.sdp })
    if (dropped()) return void api('DELETE', `/api/calls/${answered.call.id}`).catch(() => {})
    set({ id: answered.call.id })
    await line.setRemoteDescription({ type: 'answer', sdp: answered.sdp })
    if (dropped()) return
    set({ phase: 'live', since: Date.now() })
    // The server ends a call whose app it no longer hears from.
    mine.beat = setInterval(() => {
      api('POST', `/api/calls/${answered.call.id}/alive`).catch((e) => {
        if (e instanceof ApiError && e.status === 404 && held === mine) over(lastError())
      })
    }, 10_000)
  } catch (e: any) {
    if (dropped()) return
    const id = calling.id
    over(e instanceof Denied ? e.message : String(e?.message ?? e), e instanceof Denied)
    if (id) api('DELETE', `/api/calls/${id}`).catch(() => {})
  }
}

/** Ends the call from this side because something went wrong with it. */
const fail = (error: string) => end(error)

/** Ends the call this app is on, on this side and on the server. */
async function end(error = '') {
  const id = calling.id
  over(error)
  if (id) await api('DELETE', `/api/calls/${id}`).catch(() => {})
}

/** Hangs up. */
export async function hangUp() {
  moves++
  await end()
}

/** Stops the bot hearing the person, or lets it hear them again. They still hear the bot. */
export function mute(muted: boolean) {
  held?.sound?.getTracks().forEach((track) => (track.enabled = !muted))
  set({ muted })
}

export const dismissCallError = () => set({ error: '', denied: false })

/** Ends a call that is under way on another device (or one this app lost track of). */
export const endCall = (id: string) => api('DELETE', `/api/calls/${id}`)

// The server ended the call (nothing was said for a long time, the plan ran out, Codex stopped):
// it says so in its events, and with why.
let lastError = () => ''
onState((state) => {
  lastError = () => state.callError
  if (!held || !calling.id || !state.connected) return
  // The answer to the request may get here before the events that tell of the call.
  if (state.call?.id === calling.id) held.told = true
  else if (held.told) over(state.callError)
})
// A call belongs to the environment it was made in.
onEnvironmentChange(() => calling.phase !== 'off' && over())

/** "0:42", from when the voice came on the line. */
export function callTime(since: number, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** How long a call lasted, for its record in the conversation: "42 s", "3 min", "1 h 5 min". */
export function callLength(seconds: number) {
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

// ---- the voice a bot has on a call

interface Voices {
  voices: string[]
  /** The one a bot has when none was chosen for it. */
  usual: string
}
/** Asked once per environment: the voices come with the Codex installed there. */
let voices: Promise<Voices> | null = null
onEnvironmentChange(() => (voices = null))

const voiceName = (voice: string) => voice.charAt(0).toUpperCase() + voice.slice(1)

/**
 * The voices a bot can be given, as choices for a picker: the usual one first (kept as ""), then
 * each by name, and the bot's own if it is no longer among them. Null until they are known, or
 * while bots cannot be called.
 */
export function useVoiceChoices(current: string): (readonly [string, string])[] | null {
  const available = useStore((s) => !!s.calls?.available)
  const [known, setKnown] = useState<Voices | null>(null)
  useEffect(() => {
    if (!available) return
    let showing = true
    voices ??= api<Voices>('GET', '/api/calls/voices')
    voices.then(
      (list) => showing && setKnown(list),
      () => (voices = null),
    )
    return () => {
      showing = false
    }
  }, [available])
  if (!available || !known) return null
  return [
    ['', known.usual ? `Usual (${voiceName(known.usual)})` : 'Usual'] as const,
    ...known.voices.map((voice) => [voice, voiceName(voice)] as const),
    ...(current && !known.voices.includes(current) ? [[current, `${voiceName(current)} (no longer offered)`] as const] : []),
  ]
}
