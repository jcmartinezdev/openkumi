// Preferences that belong to one device rather than to an environment: how the app looks and
// behaves on this computer. They are kept by the app here; app-wide settings live in the environment.
import { useSyncExternalStore } from 'react'

export interface Prefs {
  theme: 'system' | 'light' | 'dark'
  textSize: 'small' | 'default' | 'large'
  /** A wider column for the conversation. */
  wide: boolean
  /** On a keyboard, Enter sends the message (otherwise it starts a new line and Cmd/Ctrl+Enter sends). */
  enterSends: boolean
  /** Show tool calls and thoughts opened up instead of one line each. */
  expandSteps: boolean
  /** Offer example messages in an empty chat. */
  suggestions: boolean
  /** Bring up the browser panel when a bot starts browsing. */
  autoOpenBrowser: boolean
  confirmDelete: boolean
  /** Models kept at hand in the model picker, as "<provider>:<model>". */
  favoriteModels: string[]
}

export const PREF_DEFAULTS: Prefs = {
  theme: 'system',
  textSize: 'default',
  wide: false,
  enterSends: true,
  expandSteps: false,
  suggestions: true,
  autoOpenBrowser: true,
  confirmDelete: true,
  favoriteModels: [],
}

const KEY = 'openbot.prefs'

function load(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    // Only known keys of the right type are taken, so an old or damaged entry cannot break the app.
    const known = Object.fromEntries(Object.entries(saved).filter(([k, v]) => k in PREF_DEFAULTS && typeof v === typeof PREF_DEFAULTS[k as keyof Prefs]))
    return { ...PREF_DEFAULTS, ...known }
  } catch {
    return { ...PREF_DEFAULTS }
  }
}

let prefs = load()
const subscribers = new Set<() => void>()

/** Puts the preferences that are about looks onto the page, where the stylesheet reads them. */
function apply() {
  const root = document.documentElement
  if (prefs.theme === 'system') delete root.dataset.theme
  else root.dataset.theme = prefs.theme
  root.style.setProperty('--chat-text', { small: '13px', default: '14px', large: '16px' }[prefs.textSize])
  root.style.setProperty('--chat-width', prefs.wide ? '940px' : '740px')
}
apply()

export function setPrefs(patch: Partial<Prefs>) {
  prefs = { ...prefs, ...patch }
  try {
    const changed = Object.fromEntries(Object.entries(prefs).filter(([k, v]) => v !== PREF_DEFAULTS[k as keyof Prefs]))
    localStorage.setItem(KEY, JSON.stringify(changed))
  } catch {
    // Private windows may refuse storage; the preference then lasts until the page is closed.
  }
  apply()
  subscribers.forEach((fn) => fn())
}

export const getPrefs = () => prefs

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
    () => prefs,
  )
}
