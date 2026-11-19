// How the phone makes a call. The calling itself is the same code the computer uses
// (@openkumi/client/calls); what is here is the phone's part of it: the microphone and the
// connection come from react-native-webrtc, which plays the other side's voice by itself, and
// where that voice comes out (the loudspeaker, the ear, headphones) is kept by modules/call-audio.
import { useSyncExternalStore } from 'react'
import { Alert } from 'react-native'
import { type MediaStream, RTCPeerConnection, mediaDevices } from 'react-native-webrtc'
import type { CallsInfo } from '@openkumi/shared'
import { type Calling, Denied, type Phone, call, hangUp, hearVoice, usePhone } from '@openkumi/client/calls'
import { type Route, callAudio } from '../modules/call-audio'

/** Where the call's sound comes out. */
export interface CallSound {
  /** The loudspeaker rather than the ear. A call starts on it. */
  loud: boolean
  /** Headphones, a car or the like have the sound, whatever `loud` says. */
  route: Route
}

let sound: CallSound = { loud: true, route: { other: false, name: '' } }
const watchers = new Set<() => void>()
function set(patch: Partial<CallSound>) {
  sound = { ...sound, ...patch }
  watchers.forEach((fn) => fn())
}
callAudio?.addListener('onRoute', (route) => {
  if (route.other !== sound.route.other || route.name !== sound.route.name) set({ route })
})

export function useCallSound(): CallSound {
  return useSyncExternalStore(
    (fn) => (watchers.add(fn), () => void watchers.delete(fn)),
    () => sound,
  )
}

/** Puts the call on the loudspeaker, or back at the ear. */
export function setLoud(loud: boolean) {
  set({ loud })
  callAudio?.setLoud(loud)
}

/** The microphone as it was last opened: let go of when it is opened again, since a call only stops its tracks. */
let opened: MediaStream | null = null

usePhone({
  async microphone() {
    opened?.release()
    opened = null
    try {
      // The phone asks the person, the first time, whether the app may listen.
      opened = await mediaDevices.getUserMedia({ audio: true })
    } catch (e: any) {
      if (e?.name === 'SecurityError') throw new Denied('OpenKumi is not allowed to use the microphone.')
      throw new Error(`The microphone could not be opened: ${e?.message ?? e}`)
    }
    return opened
  },
  line: () => new RTCPeerConnection() as unknown as ReturnType<Phone['line']>,
  // The voice plays by itself once it is on the line. What is left to do is to say where it comes out.
  play() {
    callAudio?.start(sound.loud)
    return () => callAudio?.stop()
  },
})

/** Has a voice say a short line as the bot. It is heard on the loudspeaker, wherever the last call was. */
export function hear(botId: string, voice: string) {
  set({ loud: true })
  void hearVoice(botId, voice)
}

/**
 * Calls a bot from the phone and shows the call, or says why bots cannot be called. A call the
 * phone is on with another bot is hung up first.
 */
export async function startCall(botId: string, { calls, calling, show }: { calls: CallsInfo | undefined; calling: Calling; show: () => void }) {
  if (!calls?.available) return Alert.alert('Calls are not set up', calls?.reason || 'The OpenKumi this bot runs on is too old for calls. Update it first.')
  if (calling.phase !== 'off') {
    if (calling.botId === botId) return show()
    await hangUp()
  }
  // Every call starts on the loudspeaker, whatever the one before ended on.
  set({ loud: true })
  void call(botId)
  show()
}
