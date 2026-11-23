// What the usage pages of both apps share: fetching what the server counted (its usage.ts),
// adding it up the ways a page shows it, and the words and colours for it. The pages only draw.
import { useEffect, useRef, useState } from 'react'
import type { Bot, ProviderInfo, ProviderLimits, Usage, UsageRow } from '@openkumi/shared'
import { moment } from './automations'
import { ApiError, api, useStore } from './store'

/** How far back a page can look, in days: one day is the last 24 hours, by the hour. */
export const RANGES = [
  [1, '24 hours'],
  [7, '7 days'],
  [30, '30 days'],
  [90, '90 days'],
] as const
export type Range = (typeof RANGES)[number][0]

/** What a chart measures: tokens, or what they would have cost as API calls. */
export type Measure = 'tokens' | 'cost'

// ---- colours
// The providers that have a colour of their own in a chart, in the order they are stacked. A colour
// belongs to its provider and never to its rank, so what is blue today is blue tomorrow. Anything
// else (a provider a later version adds) is drawn as "Other", in grey. The hues, their order and
// their light and dark steps were checked together for colour-blind readers and for contrast on
// the apps' card colours; change them only by checking again.
const DRAWN = ['codex', 'claude-code', 'grok', 'local', 'openai-compatible']
const COLORS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
}
const OTHER = { light: '#a1a1aa', dark: '#6b6b74' }
/** What everything without a colour of its own is drawn as. */
export const OTHERS = 'other'

/** The colour a provider is drawn in. */
export const colorOf = (provider: string, appearance: 'light' | 'dark') => COLORS[appearance][DRAWN.indexOf(provider)] ?? OTHER[appearance]

/** How a meter is filled by how much of an allowance is used: as usual, nearly used up, or as good as gone. */
export const pressure = (used: number): 'fine' | 'high' | 'full' => (used >= 95 ? 'full' : used >= 80 ? 'high' : 'fine')

// ---- adding up

/** Tokens and their cost, added up. `cost` covers what has a price; `unpriced` is how many tokens have none. */
export interface Sum {
  /** Sent to the model, of which `cached` came from a cache, and written by it. */
  input: number
  cached: number
  output: number
  /** Sent and written together. */
  tokens: number
  cost: number
  unpriced: number
}

export interface Group extends Sum {
  key: string
}

const nothing = (): Sum => ({ input: 0, cached: 0, output: 0, tokens: 0, cost: 0, unpriced: 0 })

function add(sum: Sum, row: UsageRow) {
  sum.input += row.input
  sum.cached += row.cached
  sum.output += row.output
  sum.tokens += row.input + row.output
  if (row.cost === null) sum.unpriced += row.input + row.output
  else sum.cost += row.cost
}

export function total(rows: UsageRow[]): Sum {
  const sum = nothing()
  for (const row of rows) add(sum, row)
  return sum
}

/** The rows added up by whatever `key` says of each, the most tokens first. */
export function groupBy(rows: UsageRow[], key: (row: UsageRow) => string): Group[] {
  const groups = new Map<string, Group>()
  for (const row of rows) {
    const k = key(row)
    let group = groups.get(k)
    if (!group) groups.set(k, (group = { key: k, ...nothing() }))
    add(group, row)
  }
  return [...groups.values()].sort((a, b) => b.tokens - a.tokens || a.key.localeCompare(b.key))
}

/** The provider a row is drawn as: its own, or "other" for one without a colour. */
const drawnAs = (provider: string) => (DRAWN.includes(provider) ? provider : OTHERS)

export interface Columns {
  /** What is stacked in each column, bottom first: providers, and maybe "other". Only what was used at all. */
  series: string[]
  /** For each stretch of time, how much of each of the series. */
  values: number[][]
  /** The tallest column. */
  most: number
}

/** The chart's columns: one for each stretch of time, stacked by provider. */
export function columns(usage: Usage, measure: Measure): Columns {
  const amount = (row: UsageRow) => (measure === 'tokens' ? row.input + row.output : (row.cost ?? 0))
  const used = new Set(usage.rows.filter((row) => amount(row) > 0).map((row) => drawnAs(row.provider)))
  const series = [...DRAWN, OTHERS].filter((provider) => used.has(provider))
  const values = usage.starts.map(() => series.map(() => 0))
  for (const row of usage.rows) {
    const place = series.indexOf(drawnAs(row.provider))
    if (place >= 0 && values[row.at]) values[row.at][place] += amount(row)
  }
  return { series, values, most: Math.max(0, ...values.map((column) => column.reduce((a, b) => a + b, 0))) }
}

/** A round number at or above `most`, close enough to it that the columns fill the chart, and the lines to draw under it: none, half, all. */
export function scale(most: number): number[] {
  if (!(most > 0)) return [0]
  const power = 10 ** Math.floor(Math.log10(most))
  // Each of these halves to a figure that is as short to write.
  const top = [1, 1.2, 1.5, 2, 3, 4, 5, 6, 8, 10].map((n) => n * power).find((n) => n >= most) ?? 10 * power
  return [0, top / 2, top]
}

// ---- in words

const trim = (n: number, digits: number) => n.toFixed(digits).replace(/\.0+$/, '')

/** A count of tokens, short: 950, 12.3K, 4.1M, 2.05B. */
export function tokens(n: number): string {
  if (n < 1000) return String(Math.round(n))
  // Each unit ends where its rounded figure would read 1000.
  if (n < 999_500) return `${trim(n / 1000, n < 99_950 ? 1 : 0)}K`
  if (n < 999_500_000) return `${trim(n / 1e6, n < 99_950_000 ? 1 : 0)}M`
  return `${trim(n / 1e9, 2)}B`
}

