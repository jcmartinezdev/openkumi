// The iPhone's dictation (apple/DictationModule.swift): what is said is written down on the phone,
// with Apple's speech models, and only the words come out of it.
import { requireOptionalNativeModule } from 'expo'
import type { DictationEvent, Listener } from '@openkumi/shared/dictation'

interface Native {
  isAvailable(): boolean
  start(locale: string | null): Promise<void>
  stop(): Promise<void>
  cancel(): Promise<void>
  addListener(name: 'onDictation', listener: (event: DictationEvent) => void): { remove(): void }
}

// Missing from an app built before dictation was added.
const native = requireOptionalNativeModule<Native>('OpenKumiDictation')

/** The phone's way of taking dictation, or null where it has none (before iOS 26). */
export const listener: Listener | null = native?.isAvailable()
  ? {
      start: (locale) => native.start(locale ?? null),
      stop: () => native.stop(),
      cancel: () => native.cancel(),
      onEvent(fn) {
        const subscription = native.addListener('onDictation', fn)
        return () => subscription.remove()
      },
    }
  : null
