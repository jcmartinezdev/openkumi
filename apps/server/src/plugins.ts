// Plugins: ready-made abilities for a bot, such as "Gmail". A plugin is a folder that ships with
// Open Bot (apps/server/plugins/<id>) holding a description, the skills the bot needs and, for
// most, the connection to the service. Installing one is done for a single bot: its skills are
// switched on for that bot and its connection is switched on for that bot, and nothing else is
// touched. Like skills and connections, plugins are the owner's to install; a bot cannot.
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from '@openbot/shared'
import { HOME, ROOT, botDir, readSecrets, writeSecret } from './config.ts'
import { enabledConnections, logout, putConnection, removeConnection, setConnection } from './connections.ts'
import { enabledSkills, setSkill } from './skills.ts'

interface Manifest {
  name: string
  icon: string
  color: string
  category: string
  publisher: string
  tagline: string
  /** What a bot with the plugin is able to do, in plain words. */
  can: string[]
  skills: string[]
  connection?: { name: string; url: string; scopes?: string[] }
  /** Where the service is on the web, for a bot that reaches it through its browser. */
  site?: string
  /** Something the owner has to provide once before the connection can be used, shared by the plugins that name the same id. */
  setup?: { id: string; title: string; fields: { key: string; label: string; secret?: boolean }[] }
}

export const PLUGINS = path.join(ROOT, 'plugins')
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/

function manifest(id: string): Manifest | null {
  if (!ID.test(id)) return null
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGINS, id, 'plugin.json'), 'utf8'))
  } catch {
    return null
  }
}
const ids = () => (fs.existsSync(PLUGINS) ? fs.readdirSync(PLUGINS).filter((id) => manifest(id)).sort() : [])

/** What the owner has provided for each setup, by setup id. Kept with the other secrets. */
const provided = (): Record<string, Record<string, string>> => readSecrets().plugins ?? {}
const isSetUp = (m: Manifest) => !m.setup || m.setup.fields.every((f) => !!provided()[m.setup!.id]?.[f.key])

// ---- which plugins a bot has

const botFile = (botId: string) => path.join(botDir(botId), 'plugins.json')

export function installedPlugins(botId: string): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(botFile(botId), 'utf8')).installed
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string' && !!manifest(id)).sort() : []
  } catch {
    return []
  }
}
const record = (botId: string, list: string[]) => fs.writeFileSync(botFile(botId), JSON.stringify({ installed: [...new Set(list)].sort() }, null, 2) + '\n')
const botsWith = (id: string) => fs.readdirSync(path.join(HOME, 'bots')).filter((botId) => installedPlugins(botId).includes(id))

export function listPlugins(): Plugin[] {
  return ids().map((id) => {
    const m = manifest(id)!
    let description = ''
    try {
      description = fs.readFileSync(path.join(PLUGINS, id, 'README.md'), 'utf8')
    } catch {
      // A plugin without a page of its own still has its tagline.
    }
    const given = m.setup ? (provided()[m.setup.id] ?? {}) : {}
    return {
      id,
      name: m.name,
      icon: m.icon,
      color: m.color,
      category: m.category,
      publisher: m.publisher,
      tagline: m.tagline,
      description,
      can: m.can,
      skills: m.skills,
      connection: m.connection ? { name: m.connection.name, host: new URL(m.connection.url).host } : null,
      site: m.site ?? '',
      // A secret that was provided is only ever reported as being there.
      setup: m.setup ? { ...m.setup, done: isSetUp(m), values: Object.fromEntries(m.setup.fields.map((f) => [f.key, f.secret ? (given[f.key] ? '••••••••' : '') : (given[f.key] ?? '')])) } : null,
      installedOn: botsWith(id),
    }
  })
}

/** Puts the plugin's connection in the catalog as it should be now, with what the owner provided for it. */
function writeConnection(m: Manifest) {
  if (!m.connection) return
  const given = m.setup ? provided()[m.setup.id] : undefined
  putConnection(m.connection.name, {
    url: m.connection.url,
    ...(m.setup && given ? { oauth: { clientId: given.clientId, clientSecret: given.clientSecret, scope: m.connection.scopes?.join(' ') } } : {}),
  })
}

/** Switches the plugin's connection on for a bot, when there is one and it can be used yet. */
async function connect(botId: string, m: Manifest) {
  if (!m.connection || !isSetUp(m)) return
  writeConnection(m)
  if (!enabledConnections(botId).includes(m.connection.name)) await setConnection(botId, m.connection.name, true)
}

export async function installPlugin(botId: string, id: string) {
  const m = manifest(id)
  if (!m) throw new Error('No such plugin')
  for (const skill of m.skills) setSkill(botId, skill, true)
  await connect(botId, m)
  record(botId, [...installedPlugins(botId), id])
}

export async function removePlugin(botId: string, id: string) {
  const m = manifest(id)
  if (!m) throw new Error('No such plugin')
  const rest = installedPlugins(botId).filter((other) => other !== id)
  // A skill another of the bot's plugins also brings stays.
  const kept = new Set(rest.flatMap((other) => manifest(other)!.skills))
  for (const skill of m.skills) if (!kept.has(skill) && enabledSkills(botId).includes(skill)) setSkill(botId, skill, false)
  if (m.connection && enabledConnections(botId).includes(m.connection.name)) {
    // The bot's account with the service goes with it.
    await logout(botId, m.connection.name).catch(() => {})
    await setConnection(botId, m.connection.name, false)
  }
  record(botId, rest)
  // A connection that only this plugin brought, and that no bot has any more, leaves the catalog too.
  if (m.connection && !botsWith(id).length) await removeConnection(m.connection.name).catch(() => {})
}

/** Saves what the owner provides for a setup (such as a Google Cloud client), then brings the connections that were waiting for it to life. */
export async function saveSetup(setupId: string, values: Record<string, unknown>): Promise<string[]> {
  const waiting = ids().map((id) => [id, manifest(id)!] as const).filter(([, m]) => m.setup?.id === setupId)
  if (!waiting.length) throw new Error('No plugin asks for that.')
  const fields = waiting[0][1].setup!.fields
  const before = provided()[setupId] ?? {}
  // An empty secret keeps the one already saved, so the other field can be corrected without retyping it.
  const next = Object.fromEntries(fields.map((f) => [f.key, String(values[f.key] ?? '').trim() || (f.secret ? (before[f.key] ?? '') : '')]))
  writeSecret('plugins', { ...provided(), [setupId]: next })
  const affected = new Set<string>()
  for (const [id, m] of waiting) {
    // Bots that were waiting get the connection; ones that had it are given the new client, and sign in again with it.
    for (const botId of botsWith(id)) {
      await connect(botId, m)
      affected.add(botId)
    }
  }
  return [...affected]
}
