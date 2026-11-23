// What the bots' models used, for the apps' usage pages: how many tokens by provider, model and
// bot, what they would have cost as API calls, and how much of each plan is used up.
//
// Tokens are counted here as each provider reports them when a model has answered (agent.ts), and
// kept by the hour in this server's own database: nothing is read from the engines' own records,
// so what is shown is what the bots used and not what else was done with the same account.
// A cost is what the program that ran the model said (Claude Code does, at list prices), or else
// the tokens at the prices of a public list (prices.ts). A model on this computer has none.
// Not counted: what a voice call uses, and the one question that chooses a new bot's look.
import type { ProviderLimits, Usage, UsageRow } from '@openkumi/shared'
import * as db from './db.ts'
import * as prices from './prices.ts'
import { getProvider, providerInfos, providersLooked } from './providers/index.ts'
import { failed } from './telemetry.ts'

const HOUR = 60 * 60_000
/** The time zone the days are days of: this computer's, as for automations. */
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

const whole = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0)

/**
 * Counts what a model just used for a bot. `model` is the name the provider has for it; one it did
 * not name is counted as "default". `cost` is given when the program that ran it said one.
 */
export function count(botId: string, provider: string, used: { model: string; input: number; cached: number; output: number; cost?: number }, at = Date.now()) {
  const input = whole(used.input)
  const output = whole(used.output)
  if (!input && !output) return
  try {
    db.addUsage({ botId, provider, model: used.model || 'default', costed: used.cost !== undefined, input, cached: Math.min(input, whole(used.cached)), output, cost: used.cost ?? 0 }, at)
  } catch (e) {
    // A count that could not be written must not stop the bot's turn.
    failed(e, 'background')
  }
}

/** The makers whose own models the price list has under their name ("xai/grok-4"). */
const MAKERS = ['xai', 'gemini', 'mistral', 'deepseek']

/** The names a model may have in the price list, the likeliest first. */
function names(provider: string, model: string): string[] {
  const last = model.split('/').pop()!
  return [
    ...(provider === 'grok' ? [`xai/${model}`] : []),
    model,
    // Through a service that passes requests on, a model is named with its maker ("anthropic/claude-opus-5.5").
    ...(model.includes('/') ? [`openrouter/${model}`, last, last.replace(/\./g, '-')] : []),
    ...MAKERS.map((maker) => `${maker}/${last}`),
  ]
}

/** What these tokens cost at the list's price for the model, or null when there is none: it runs on this computer, or the list does not have it. */
function priced(used: db.Used): number | null {
  if (used.provider === 'local') return null
  const price = prices.priceOf(names(used.provider, used.model))
  return price && (used.input - used.cached) * price[0] + used.cached * price[1] + used.output * price[2]
}

const dayOf = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
/** The date on this computer's calendar at a moment, as "2026-11-23". */
const day = (time: number) => dayOf.format(time)

/**
 * What was used over the last `days` days, today included, by the day; over one day, the last 24
 * hours by the hour. Hours are counted on the clock's whole hours, so in a time zone that is half
 * an hour off them, a day's count runs half an hour into the next.
 */
export async function usage(days: number, now = Date.now()): Promise<Usage> {
  await prices.ready()
  const step = days <= 1 ? 'hour' : 'day'
  let starts: string[]
  let from: number
  let place: (hour: number) => number
  if (step === 'hour') {
    from = Math.floor(now / HOUR) * HOUR - 23 * HOUR
    starts = Array.from({ length: 24 }, (_, i) => new Date(from + i * HOUR).toISOString())
    place = (hour) => (hour - from) / HOUR
  } else {
    const [y, m, d] = day(now).split('-').map(Number)
    // Dates are stepped through on the calendar, not by 24 hours, which a change of the clocks would throw off.
    starts = Array.from({ length: days }, (_, i) => new Date(Date.UTC(y, m - 1, d - (days - 1 - i))).toISOString().slice(0, 10))
    const places = new Map(starts.map((date, i) => [date, i]))
    // A day can be 25 hours long; what is read from before the first one is left out below.
    from = now - (days + 1) * 24 * HOUR
    place = (hour) => places.get(day(hour)) ?? -1
  }
  const rows = new Map<string, UsageRow>()
  for (const used of db.usageSince(from)) {
    const at = place(used.hour)
    if (at < 0 || at >= starts.length) continue
    const key = [at, used.botId, used.provider, used.model].join('\n')
    const row = rows.get(key) ?? { at, botId: used.botId, provider: used.provider, model: used.model, input: 0, cached: 0, output: 0, cost: 0 }
    row.input += used.input
    row.cached += used.cached
    row.output += used.output
    const cost = used.costed ? used.cost : priced(used)
    // One part without a price leaves the whole without one: a sum of the rest would pass for all of it.
    row.cost = row.cost === null || cost === null ? null : row.cost + cost
    rows.set(key, row)
  }
  return { step, starts, rows: [...rows.values()], since: db.firstUsage(), pricedAt: prices.pricedAt() }
}

// ---- how much of each plan is used

/** How long an answer is good for: asking starts each provider's program. */
const GOOD_FOR = 60_000
let asked: { at: number; answer: Promise<ProviderLimits[]> } | null = null

/**
 * The limits of the plan of each provider that can say (Claude Code and Codex, signed in and
 * switched on), asked of its own program. Each is asked at most once a minute, unless `fresh`.
 */
export function limits(fresh = false): Promise<ProviderLimits[]> {
  if (asked && !fresh && Date.now() - asked.at < GOOD_FOR) return asked.answer
  // Asked as the server starts, the providers may not have been looked at yet, and none would seem connected.
  const answer = providersLooked()
    .catch(() => {})
    .then(() =>
      Promise.all(
        providerInfos()
          .filter((info) => info.connected && info.enabled !== false && getProvider(info.id).limits)
          .map(async (info): Promise<ProviderLimits> => {
            const said = await getProvider(info.id).limits!().catch((e: Error) => ({ plan: '', limits: [], note: String(e?.message ?? e) }))
            return { provider: info.id, ...said, checkedAt: Date.now() }
          }),
      ),
    )
  asked = { at: Date.now(), answer }
  return answer
}
