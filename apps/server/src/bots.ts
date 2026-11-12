// Bots are folders under ~/.openbot/bots. bot.md holds what the owner controls (name, description,
// model, rules); superpowers.json beside it says what more the bot may do. Nothing here is
// reachable by the bot's own file tools, which are confined to its workspace.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Bot, Effort, Look } from '@openbot/shared'
import { HOME, botDir, emit, privateDir, readSecrets, workspaceDir, writeSecret } from './config.ts'
import { formatFrontMatter, parseFrontMatter } from './frontmatter.ts'
import { CHOOSE_LOOK, cleanLook, lookFrom, lookQuestion, readChoice, readLook, writeLook } from './look.ts'
import { askOnce, getProvider, providerInfos } from './providers/index.ts'
import { settings as appSettings, updateSettings } from './settings.ts'
import { enabledSuperpowers } from './superpowers.ts'
import { scaffold } from './workspace.ts'

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const EFFORTS = ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
/** What a bot runs on when nothing says, and nothing is connected to choose from. */
const FALLBACK = 'codex'
const file = (id: string) => path.join(botDir(id), 'bot.md')

/** Settings as stored in bot.md; the list of superpowers is read from its own file. */
type Settings = Omit<Bot, 'superpowers' | 'choosingLook'>
/** A look can be changed a part at a time. */
export type BotPatch = Partial<Omit<Settings, 'id' | 'createdAt' | 'look'>> & { look?: Partial<Look> }

function readSettings(id: string): Settings | undefined {
  if (!ID.test(id)) return
  let text: string
  try {
    text = fs.readFileSync(file(id), 'utf8')
  } catch {
    return
  }
  // The file may have been edited by hand, so every field falls back to a default.
  const { data, body } = parseFrontMatter(text)
  const flag = (value: string | undefined, fallback: boolean) => (value === undefined ? fallback : /^(true|yes|on|1)$/i.test(value))
  return {
    id,
    name: data.name || id,
    emoji: data.emoji || '🤖',
    description: oneLine(data.description ?? ''),
    look: readLook(data.look, id),
    rules: body.trim(),
    provider: data.provider || FALLBACK,
    model: data.model ?? '',
    effort: (EFFORTS.includes(data.effort) ? data.effort : '') as Effort,
    webSearch: flag(data.web_search, true),
    headless: !flag(data.show_browser, false),
    createdAt: Date.parse(data.created) || fs.statSync(file(id)).birthtimeMs,
  }
}

function writeSettings(s: Settings) {
  fs.mkdirSync(botDir(s.id), { recursive: true })
  const front = {
    name: s.name,
    emoji: s.emoji,
    description: s.description,
    look: writeLook(s.look),
    provider: s.provider,
    model: s.model,
    effort: s.effort,
    web_search: s.webSearch,
    show_browser: !s.headless,
    created: new Date(s.createdAt).toISOString(),
  }
  fs.writeFileSync(file(s.id), formatFrontMatter(front, s.rules))
}

/** Bots whose model is choosing their look right now. */
const choosing = new Set<string>()

const full = (s: Settings): Bot => ({
  ...s,
  superpowers: enabledSuperpowers(s.id),
  ...(choosing.has(s.id) ? { choosingLook: true } : {}),
})

export function getBot(id: string): Bot | undefined {
  const settings = readSettings(id)
  return settings && full(settings)
}

