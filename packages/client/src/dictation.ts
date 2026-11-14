// Speaking a message instead of typing it. The device writes down what is said (a Mac or an iPhone,
// with Apple's speech models: packages/dictation), and the words go into the draft as they are
// heard, where the cursor was. No sound leaves the device, and the words only leave it when the
// draft is sent, like anything typed. How a device listens is up to each app; this is the part they share.
import { useEffect, useRef, useState } from 'react'
import type { DictationEvent, DictationFailure, Listener } from '@openkumi/shared/dictation'

/** A dictation that is forgotten is not left listening for ever: it finishes after this long. */
export const LIMIT = 10 * 60_000

/**
 * The draft with what was said put where the cursor was, with a space either side where words
 * would otherwise run together, and where the cursor goes after it.
 */
export function spokenInto(before: string, said: string, after: string) {
  const words = said.trim()
  const lead = before && words && !/\s$/.test(before) ? ' ' : ''
  const trail = after && words && !/^[\s.,;:!?)\]]/.test(after) ? ' ' : ''
  const upTo = before + lead + words + trail
  return { draft: upTo + after, cursor: upTo.length }
}

export interface Dictating {
  /** Not listening; getting the microphone and the model ready; listening; or settling the last words. */
  phase: 'off' | 'starting' | 'preparing' | 'listening' | 'finishing'
  /** How much of the speech model is fetched, while preparing (the first time a language is used). */
  progress: number
  /** Why the last dictation ended early, until another starts or it is dismissed. */
  failure: { code: DictationFailure; message: string } | null
  /** Starts listening. What is said goes into `draft` between `from` and `to` (the cursor, or the selection it replaces). */
  start(draft: string, from?: number, to?: number): void
  /** Stops listening. Once the last words are in, `then` is given the draft (to send it, say). */
  finish(then?: (draft: string) => void): void
  /** Gives up, and puts the draft back as it was. */
  cancel(): void
  dismiss(): void
}

/** The draft being spoken into. A device listens for one at a time, so starting another ends it. */
let speaking: symbol | null = null
const handOffs = new Set<() => void>()

/** Dictation into one draft. `write` is given the draft as it changes, and where its cursor goes. */
export function useDictation(listener: Listener | null, write: (draft: string, cursor: number) => void): Dictating {
  const [phase, setPhase] = useState<Dictating['phase']>('off')
  const [progress, setProgress] = useState(0)
  const [failure, setFailure] = useState<Dictating['failure']>(null)
  const [me] = useState(() => Symbol('draft'))
  const session = useRef<{ before: string; after: string; draft: string; then?: (draft: string) => void; limit: ReturnType<typeof setTimeout> } | null>(null)
  const writing = useRef(write)
  writing.current = write

  const put = (said: string) => {
    const { before, after } = session.current!
    const { draft, cursor } = spokenInto(before, said, after)
    writing.current(draft, cursor)
    return draft
  }

  const end = () => {
    clearTimeout(session.current?.limit)
    session.current = null
    setPhase('off')
  }

  const heard = (event: DictationEvent) => {
    const now = session.current
    if (!now || speaking !== me) return
    if (event.type === 'preparing') {
      setPhase('preparing')
      setProgress(event.progress)
    } else if (event.type === 'listening') setPhase((phase) => (phase === 'finishing' ? phase : 'listening'))
    else if (event.type === 'text') put(event.settled + event.guess)
    else if (event.type === 'done') {
      // Nothing was said: the draft is as it was, a selection and all.
      const draft = event.text.trim() ? put(event.text) : (writing.current(now.draft, now.before.length), now.draft)
      end()
      now.then?.(draft)
    } else if (event.type === 'failed') {
      // What was said before it failed stays in the draft.
      end()
      setFailure({ code: event.code, message: event.message })
    }
  }
  const hearing = useRef(heard)
  hearing.current = heard

  useEffect(() => {
    if (!listener) return
    const off = listener.onEvent((event) => hearing.current(event))
    // Another draft started listening: this one keeps what was said into it.
    const handOff = () => speaking !== me && session.current && end()
    handOffs.add(handOff)
    return () => {
      off()
      handOffs.delete(handOff)
      // Leaving the draft stops listening; what was said so far stays in it.
      if (speaking === me) {
        speaking = null
        if (session.current) void listener.cancel()
        clearTimeout(session.current?.limit)
        session.current = null
      }
    }
  }, [listener])

  const finish = (then?: (draft: string) => void) => {
    const now = session.current
    if (!now || !listener) return
    now.then = then
    setPhase('finishing')
    void listener.stop()
  }

  return {
    phase,
    progress,
    failure,
    start(draft, from = draft.length, to = from) {
      if (!listener || session.current) return
      speaking = me
      handOffs.forEach((fn) => fn())
      session.current = { before: draft.slice(0, from), after: draft.slice(to), draft, limit: setTimeout(() => finish(), LIMIT) }
      setFailure(null)
      setProgress(0)
      setPhase('starting')
      listener.start().catch((e: Error) => hearing.current({ type: 'failed', code: 'failed', message: e.message }))
    },
    finish,
    cancel() {
      const now = session.current
      if (!now || !listener) return
      end()
      writing.current(now.draft, now.before.length)
      void listener.cancel()
    },
    dismiss: () => setFailure(null),
  }
}
