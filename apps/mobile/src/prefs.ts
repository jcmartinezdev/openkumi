// What this phone prefers, kept on it (Settings › Appearance): light or dark, and how big messages
// are written. Everything else in Settings belongs to the bots and is kept by the server.
import { useSyncExternalStore } from 'react'
import { Appearance } from 'react-native'
import * as SecureStore from 'expo-secure-store'

export interface Prefs {
  theme: 'system' | 'light' | 'dark'
  textSize: 'small' | 'default' | 'large'
}

export const PREF_DEFAULTS: Prefs = { theme: 'system', textSize: 'default' }
export const THEME_LABEL: Record<Prefs['theme'], string> = { system: 'System', light: 'Light', dark: 'Dark' }
export const TEXT_SIZE_LABEL: Record<Prefs['textSize'], string> = { small: 'Small', default: 'Default', large: 'Large' }
/** How much bigger than usual messages are written at each size. */
const TEXT_SCALE: Record<Prefs['textSize'], number> = { small: 0.9, default: 1, large: 1.15 }

const SAVED = 'openbot.prefs'
let prefs = PREF_DEFAULTS
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn))
const set = (next: Prefs) => {
  prefs = next
  // The whole app follows, its bars and menus included, as it does the phone's own setting.
  Appearance.setColorScheme(next.theme === 'system' ? 'auto' : next.theme)
  listeners.forEach((fn) => fn())
}

SecureStore.getItemAsync(SAVED)
  .then((saved) => {
    const stored: Partial<Prefs> = JSON.parse(saved ?? '{}')
    set({
      theme: stored.theme && stored.theme in THEME_LABEL ? stored.theme : PREF_DEFAULTS.theme,
      textSize: stored.textSize && stored.textSize in TEXT_SIZE_LABEL ? stored.textSize : PREF_DEFAULTS.textSize,
    })
  })
  .catch(() => {
    // Nothing saved, or it cannot be read: the app looks as the phone does.
  })

export const usePrefs = () => useSyncExternalStore(subscribe, () => prefs)
export const useTextScale = () => TEXT_SCALE[usePrefs().textSize]
export const textScaleOf = (size: Prefs['textSize']) => TEXT_SCALE[size]

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  set({ ...prefs, [key]: value })
  void SecureStore.setItemAsync(SAVED, JSON.stringify(prefs)).catch(() => {})
}
