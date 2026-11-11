// Colours, in the app's light and dark dress (the same ones the desktop app uses).
import { useColorScheme } from 'react-native'

const dark = { bg: '#0c0c0d', side: '#111113', card: '#161618', raised: '#1c1c1f', border: 'rgba(255,255,255,0.09)', text: '#ededef', muted: '#9a9aa3', faint: '#74747e', primary: '#f4f4f5', onPrimary: '#111113', bubble: '#232326', ok: '#4ade80', err: '#f87171', run: '#fbbf24' }
const light = { bg: '#ffffff', side: '#f7f7f8', card: '#ffffff', raised: '#ffffff', border: 'rgba(0,0,0,0.1)', text: '#18181b', muted: '#63636c', faint: '#8a8a94', primary: '#18181b', onPrimary: '#ffffff', bubble: '#efeff1', ok: '#16a34a', err: '#dc2626', run: '#d97706' }
export type Theme = typeof dark

export const useTheme = (): Theme => (useColorScheme() === 'light' ? light : dark)
