// App-wide settings, kept in ~/.openkumi/settings.json and changed from the Settings page.
// Only values that differ from the defaults are written, so the file stays small and hand-editable.
import fs from 'node:fs'
import path from 'node:path'
import type { Settings } from '@openkumi/shared'
import { HOME, emit } from './config.ts'

export const DEFAULTS: Settings = {
  lan: false,
  browserChannel: 'chrome',
  defaultProvider: '',
  defaultWebSearch: true,
  defaultShowBrowser: false,
  disabledProviders: [],
  claudePath: '',
  codexPath: '',
  grokPath: '',
  localUrl: '',
  maxSteps: 80,
  maxSubagents: 8,
  maxDepth: 2,
  botMessages: true,
  instructionsLimit: 12_000,
  historyLimit: 60_000,
  debugEngines: false,
}

const FILE = path.join(HOME, 'settings.json')

const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined)
const text = (max: number) => (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined)
const oneOf = (...allowed: string[]) => (v: unknown) => (allowed.includes(v as string) ? (v as string) : undefined)
const whole = (min: number, max: number) => (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : undefined

/** What each setting accepts. A value that does not fit is ignored rather than stored. */
const ACCEPT: { [K in keyof Settings]: (v: unknown) => Settings[K] | undefined } = {
  lan: bool,
  browserChannel: oneOf('chrome', 'msedge', 'chromium') as (v: unknown) => Settings['browserChannel'] | undefined,
  defaultProvider: text(40),
  defaultWebSearch: bool,
  defaultShowBrowser: bool,
  disabledProviders: (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 20) : undefined),
  claudePath: text(500),
  codexPath: text(500),
  grokPath: text(500),
  localUrl: (v) => (typeof v === 'string' && (!v.trim() || /^https?:\/\//.test(v.trim())) ? v.trim().replace(/\/+$/, '').slice(0, 300) : undefined),
  maxSteps: whole(5, 500),
  maxSubagents: whole(1, 16),
  maxDepth: whole(0, 3),
  botMessages: bool,
  instructionsLimit: whole(2000, 60_000),
  historyLimit: whole(2000, 1_000_000),
  debugEngines: bool,
}

function clean(input: Record<string, unknown>): Partial<Settings> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(ACCEPT) as (keyof Settings)[]) {
    if (!(key in input)) continue
    const value = ACCEPT[key](input[key])
    if (value !== undefined) out[key] = value
  }
  return out
}

function load(): Settings {
  try {
    return { ...DEFAULTS, ...clean(JSON.parse(fs.readFileSync(FILE, 'utf8'))) }
  } catch {
    return { ...DEFAULTS }
  }
}

let current = load()
const listeners = new Set<(now: Settings, before: Settings) => void>()

export const settings = () => current

/** Runs `fn` after every change, with the settings as they are now and as they were. */
export function onSettingsChange(fn: (now: Settings, before: Settings) => void) {
  listeners.add(fn)
}

export function updateSettings(patch: Record<string, unknown>): Settings {
  const before = current
  current = { ...current, ...clean(patch) }
  const changed = Object.fromEntries(Object.entries(current).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(DEFAULTS[key as keyof Settings])))
  fs.writeFileSync(FILE, JSON.stringify(changed, null, 2) + '\n')
  emit({ type: 'settings', settings: current })
  listeners.forEach((fn) => fn(current, before))
  return current
}
