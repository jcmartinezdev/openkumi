// Webhooks: an app a bot is signed in to calls OpenKumi the moment something happens there, and
// automations of that bot start on the call instead of waiting for a look (automations.ts).
//
// The owner sets one up, once, for one bot and one app: OpenKumi gives it an address nobody can
// guess, the owner enters that in the app, and gives OpenKumi the secret the app signs its calls
// with. How a call is checked and read is the app's own matter, written down in its superpower
// (superpower.json, "hooks").
//
// A call comes from the internet, so it is let in by a door of its own: a port that is open on this
// computer only, for the owner's tunnel to point at, and that takes calls of webhooks and nothing
// else. A call that is not signed with the secret is refused. Of one that is, only what kind of
// event it is and the ids in it are kept and passed on to a run: what people wrote in the app is
// not, so the bot reads the item itself, with its own sign-in, as it would anything else there.
import crypto from 'node:crypto'
import http from 'node:http'
import type { Hook, Trigger } from '@openkumi/shared'
import * as automations from './automations.ts'
import { getBot } from './bots.ts'
import { PORT } from './config.ts'
import * as db from './db.ts'
import { type HookRecipe, enabledSuperpowers, hookRecipe, superpowerName } from './superpowers.ts'

/** The port the calls come in by: on this computer only, for a tunnel from the internet to point at. */
export const HOOKS_PORT = Number(process.env.OPENKUMI_HOOKS_PORT ?? PORT + 1)
const MAX_BODY = 1_000_000
/** How many calls one run is told about. The rest wait for the next. */
const MAX_EVENTS = 50
/** What may be passed on from a call: an id, a number, a date, a short code. Nothing with a space in it, so nothing anyone wrote. */
const PLAIN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,79}$/

type HookOf = Extract<Trigger, { kind: 'hook' }>['hook']

// ---- setting one up

/** The webhooks that are set up, as the apps are sent them. */
export const listHooks = (): Hook[] => db.listHooks().map(db.shown)

/** Sets a webhook up for one of a bot's apps, which gives it its address, or gives it the secret its calls are signed with. */
export function setUp(botId: string, power: string, input: { secret?: unknown }): Hook {
  if (!getBot(botId)) throw new Error(`No bot with id ${botId}.`)
  if (!hookRecipe(power)) throw new Error('That superpower’s app has no webhooks.')
  if (!enabledSuperpowers(botId).includes(power)) throw new Error(`${superpowerName(power)} is not active for this bot.`)
  const secret = typeof input.secret === 'string' ? input.secret.trim() : undefined
  if (secret !== undefined && (secret.length < 8 || secret.length > 500)) throw new Error('That does not look like a signing secret.')
  const hook = db.hookOf(botId, power) ?? { id: `hook_${crypto.randomBytes(18).toString('base64url')}`, botId, power, secret: false, key: null, createdAt: Date.now(), lastCallAt: null, calls: 0, refusedAt: null }
  const saved = db.saveHook(secret === undefined ? hook : { ...hook, key: secret, secret: true, refusedAt: null })
  listen()
  return db.shown(saved)
}

/** Removes a bot's webhook for an app. Its address stops working, and the automations that started on its calls are paused. */
export function remove(botId: string, power: string) {
  const hook = db.hookOf(botId, power)
  if (!hook) return
  db.deleteHook(hook.id)
  automations.unhooked(botId, power)
}

/** Removes a bot's webhooks, when the bot is deleted. */
export function forgetBot(botId: string) {
  for (const hook of db.listHooks()) if (hook.botId === botId) db.deleteHook(hook.id)
}

/** What starts an automation on a webhook, from what was sent, checked: the bot has that webhook, and the app calls about those events. */
export function cleanHook(botId: string, input: any): HookOf {
  const power = String(input?.power ?? '')
  const recipe = hookRecipe(power)
  if (!recipe) throw new Error(`There is no app "${power}" with webhooks.`)
  const app = superpowerName(power)
  if (!db.hookOf(botId, power)) throw new Error(`No webhook is set up for ${app} for this bot. The user sets one up on ${app}’s page, under Superpowers; until then, a watch does the same a few minutes later.`)
  const asked = new Set<string>(Array.isArray(input?.events) ? input.events.map(String) : [])
  const unknown = [...asked].find((id) => !recipe.events.some((e) => e.id === id))
  if (unknown) throw new Error(`${app} does not call about "${unknown}". It calls about: ${recipe.events.map((e) => e.id).join(', ')}.`)
  return { power, app, events: recipe.events.map((e) => e.id).filter((id) => asked.has(id)) }
}

/** The webhooks a bot has, and what each calls about, for the bot to choose from. */
export function availableTo(botId: string) {
  return db
    .listHooks()
    .filter((hook) => hook.botId === botId && hookRecipe(hook.power))
    .map((hook) => ({ app: hook.power, name: superpowerName(hook.power), events: Object.fromEntries(hookRecipe(hook.power)!.events.map((e) => [e.id, e.name])) }))
}

// ---- taking a call

const hash = (body: Buffer) => crypto.createHash('sha256').update(body).digest('hex')

const at = (value: unknown, path: string) => path.split('.').reduce<unknown>((v, key) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[key] : undefined), value)

