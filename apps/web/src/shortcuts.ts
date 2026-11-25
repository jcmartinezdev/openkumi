// Keys that work wherever the window is: ⌘1–9 (Ctrl+1–9 elsewhere) open the first nine bots as the
// sidebar lists them, and holding ⌘ (Ctrl) for a moment shows each one's number beside it. ⌘K is
// taken by the app itself (apps/desktop/src/main.ts) and opens the window's search (Palette.tsx).
import { useEffect, useRef, useState } from 'react'
import { note } from '@openkumi/client/telemetry'
import { navigate } from './store'

export const mac = navigator.platform.startsWith('Mac')
/** A key pressed with ⌘ (Ctrl), as it is written: "⌘1", or "Ctrl+1". */
export const withCommand = (key: string) => (mac ? `⌘${key}` : `Ctrl+${key}`)
/** ⌘ alone on a Mac, Ctrl alone elsewhere: Shift, Alt or the other one make it another shortcut. */
export const isCommand = (e: KeyboardEvent) => (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey
const COMMAND = mac ? 'Meta' : 'Control'
/** How long ⌘ is held before the numbers show: a quick ⌘C never shows them. */
const HOLD_MS = 400

/**
 * Sets the keys up while `on`, for the bots in `botIds` (the sidebar's order); `opened` is told which
 * one was opened. Returns whether the numbers are showing.
 */
export function useBotNumbers(botIds: string[], on: boolean, opened: (botId: string) => void): boolean {
  const [showing, setShowing] = useState(false)
  const latest = useRef({ botIds, opened })
  latest.current = { botIds, opened }
  useEffect(() => {
    if (!on) return setShowing(false)
    let timer: ReturnType<typeof setTimeout> | undefined
    const hide = () => (clearTimeout(timer), setShowing(false))
    // Seen on its way down, before anything in the window can keep it (a bot's browser takes its keys).
    const held = (e: KeyboardEvent) => {
      if (e.key === COMMAND) return void (!e.repeat && (clearTimeout(timer), (timer = setTimeout(() => setShowing(true), HOLD_MS))))
      // Another key with it is a shortcut of its own, unless it is one of the numbers.
      if (!(isCommand(e) && /^[1-9]$/.test(e.key))) hide()
    }
    // Seen last, so whatever has a use of its own for ⌘ and a number (the model picker) keeps it.
    const pressed = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isCommand(e) || !/^[1-9]$/.test(e.key)) return
      // Not from under a dialog, which would stay in front of the bot.
      if (document.querySelector('.backdrop')) return
      const id = latest.current.botIds[Number(e.key) - 1]
      if (!id) return
      e.preventDefault()
      note({ event: 'bot opened by number' })
      navigate(id)
      latest.current.opened(id)
    }
    const released = (e: KeyboardEvent) => e.key === COMMAND && hide()
    window.addEventListener('keydown', held, true)
    window.addEventListener('keydown', pressed)
    window.addEventListener('keyup', released, true)
    window.addEventListener('blur', hide)
    return () => {
      hide()
      window.removeEventListener('keydown', held, true)
      window.removeEventListener('keydown', pressed)
      window.removeEventListener('keyup', released, true)
      window.removeEventListener('blur', hide)
    }
  }, [on])
  return showing
}
