// Colours, in the app's light and dark dress (the same ones the desktop app uses). Whether the app
// is light or dark follows the phone unless Settings › Appearance says otherwise (src/prefs.ts).
import { useColorScheme } from 'react-native'

const dark = { bg: '#0c0c0d', side: '#111113', card: '#161618', raised: '#1c1c1f', border: 'rgba(255,255,255,0.09)', text: '#ededef', muted: '#9a9aa3', faint: '#74747e', primary: '#f4f4f5', onPrimary: '#111113', bubble: '#232326', segment: '#46464c', ok: '#4ade80', err: '#f87171', run: '#fbbf24', group: '#0c0c0d', groupCard: '#1a1a1d' }
const light = { bg: '#ffffff', side: '#f7f7f8', card: '#ffffff', raised: '#ffffff', border: 'rgba(0,0,0,0.1)', text: '#18181b', muted: '#63636c', faint: '#8a8a94', primary: '#18181b', onPrimary: '#ffffff', bubble: '#efeff1', segment: '#ffffff', ok: '#16a34a', err: '#dc2626', run: '#d97706', group: '#f2f2f5', groupCard: '#ffffff' }
export type Theme = typeof dark

/** Both dresses, for drawing a preview of one while the app wears the other. */
export const THEMES = { light, dark }

export const useTheme = (): Theme => (useColorScheme() === 'light' ? light : dark)

/** Light or dark, for what is drawn in a web view (pages, diagrams, formulas). */
export const useAppearance = (): 'light' | 'dark' => (useColorScheme() === 'light' ? 'light' : 'dark')
