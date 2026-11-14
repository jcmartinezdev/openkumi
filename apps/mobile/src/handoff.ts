// Text written on a screen of its own but kept by the screen it was opened from, such as an
// automation's prompt: the screen underneath says where the text is, under a key, and the screen
// on top reads and changes it there, so going back keeps it in the form, for that form's Save.
import { useEffect, useRef } from 'react'

const held = new Map<string, { text: () => string; change: (text: string) => void }>()

/** Offers `text` to a screen opened on top, which can change it with `change`, for as long as this screen is there. */
export function useHandoff(key: string, text: string, change: (text: string) => void) {
  const now = useRef({ text, change })
  now.current = { text, change }
  useEffect(() => {
    held.set(key, { text: () => now.current.text, change: (next) => now.current.change(next) })
    return () => void held.delete(key)
  }, [key])
}

/** The text a screen underneath offered under `key`, if it is still there. */
export const handedOver = (key: string) => held.get(key)
