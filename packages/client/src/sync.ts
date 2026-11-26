// How up to date what a view shows is, said over it in both apps: nothing while it is,
// "Reconnecting…" while there is no connection, and "Syncing…" once there is one again, while
// what changed meanwhile is on its way: first what the server changed, then the newer messages of
// the chat on screen. The phone shows it most, back in front after its owner was at the computer:
// until the chat on screen has caught up, what was said there is not in it yet.
import { useEffect, useState } from 'react'
import { useStore } from './store'

export type Sync = 'connecting' | 'reconnecting' | 'syncing'

export const SYNC_WORDS: Record<Sync, string> = { connecting: 'Connecting…', reconnecting: 'Reconnecting…', syncing: 'Syncing…' }

/** Catching up that is over sooner than this is not shown: nearby it takes no time worth a word. Until then, what was up stays. */
export const SHOW_AFTER = 400
/**
 * Reconnecting or syncing stays this much longer once it is over, so the moment between the list
 * catching up and the chat on screen does not make it blink. Connecting goes at once: the screen
 * it was said over gives way to what has just come.
 */
export const HOLD = 250

/**
 * What to show next, from what is shown and how things stand now, and how long to wait before
 * showing it: "Syncing…" waits a moment before it comes up, and the word goes a moment after.
 */
export function nextSync(shown: Sync | null, now: Sync | null): { show: Sync | null; after: number } {
  if (now === shown) return { show: now, after: 0 }
  if (now === null) return { show: null, after: shown === 'connecting' ? 0 : HOLD }
  if (now === 'syncing') return { show: now, after: SHOW_AFTER }
  return { show: now, after: 0 }
}

/** How things stand, for a view that shows `threadId` when it shows a chat. */
export function syncOf(s: { connected: boolean; loaded: boolean; syncing: boolean; catchingUp: Record<string, true> }, threadId?: string): Sync | null {
  if (s.syncing || (s.connected && !!threadId && s.catchingUp[threadId])) return 'syncing'
  if (!s.connected) return s.loaded ? 'reconnecting' : 'connecting'
  return null
}

/** The word to show over a view that shows `threadId` when it shows a chat, or null while it is up to date. */
export function useSync(threadId?: string): Sync | null {
  const now = useStore((s) => syncOf(s, threadId))
  const [shown, setShown] = useState<Sync | null>(() => (nextSync(null, now).after ? null : now))
  useEffect(() => {
    const { show, after } = nextSync(shown, now)
    if (show === shown) return
    if (!after) return void setShown(show)
    const later = setTimeout(() => setShown(show), after)
    return () => clearTimeout(later)
  }, [now, shown])
  // A word that changes at once is shown from this drawing on, not the next.
  return nextSync(shown, now).after ? shown : now
}
