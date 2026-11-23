// What models cost at their makers' list prices, so that the usage page can say what the tokens
// the bots used would have cost as API calls. Claude Code says that itself with every turn; for the
// rest (Codex, Grok, an API of your own) the prices come from the public list LiteLLM keeps on
// GitHub. It is fetched only when the usage is asked for, and kept in the data folder: at most once
// a day once it is there, and after a fetch that failed, again no sooner than ten minutes later.
// Nothing is sent for it but the request for the file.
import fs from 'node:fs'
import path from 'node:path'
import { HOME } from './config.ts'

/** Where the list is. Set to nothing, it is never fetched. A test names a stand-in, and without one nothing is fetched under test. */
const ADDRESS = process.env.OPENKUMI_PRICES_URL ?? (process.env.NODE_TEST_CONTEXT ? '' : 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json')
const FILE = path.join(HOME, 'prices.json')
/** How long a list is good for, and how long after a fetch that failed the next one waits. */
const GOOD_FOR = 24 * 60 * 60_000
const AGAIN_AFTER = 10 * 60_000

/** Dollars a token: one sent, one sent that was read from a cache, one written. */
export type Price = [input: number, cached: number, output: number]

interface Kept {
  fetchedAt: number
  prices: Record<string, Price>
}

/** The list at hand: null when there is none, undefined until the file has been looked at. */
let kept: Kept | null | undefined
let fetching: Promise<void> | null = null
let triedAt = 0

function read(): Kept | null {
  try {
    const said = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    return typeof said?.fetchedAt === 'number' && said.prices && typeof said.prices === 'object' ? said : null
  } catch {
    return null
  }
}

/** The models of the list that are paid for by the token, by name in small letters. The rest of what it says of each is left out. */
export function parse(document: unknown): Record<string, Price> {
  const prices: Record<string, Price> = {}
  if (!document || typeof document !== 'object') return prices
  const price = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null)
  for (const [name, entry] of Object.entries(document as Record<string, any>)) {
    const input = price(entry?.input_cost_per_token)
    const output = price(entry?.output_cost_per_token)
    // Pictures, speech and the like are priced another way.
    if (input === null || output === null || (entry.mode && !['chat', 'responses', 'completion'].includes(entry.mode))) continue
    // A model with no price of its own for what it reads from a cache charges it as anything else it is sent.
    prices[name.toLowerCase()] = [input, price(entry.cache_read_input_token_cost) ?? input, output]
  }
  return prices
}

async function fetchList() {
  triedAt = Date.now()
  const res = await fetch(ADDRESS, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`The price list answered ${res.status}.`)
  const prices = parse(await res.json())
  if (!Object.keys(prices).length) throw new Error('The price list has no prices in it.')
  kept = { fetchedAt: Date.now(), prices }
  // Written beside its place and moved there, so a server stopped half-way leaves the old one whole.
  fs.writeFileSync(`${FILE}.new`, JSON.stringify(kept), { mode: 0o600 })
  fs.renameSync(`${FILE}.new`, FILE)
}

/**
 * Has the list at hand, as far as it can be had: it is fetched when there is none or the one
 * there is more than a day old. With none at all it is waited for, for a moment; an old one is
 * used while the new one comes. A server that cannot reach it goes without.
 */
export async function ready(wait = 4000) {
  if (kept === undefined) kept = read()
  const due = !kept || Date.now() - kept.fetchedAt > GOOD_FOR
  if (ADDRESS && due && Date.now() - triedAt > AGAIN_AFTER) fetching ??= fetchList().catch(() => {}).finally(() => (fetching = null))
  if (!kept && fetching) await Promise.race([fetching, new Promise((resolve) => setTimeout(resolve, wait).unref())])
}

/** When the list at hand was fetched, or null when there is none. */
export const pricedAt = () => kept?.fetchedAt ?? null

/** What a model costs, by the first of these names the list has, or null when it has none of them. */
export function priceOf(names: string[]): Price | null {
  for (const name of names) {
    const price = kept?.prices[name.toLowerCase()]
    if (price) return price
  }
  return null
}
