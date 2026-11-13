import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { ServerEvent } from '@openkumi/shared'

/** Where the data was kept while OpenKumi was called Open Bot. */
const BEFORE = path.join(os.homedir(), '.openbot')
export const HOME = process.env.OPENKUMI_HOME ?? home()
export const PORT = Number(process.env.OPENKUMI_PORT ?? 4317)
export const ROOT = path.resolve(import.meta.dirname, '..')
/** Started with --lan: serve other devices on the local network whatever the setting says. */
export const LAN = process.argv.includes('--lan') || process.env.OPENKUMI_LAN === '1'

/** The database, in HOME. */
export const DATABASE = path.join(HOME, HOME === BEFORE ? 'openbot.db' : 'openkumi.db')

fs.mkdirSync(path.join(HOME, 'bots'), { recursive: true })

/**
 * OpenKumi was called Open Bot, and kept its data in ~/.openbot. That folder becomes ~/.openkumi
 * the first time OpenKumi starts, unless a server from before is still using it: then it is used
 * where it is until a start after that server has stopped.
 */
function home() {
  const home = path.join(os.homedir(), '.openkumi')
  if (fs.existsSync(home) || !fs.existsSync(BEFORE)) return home
  // A server has its database open (or was stopped without closing it) while this file is there.
  if (fs.existsSync(path.join(BEFORE, 'openbot.db-wal'))) return BEFORE
  fs.renameSync(BEFORE, home)
  if (fs.existsSync(path.join(home, 'openbot.db'))) fs.renameSync(path.join(home, 'openbot.db'), path.join(home, 'openkumi.db'))
  return home
}

// A bot is a folder. Its owner's settings sit at the top; the bot can only reach `workspace`.
//   bots/<id>/bot.md             name, model and rules
//   bots/<id>/superpowers.json   the superpowers switched on for it
//   bots/<id>/workspace/         the bot's own: AGENTS.md, memory/, files/
//   bots/<id>/private/           browser profile and its accounts with services, never visible to the bot
export const botDir = (botId: string) => path.join(HOME, 'bots', botId)
export const workspaceDir = (botId: string) => path.join(botDir(botId), 'workspace')
export const privateDir = (botId: string) => path.join(botDir(botId), 'private')

/** HOME as the user would type it, for messages and the UI. */
export const HOME_LABEL = HOME.startsWith(os.homedir() + path.sep) ? '~' + HOME.slice(os.homedir().length) : HOME

// Everything the UI needs to hear about goes through this bus; http.ts fans it out over WebSocket.
const bus = new EventEmitter()
bus.setMaxListeners(0)

export function emit(event: ServerEvent) {
  bus.emit('event', event)
}

export function onEvent(fn: (event: ServerEvent) => void) {
  bus.on('event', fn)
  return () => bus.off('event', fn)
}

// Secrets (OAuth tokens, API keys) live in one owner-only JSON file, outside the database.
const SECRETS = path.join(HOME, 'auth.json')

export function readSecrets(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(SECRETS, 'utf8'))
  } catch {
    return {}
  }
}

export function writeSecret(key: string, value: unknown) {
  const all = readSecrets()
  if (value === null) delete all[key]
  else all[key] = value
  fs.writeFileSync(SECRETS, JSON.stringify(all, null, 2), { mode: 0o600 })
  fs.chmodSync(SECRETS, 0o600)
}

/** The secret other devices must present. Created on first use and kept across restarts. */
export function accessToken(): string {
  return readSecrets().accessToken ?? resetAccessToken()
}

let id: string | undefined
/**
 * This server's own id, the same across restarts and whatever address it is reached at, so a
 * device paired with it can tell it from another server answering at one of its addresses.
 */
export function serverId(): string {
  id ??= readSecrets().serverId
  if (!id) writeSecret('serverId', (id = `s_${crypto.randomBytes(9).toString('base64url')}`))
  return id
}

/** Replaces the secret, which signs out every device that was using the old one. */
export function resetAccessToken(): string {
  const token = crypto.randomBytes(18).toString('base64url')
  writeSecret('accessToken', token)
  return token
}
