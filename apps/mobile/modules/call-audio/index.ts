// Where a call's sound comes out on the iPhone (apple/CallAudioModule.swift): the loudspeaker or
// the ear, and what else it may be going to (headphones, a car).
import { requireOptionalNativeModule } from 'expo'

/** Where the sound goes when it is neither the loudspeaker nor the ear: `name` is what the phone calls it ("AirPods Pro"). */
export interface Route {
  other: boolean
  name: string
}

interface Native {
  /** A call began: from now on its sound is kept on the loudspeaker (`loud`) or at the ear. */
  start(loud: boolean): void
  setLoud(loud: boolean): void
  /** The call is over. */
  stop(): void
  addListener(name: 'onRoute', listener: (route: Route) => void): { remove(): void }
}

// Missing from an app built before calls were added.
export const callAudio = requireOptionalNativeModule<Native>('OpenKumiCallAudio')