export function listBots(): Bot[] {
  return fs
    .readdirSync(path.join(HOME, 'bots'))
    .map(getBot)
    .filter((b): b is Bot => !!b)
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** Tells the UI about a bot again, after something about it changed. */
export function announce(id: string) {
  const bot = getBot(id)
  if (bot) emit({ type: 'bot.upsert', bot })
  return bot
}

/** Every other bot is told a bot's description, so it is kept to one short line. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 200)

/** A description from what a new bot is for: its first sentence, when nothing else was given. */
function describe(purpose: string): string {
  const line = oneLine(purpose)
  const sentence = line.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? line
  return sentence.length <= 200 ? sentence : line.slice(0, 199) + '…'
}

function clean(patch: Record<string, unknown>): BotPatch {
  const out: Record<string, unknown> = {}
  const str = (k: keyof BotPatch, max: number) => {
    if (typeof patch[k] === 'string') out[k] = (patch[k] as string).slice(0, max)
  }
  str('name', 80)
  str('emoji', 8)
  if (typeof patch.description === 'string') out.description = oneLine(patch.description)
  str('rules', 8000)
  str('provider', 40)
  str('model', 100)
  if (EFFORTS.includes(patch.effort as string)) out.effort = patch.effort
  if (typeof patch.webSearch === 'boolean') out.webSearch = patch.webSearch
  if (typeof patch.headless === 'boolean') out.headless = patch.headless
  const look = cleanLook(patch.look)
  if (Object.keys(look).length) out.look = look
  return out
}

/** A readable folder name from the bot's name, e.g. "Trip Planner" -> "trip-planner". */
function newId(name: string): string {
  const slug = name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  if (!slug) return `bot-${crypto.randomBytes(4).toString('hex')}`
  for (let n = 1; ; n++) {
    const id = n === 1 ? slug : `${slug}-${n}`
    // "settings" and "tasks" are pages of the app, so no bot may have those addresses.
    if (id !== 'settings' && id !== 'tasks' && !fs.existsSync(botDir(id))) return id
  }
}

/** What a new bot runs on: the default chosen in Settings, else the first provider that is ready to use. */
function newBotProvider(): string {
  const app = appSettings()
  const usable = providerInfos().filter((p) => p.connected && p.enabled !== false)
  return usable.find((p) => p.id === app.defaultProvider)?.id ?? usable[0]?.id ?? FALLBACK
}

/**
 * `purpose` seeds the new bot's own instructions, which it maintains from then on. Without a
 * description, the first sentence of the purpose stands in, for the owner to change. A bot made
 * without a look gets one from its own model, which chooses from its name and purpose once it
 * exists (and the emoji on its sign too, when none was given).
 */
export async function createBot(input: Record<string, unknown>): Promise<Bot> {
  const { look, ...patch } = clean(input)
  const name = patch.name?.trim()
  if (!name) throw new Error('A bot needs a name')
  const purpose = typeof input.purpose === 'string' ? input.purpose.slice(0, 8000) : ''
  const app = appSettings()
  const id = newId(name)
  const made: Settings = {
    id,
    emoji: '🤖',
    look: { ...lookFrom(id), ...look },
    rules: '',
    provider: newBotProvider(),
    model: '',
    effort: '',
    webSearch: app.defaultWebSearch,
    headless: !app.defaultShowBrowser,
    createdAt: Date.now(),
    ...patch,
    name,
    description: patch.description || describe(purpose),
  }
  writeSettings(made)
  fs.mkdirSync(privateDir(made.id), { recursive: true })
  await scaffold(made.id, name, purpose)
  if (!look) void dress(id, purpose, !patch.emoji)
  return announce(made.id)!
}

export function updateBot(id: string, patch: Record<string, unknown>): Bot {
  const settings = readSettings(id)
  if (!settings) throw new Error(`No bot with id ${id}`)
  const { look, ...rest } = clean(patch)
  const next = { ...settings, ...rest, look: { ...settings.look, ...look } }
  if (!next.name.trim()) throw new Error('A bot needs a name')
  writeSettings(next)
  return announce(id)!
}

/** Has a model choose a look and an emoji for a bot of this name and purpose. Null when its answer was no use. */
async function chooseLook(providerId: string, model: string, name: string, purpose: string, signal: AbortSignal) {
  const provider = getProvider(providerId)
  if (!provider.info().connected) throw new Error(`${provider.info().name} is not connected, so it cannot choose a look.`)
  return readChoice(await askOnce(provider, { model, instructions: CHOOSE_LOOK, text: lookQuestion(name, purpose), signal }))
}

/** A new bot's model chooses its look. Whatever the owner changes meanwhile is kept, and a failure leaves the look it was made with. */
async function dress(id: string, purpose: string, emoji: boolean) {
  const before = getBot(id)
  if (!before) return
  choosing.add(id)
  announce(id)
  try {
    const choice = await chooseLook(before.provider, before.model, before.name, purpose, AbortSignal.timeout(120_000))
    const now = readSettings(id)
    if (!choice || !now) return
    updateBot(id, {
      ...(writeLook(now.look) === writeLook(before.look) ? { look: choice.look } : {}),
      ...(emoji && now.emoji === before.emoji ? { emoji: choice.emoji } : {}),
    })
  } catch {
    // The look it was made with is a fine look.
  } finally {
    choosing.delete(id)
    announce(id)
  }
}

/**
 * "Pick for me": a look chosen by a bot's own model, from its name and what it is for (its rules and
 * its own instructions). Before a bot exists, by the model a new bot would run on. Nothing is saved.
 */
export async function pickLook(input: Record<string, unknown>): Promise<{ look: Look; emoji: string }> {
  const bot = typeof input.botId === 'string' ? getBot(input.botId) : undefined
  if (input.botId !== undefined && !bot) throw new Error(`No bot with id ${input.botId}`)
  const name = (typeof input.name === 'string' && input.name.trim()) || bot?.name || 'A new bot'
  let purpose = typeof input.purpose === 'string' ? input.purpose : ''
  if (bot && !purpose.trim()) {
    let own = ''
    try {
      own = fs.readFileSync(path.join(workspaceDir(bot.id), 'AGENTS.md'), 'utf8')
    } catch {}
    purpose = [bot.description, bot.rules, own.slice(0, 3000)].filter(Boolean).join('\n\n')
  }
  const choice = await chooseLook(bot?.provider ?? newBotProvider(), bot?.model ?? '', name, purpose, AbortSignal.timeout(120_000))
  if (!choice) throw new Error('The model did not come up with a look. Try again, or choose one yourself.')
  return choice
}

export function deleteBot(id: string) {
  if (!readSettings(id)) return
  fs.rmSync(botDir(id), { recursive: true, force: true })
  emit({ type: 'bot.delete', id })
}

/**
 * Open Bot once had its own ChatGPT sign-in. Bots that ran on it now run on Codex, which uses
 * the same ChatGPT account through OpenAI's own program; the model each bot had chosen is kept.
 */
export function moveOffChatGPTSignIn() {
  for (const bot of listBots()) if (bot.provider === 'chatgpt') updateBot(bot.id, { provider: 'codex' })
  const app = appSettings()
  if (app.defaultProvider === 'chatgpt' || app.disabledProviders.includes('chatgpt')) {
    updateSettings({
      defaultProvider: app.defaultProvider === 'chatgpt' ? '' : app.defaultProvider,
      disabledProviders: app.disabledProviders.filter((id) => id !== 'chatgpt'),
    })
  }
  // The sign-in it kept is of no use to anything now.
  if (readSecrets().chatgpt) writeSecret('chatgpt', null)
}

/**
 * Bots used to be rows in the database, with a browser profile at the top of their folder.
 * This writes each one out as a folder in the current layout, keeping its id and its logins.
 */
export async function importLegacyBots(rows: Record<string, any>[]) {
  for (const r of rows) {
    const id = String(r.id)
    if (!ID.test(id) || fs.existsSync(file(id))) continue
    const profile = path.join(botDir(id), 'browser-profile')
    if (fs.existsSync(profile)) {
      fs.mkdirSync(privateDir(id), { recursive: true })
      fs.renameSync(profile, path.join(privateDir(id), 'browser-profile'))
    }
    const memory = String(r.memory ?? '').trim()
    if (memory) {
      fs.mkdirSync(path.join(workspaceDir(id), 'memory'), { recursive: true })
      fs.writeFileSync(path.join(workspaceDir(id), 'memory', 'notes.md'), `# Notes from earlier conversations\n\n${memory}\n`)
    }
    await scaffold(id, String(r.name), String(r.instructions ?? ''))
    // Written last: its presence is what marks the bot as imported.
    writeSettings({
      id,
      name: String(r.name),
      emoji: String(r.emoji || '🤖'),
      description: '',
      look: lookFrom(id),
      rules: '',
      provider: String(r.provider || FALLBACK),
      model: String(r.model ?? ''),
      effort: (EFFORTS.includes(r.effort) ? r.effort : '') as Effort,
      webSearch: !!r.web_search,
      headless: !!r.headless,
      createdAt: Number(r.created_at) || Date.now(),
    })
  }
}