const plain = (value: unknown): value is string | number | boolean =>
  typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && PLAIN.test(value))

/** Whether a call carries the app's signature: an HMAC-SHA256 of its body, made with the secret. */
function signed(recipe: HookRecipe, key: string, headers: http.IncomingHttpHeaders, body: Buffer): boolean {
  const given = headers[recipe.signature.header.toLowerCase()]
  if (typeof given !== 'string') return false
  const expected = Buffer.from((recipe.signature.prefix ?? '') + crypto.createHmac('sha256', key).update(body).digest(recipe.signature.encoding ?? 'hex'))
  const sent = Buffer.from(given.trim())
  return sent.length === expected.length && crypto.timingSafeEqual(sent, expected)
}

/** What is passed on of a call: the values the app's recipe names that are plain, and the names of the fields that changed. */
function factsOf(recipe: HookRecipe, payload: unknown): db.HookEvent['facts'] {
  const facts: db.HookEvent['facts'] = {}
  for (const path of recipe.pass) {
    const value = at(payload, path)
    if (plain(value)) facts[path.replace(/^data\./, '').replace(/\./g, '_')] = value
  }
  const changed = recipe.changed ? at(payload, recipe.changed) : undefined
  const names = changed && typeof changed === 'object' ? Object.keys(changed).filter((name) => PLAIN.test(name)).slice(0, 20) : []
  if (names.length) facts.changed = names.join('+')
  return facts
}

/** Takes one call, and gives the answer's status. An address nobody set up and a call that is not signed get the same answer. */
function receive(id: string, headers: http.IncomingHttpHeaders, body: Buffer): number {
  const hook = db.getHook(id)
  const recipe = hook && hookRecipe(hook.power)
  if (!hook || !recipe || !hook.key || !signed(recipe, hook.key, headers, body)) {
    // Said in the app, so that a secret that was copied wrong shows; not more than every few seconds, however many come.
    if (hook && Date.now() - (hook.refusedAt ?? 0) > 10_000) db.saveHook({ ...hook, refusedAt: Date.now() })
    return 401
  }
  const called = db.saveHook({ ...hook, lastCallAt: Date.now(), calls: hook.calls + 1 })
  let payload: unknown
  try {
    payload = JSON.parse(body.toString('utf8'))
  } catch {
    return 200
  }
  const event = recipe.events.find((e) => Object.entries(e.when).every(([path, value]) => at(payload, path) === value))
  // A call about something no automation can start on is answered, and left at that. So is one that came before.
  if (event && db.addHookEvent(called.id, hash(body), event.id, factsOf(recipe, payload))) automations.called(called.botId, called.power, event.id)
  return 200
}

let server: http.Server | undefined

/** Opens the door for calls, once there is a webhook to call. It is open on this computer only: the owner's tunnel is what reaches it. */
export function listen() {
  if (server || !db.listHooks().length) return
  const opened = http.createServer((req, res) => {
    const answer = (status: number) => void res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: status === 200 }))
    const id = req.method === 'POST' ? req.url?.match(/^\/hooks\/([\w-]{20,60})(?:\?.*)?$/)?.[1] : undefined
    if (!id) return answer(404)
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_BODY) return void chunks.push(chunk)
      answer(413)
      req.destroy()
    })
    req.on('end', () => {
      try {
        answer(receive(id, req.headers, Buffer.concat(chunks)))
      } catch (e) {
        console.error('A webhook’s call could not be taken:', e)
        answer(500)
      }
    })
    req.on('error', () => {})
  })
  opened.on('error', (e) => {
    console.error(`Webhooks cannot be taken on port ${HOOKS_PORT}: ${e.message}`)
    if (server === opened) server = undefined
  })
  opened.listen(HOOKS_PORT, '127.0.0.1')
  server = opened
}

export function closeHooks() {
  server?.close()
  server = undefined
}

// ---- what a run is told

/** The calls of a bot's webhook that an automation has not been given yet, oldest first, as many as one run is told about. */
export function pending(botId: string, hook: HookOf, after: number): db.HookEvent[] {
  const stored = db.hookOf(botId, hook.power)
  return stored ? db.hookEvents(stored.id, after, hook.events, MAX_EVENTS) : []
}

/**
 * What a run a webhook started is told after the automation's prompt: what the calls were about,
 * by id. Nothing in it was written by anyone in the app. Without `events`, the run was started by hand.
 */
export function note(hook: HookOf, events: db.HookEvent[] | null): string {
  if (!events) return `\n\n<hook_events>\nThis run was started by hand, not by a call from ${hook.app}.\n</hook_events>`
  const names = new Map(hookRecipe(hook.power)?.events.map((e) => [e.id, e.name]))
  const lines = events.map((e) => `- ${names.get(e.event) ?? e.event}: ${Object.entries(e.facts).map(([name, value]) => `${name} ${value}`).join(', ') || 'nothing more is known'}`)
  return `\n\n<hook_events>\nThis run was started because ${hook.app} called about ${events.length === 1 ? 'this' : 'these'}. Only ids are given: read each item with your ${hook.app} tools before you act on it.\n${lines.join('\n')}\n</hook_events>`
}
