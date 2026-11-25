// Calling a bot: the owner talks with it out loud, and it talks back at once (see `Call` in
// @openkumi/shared, and apps/server/src/calls.ts). The app opens the microphone and makes its half
// of a WebRTC connection; the server gives back the other half, and from then on sound goes between
// this device and the speech model directly. What is said comes back as words, through the
// server's events, and is kept in the store.
//
// How a device makes such a connection is up to each app (the desktop window has WebRTC built in,
// the phone brings its own): each hands over a `Phone`. This is the part they share.
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Bot, Call } from '@openkumi/shared'
import { ApiError, api, onEnvironmentChange, onState, useStore } from './store'
import { type Voices, voiceName } from './voices'

export { type Voices, voiceName } from './voices'

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

/** Whether this app is on a call, or making one, right now: for what must not cut one off. */
export const onCall = () => calling.phase !== 'off'

/** This app's own call as it stands, and a way to hear of each change to it, for what is not a view (a car's screen). */
export const callingNow = () => calling
export function onCalling(fn: () => void): () => void {
  watchers.add(fn)
  return () => void watchers.delete(fn)
}

/** The call an app shows: its own, or one under way on another device, which can be seen and ended from here. */
export interface CallShown {
  calling: Calling
  /** The call as the server tells of it. */
  call: Call | null
  /** This app is making the call, or is on it. */
  mine: boolean
  /** A call made from another device is under way. Not the one this app just hung up, which the server is still ending. */
  elsewhere: boolean
  /** The bot on the line. */
  bot: Bot | undefined
  /** How the call stands, in a few words. */
  status: string
}

export function useCallShown(): CallShown {
  const calling = useCalling()
  const call = useStore((s) => s.call)
  const bots = useStore((s) => s.bots)
  const mine = calling.phase !== 'off'
  const elsewhere = !mine && !!call && call.id !== calling.last
  const bot = bots.find((b) => b.id === (mine ? calling.botId : call?.botId))
  const status =
    elsewhere ? 'On a call on another device'
    : calling.phase === 'asking' ? 'Waiting for the microphone…'
    : calling.phase === 'connecting' ? 'Calling…'
    : call?.id === calling.id && call.working > 0 ? 'Working on it…'
    : calling.muted ? 'Muted'
    : 'On a call'
  return { calling, call, mine, elsewhere, bot, status }
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
  // A voice being tried out gives way to a call.
  stopHearing()
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

/** Asked once per environment: the voices come with the Codex installed there. */
let voices: Promise<Voices> | null = null
onEnvironmentChange(() => (voices = null))

/** The voices the Codex of this environment offers, once they are known and while bots can be called. Null until then. */
export function useVoices(): Voices | null {
  const available = useStore((s) => !!s.calls?.available)
  const connected = useStore((s) => s.connected)
  const [known, setKnown] = useState<Voices | null>(null)
  // Counted up to ask again after an answer that did not come.
  const [tries, setTries] = useState(0)
  useEffect(() => {
    if (!available || !connected || known) return
    let showing = true
    let again: ReturnType<typeof setTimeout> | undefined
    voices ??= api<Voices>('GET', '/api/calls/voices')
    voices.then(
      (list) => showing && setKnown(list),
      () => {
        voices = null
        // The server was restarting, or Codex was slow to say: asked again shortly, and when the connection is back.
        if (showing) again = setTimeout(() => setTries((n) => n + 1), 3000)
      },
    )
    return () => {
      showing = false
      clearTimeout(again)
    }
  }, [available, connected, tries])
  return available ? known : null
}

/**
 * The voices a bot can be given, as choices for a picker: the usual one first (kept as ""), then
 * each by name, and the bot's own if it is no longer among them. Null until they are known, or
 * while bots cannot be called.
 */
export function useVoiceChoices(current: string): (readonly [string, string])[] | null {
  const known = useVoices()
  if (!known) return null
  return [
    ['', known.usual ? `Usual (${voiceName(known.usual)})` : 'Usual'] as const,
    ...known.voices.map((voice) => [voice, voiceName(voice)] as const),
    ...(current && !known.voices.includes(current) ? [[current, `${voiceName(current)} (no longer offered)`] as const] : []),
  ]
}

// ---- hearing a voice before choosing it
// A voice is tried out the way it will be heard: on the line, saying a short line as the bot. The
// app makes a connection as for a call, and the server has Codex put the voice on it
// (apps/server/src/calls.ts, `startSample`). One voice at a time, and none while a call is on.

export interface Hearing {
  /** The microphone was refused, so the error is one the device's settings put right. */
  denied?: boolean
  /** The voice being heard ("" is the usual one), or null when none is. */
  voice: string | null
  /** Getting the voice on the line, then hearing it say its line. */
  phase: 'off' | 'connecting' | 'speaking'
  /** Why the last voice could not be heard, until another is tried. */
  error: string
}

const QUIET: Hearing = { voice: null, phase: 'off', error: '' }
let hearing = QUIET
const listeners = new Set<() => void>()
function tell(next: Hearing) {
  hearing = next
  listeners.forEach((fn) => fn())
}

export function useHearing(): Hearing {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
    () => hearing,
  )
}