/** An amount in US dollars: $0.42, $12.30, $1,204. Anything under a cent, but not nothing, is "<$0.01". */
export function dollars(n: number): string {
  if (n > 0 && n < 0.005) return '<$0.01'
  if (n < 1000) return `$${n.toFixed(2)}`
  return `$${Math.round(n).toLocaleString('en-US')}`
}

/** A figure beside a chart's line, as short as it can be said: "5M", "$2.50", "$40". */
export const lineLabel = (n: number, measure: Measure) => (measure === 'tokens' ? tokens(n) : n >= 1000 ? dollars(n) : `$${trim(n, 2)}`)

/** A cost as a page shows it: the dollars, or a dash when none of it has a price. */
export const costOf = (sum: Sum) => (sum.unpriced > 0 && sum.cost === 0 ? '–' : dollars(sum.cost))

/** A part of a whole, as a percentage: "34%", "<1%". */
export function share(part: number, whole: number): string {
  if (!(whole > 0) || !(part > 0)) return '0%'
  const percent = (part / whole) * 100
  return percent < 1 ? '<1%' : `${Math.round(percent)}%`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A stretch of time by name: "Mon 23 Nov" for a day, "14:00" for an hour (`long` adds its day). */
export function stretch(start: string, step: Usage['step'], long = false): string {
  if (step === 'day') {
    // A date of the server's calendar, shown as that date wherever the app is.
    const [y, m, d] = start.split('-').map(Number)
    return `${long ? `${DAYS[new Date(y, m - 1, d).getDay()]} ` : ''}${d} ${MONTHS[m - 1]}`
  }
  const at = new Date(start)
  const hour = `${String(at.getHours()).padStart(2, '0')}:00`
  return long ? `${DAYS[at.getDay()]} ${hour}` : hour
}

/** When an allowance starts over: "Starts over tomorrow 14:00". Empty when the provider does not say. */
export const startsOver = (resetsAt: number | null, now = Date.now()) => (resetsAt ? (resetsAt > now ? `Starts over ${moment(resetsAt, now)}` : 'Starts over any moment') : '')

const NAMES: Record<string, string> = { codex: 'Codex', 'claude-code': 'Claude Code', grok: 'Grok', local: 'Local models', 'openai-compatible': 'OpenAI-compatible API', [OTHERS]: 'Other' }

/** What a provider is called, also one that is no longer there. */
export const providerName = (id: string, providers: ProviderInfo[]) => providers.find((p) => p.id === id)?.name ?? NAMES[id] ?? id

/** What a model is called: its own name, or for one its provider did not name, that it is the provider's usual one. */
export const modelLabel = (model: string) => (model === 'default' ? 'Default model' : model)

/** What a bot is called, also one that was deleted since. */
export const botName = (id: string, bots: Bot[]) => bots.find((b) => b.id === id)?.name ?? `${id} (deleted)`

/** Why some of what was used has no cost beside it. */
export function unpricedNote(rows: UsageRow[], pricedAt: number | null): string {
  const without = rows.filter((row) => row.cost === null)
  if (!without.length) return ''
  const local = without.every((row) => row.provider === 'local')
  if (local) return 'Models that run on your computer cost nothing by the token, so they have no cost here.'
  if (pricedAt === null) return 'The list of prices could not be fetched, so only what Claude Code itself priced has a cost. It is tried again when you look here later.'
  return 'Some of these models have no cost: they run on your computer, or the price list does not have them.'
}

// ---- fetching

export interface Fetched {
  /** What was used, or null until it first arrives. What was shown stays while newer numbers are fetched. */
  usage: Usage | null
  /** How much of each plan is used, or null until the programs have answered. */
  limits: ProviderLimits[] | null
  error: string
  busy: boolean
  /** Fetches again, and has the providers' programs asked again. */
  refresh: () => void
}

/**
 * What was used over the last `days` days, and how much of each plan is used. Fetched when the
 * page opens, when the range changes, when the connection comes back and when a bot finishes
 * working, which is when there is something new to count.
 */
export function useUsage(days: number): Fetched {
  const connected = useStore((s) => s.connected)
  const working = useStore((s) => s.threads.filter((t) => t.status === 'running').length)
  const [usage, setUsage] = useState<Usage | null>(null)
  const [limits, setLimits] = useState<ProviderLimits[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  /** Counts the requests, so that an answer to one made before the last is dropped. */
  const asked = useRef(0)

  const fetchAll = (fresh: boolean) => {
    const mine = ++asked.current
    setBusy(true)
    const counted = api<Usage>('GET', `/api/usage?days=${days}`).then(
      (answer) => {
        if (mine !== asked.current) return
        setError('')
        setUsage(answer)
      },
      (e: Error) => {
        if (mine !== asked.current) return
        // A server from before usage was counted has no such address.
        setError(e instanceof ApiError && e.status === 404 ? 'The OpenKumi on that computer is an older version, which does not count usage yet. Update it to see it here.' : e.message)
      },
    )
    // The limits take longer (each provider's program is started), and the page does not wait for them.
    const allowed = api<ProviderLimits[]>('GET', `/api/usage/limits${fresh ? '?fresh' : ''}`).then(
      (answer) => mine === asked.current && Array.isArray(answer) && setLimits(answer),
      () => mine === asked.current && setLimits((had) => had ?? []),
    )
    void Promise.all([counted, allowed]).then(() => mine === asked.current && setBusy(false))
  }
  useEffect(() => {
    if (connected) fetchAll(false)
  }, [days, connected, working])

  return { usage, limits, error, busy, refresh: () => fetchAll(true) }
}
