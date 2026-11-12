// Bots are folders under ~/.openbot/bots. bot.md holds what the owner controls (name, description,
// model, rules); the skill links and mcp.json beside it say what the bot may use. Nothing here is
// reachable by the bot's own file tools, which are confined to its workspace.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Bot, Effort } from '@openbot/shared'
import { HOME, botDir, emit, privateDir, readSecrets, workspaceDir, writeSecret } from './config.ts'
import { enabledConnections } from './connections.ts'
import { formatFrontMatter, parseFrontMatter } from './frontmatter.ts'
import { providerInfos } from './providers/index.ts'
import { settings as appSettings, updateSettings } from './settings.ts'
import { installedPlugins } from './plugins.ts'
import { enabledSkills } from './skills.ts'
import { scaffold } from './workspace.ts'

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const EFFORTS = ['', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
/** What a bot runs on when nothing says, and nothing is connected to choose from. */
const FALLBACK = 'codex'
const file = (id: string) => path.join(botDir(id), 'bot.md')

/** Settings as stored in bot.md; the lists of skills and connections are read from their own places. */
type Settings = Omit<Bot, 'skills' | 'connections' | 'plugins'>
export type BotPatch = Partial<Omit<Settings, 'id' | 'createdAt'>>

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
    provider: s.provider,
    model: s.model,
    effort: s.effort,
    web_search: s.webSearch,
    show_browser: !s.headless,
    created: new Date(s.createdAt).toISOString(),
  }
  fs.writeFileSync(file(s.id), formatFrontMatter(front, s.rules))
}

const full = (s: Settings): Bot => ({ ...s, skills: enabledSkills(s.id), connections: enabledConnections(s.id), plugins: installedPlugins(s.id) })

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

/**
 * `purpose` seeds the new bot's own instructions, which it maintains from then on. Without a
 * description, the first sentence of the purpose stands in, for the owner to change.
 */
export async function createBot(input: Record<string, unknown>): Promise<Bot> {
  const patch = clean(input)
  const name = patch.name?.trim()
  if (!name) throw new Error('A bot needs a name')
  const purpose = typeof input.purpose === 'string' ? input.purpose.slice(0, 8000) : ''
  const app = appSettings()
  // What a new bot runs on: the default chosen in Settings, else the first provider that is ready to use.
  const usable = providerInfos().filter((p) => p.connected && p.enabled !== false)
  const provider = usable.find((p) => p.id === app.defaultProvider)?.id ?? usable[0]?.id ?? FALLBACK
  const made: Settings = {
    id: newId(name),
    emoji: '🤖',
    rules: '',
    provider,
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
  return announce(made.id)!
}

export function updateBot(id: string, patch: Record<string, unknown>): Bot {
  const settings = readSettings(id)
  if (!settings) throw new Error(`No bot with id ${id}`)
  const next = { ...settings, ...clean(patch) }
  if (!next.name.trim()) throw new Error('A bot needs a name')
  writeSettings(next)
  return announce(id)!
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