/** What the app holds of the voice it is hearing. */
interface Heard {
  sound?: Sound
  line?: Line
  silence?: () => void
  id?: string
  done?: ReturnType<typeof setTimeout>
}
let heard: Heard | null = null

/** How long the sound is given to reach the app once both halves of the connection are there. */
const REACHED_WITHIN = 15_000

/** Has a voice say a short line as the bot, for the owner to hear. A voice being heard stops first. */
export async function hearVoice(botId: string, voice: string) {
  if (!phone) return
  stopHearing()
  if (calling.phase !== 'off') return tell({ ...QUIET, error: 'Hang up to hear another voice.' })
  const mine: Heard = {}
  heard = mine
  /** Stopped, or replaced by another voice, while this one was being put on the line. */
  const dropped = () => heard !== mine
  tell({ voice, phase: 'connecting', error: '' })
  try {
    // The speech model only runs while it is sent sound, so the microphone is opened as for a call, and kept
    // switched off: what it sends is silence, and nothing said in the room reaches the voice.
    mine.sound = await phone.microphone()
    if (dropped()) return void mine.sound.getTracks().forEach((track) => track.stop())
    const line = (mine.line = phone.line())
    for (const track of mine.sound.getTracks()) {
      track.enabled = false
      line.addTrack(track, mine.sound)
    }
    line.createDataChannel('oai-events')
    line.addEventListener('track', (event) => {
      if (dropped() || mine.silence) return
      mine.silence = phone!.play(event.streams?.[0])
    })
    const reached = new Promise<void>((resolve, reject) => {
      const late = setTimeout(() => reject(new Error('The voice could not be reached.')), REACHED_WITHIN)
      line.addEventListener('connectionstatechange', () => {
        if (line.connectionState === 'connected') (clearTimeout(late), resolve())
        else if (line.connectionState === 'failed' || line.connectionState === 'closed') (clearTimeout(late), reject(new Error('The voice could not be reached.')))
      })
    })
    // One that is given up on is not waited for by anyone.
    reached.catch(() => {})
    const offer = await line.createOffer({ offerToReceiveAudio: true })
    await line.setLocalDescription(offer)
    if (dropped()) return
    const sample = await api<{ id: string; sdp: string }>('POST', `/api/bots/${encodeURIComponent(botId)}/voice-sample`, { voice, sdp: offer.sdp })
    if (dropped()) return void api('DELETE', `/api/calls/samples/${sample.id}`).catch(() => {})
    mine.id = sample.id
    await line.setRemoteDescription({ type: 'answer', sdp: sample.sdp })
    // The voice is asked for its line once the sound can get here, or its first words would be lost.
    await reached
    if (dropped()) return
    tell({ voice, phase: 'speaking', error: '' })
    await api('POST', `/api/calls/samples/${sample.id}/say`)
    if (dropped()) return
    // The server answers when the line has been said; its last sound is still on its way here.
    mine.done = setTimeout(() => !dropped() && stopHearing(), 600)
  } catch (e: any) {
    if (!dropped()) stopHearing(String(e?.message ?? e), e instanceof Denied)
  }
}

/** Stops the voice being heard. `error` is why, when it could not be heard. */
export function stopHearing(error = '', denied = false) {
  const was = heard
  heard = null
  if (was) {
    clearTimeout(was.done)
    was.silence?.()
    was.sound?.getTracks().forEach((track) => track.stop())
    try {
      was.line?.close()
    } catch {
      // Closed already.
    }
    if (was.id) api('DELETE', `/api/calls/samples/${was.id}`).catch(() => {})
  }
  if (hearing !== QUIET || error) tell(error ? { ...QUIET, error, denied } : QUIET)
}

// A voice is heard in the environment it comes from.
onEnvironmentChange(() => stopHearing())
