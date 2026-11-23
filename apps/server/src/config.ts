import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { DatabaseSync } from 'node:sqlite'
import type { ServerEvent } from '@openkumi/shared'

/**
 * The format the data is kept in: each person's database, and the settings and bots' folders
 * beside it. The number is written into the database (db.ts). A version of OpenKumi that finds a
 * higher one than its own was started on data a newer version has written, which it would misread,
 * so it leaves everything as it is and says so.
 *
 * Raise it with any change an older version cannot work with (a column that comes to mean
 * something else, a file that moves). A new table, or a new column that older versions can
 * ignore, needs no new number.
 *
 * 2: each person has a folder of their own under people/, where the data used to lie in the
 *    folder itself. What is brought up to it is moved there by `moveIn` below.
 */
export const FORMAT = 2

/** Where the data was kept while OpenKumi was called Open Bot. */
const BEFORE = path.join(os.homedir(), '.openbot')
/**
 * The folder OpenKumi keeps everything in on this computer. Bots belong to a person, and each
 * person here has a server of their own with a folder of its own in it (people.ts):
 *   people.json         who they are, and the port each one's server listens on
 *   people/<name>/      that person's data folder: bots, conversations, settings, keys
 *   openkumi.db         a note for versions from before people had folders (`leaveNote`)
 *   runtime/            the program, when it was installed on its own
 * Most computers have one person, made the first time OpenKumi starts.
 */
// A test says where its data is. One that forgot would be using the folder of whoever runs it.
if (process.env.NODE_TEST_CONTEXT && !process.env.OPENKUMI_HOME) throw new Error('A test has to set OPENKUMI_HOME before the server’s modules are loaded: without it they use the real data folder.')
export const BASE = process.env.OPENKUMI_HOME ?? home()

/** Someone with bots on this computer: the name they go by here, and the port their server listens on. */
export interface Person {
  name: string
  port: number
}
/** A name is part of a folder's and of a service's name, and typed after `--for`. */
export const NAME = /^[a-z0-9][a-z0-9-]{0,29}$/
const PEOPLE = path.join(BASE, 'people.json')

/** The people here, the first one first: that is the one meant when no name is given. */
export function people(): Person[] {
  try {
    const said = JSON.parse(fs.readFileSync(PEOPLE, 'utf8'))
    return Array.isArray(said) ? said.filter((p) => NAME.test(p?.name) && Number.isInteger(p?.port)) : []
  } catch {
    return []
  }
}

export function savePeople(list: Person[]) {
  fs.mkdirSync(BASE, { recursive: true })
  fs.writeFileSync(PEOPLE, JSON.stringify(list, null, 2) + '\n')
}

/** Where a person's server keeps its data. */
export const homeOf = (person: string) => path.join(BASE, 'people', person)

/** A name made to fit: small letters, digits and dashes, a letter with an accent as the letter ("José" is jose). '' when nothing of it is left. */
export const fitted = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '')
/** A person's name as it is shown: "juan-cruz" is Juan Cruz. */
export const shown = (name: string) => name.split('-').filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')

/**
 * The first person here, made when there is none: whoever uses this computer, under the name
 * they gave where they were asked (OPENKUMI_NAME, from the desktop app's welcome), or else the
 * name their account on the computer has. What OpenKumi kept here before each person had a folder
 * becomes theirs.
 */
async function first(): Promise<Person> {
  let name = fitted(process.env.OPENKUMI_NAME ?? '')
  try {
    name ||= fitted(os.userInfo().username)
  } catch {
    // An account without a name.
  }
  const person = { name: NAME.test(name) ? name : 'me', port: 4317 }
  await moveIn(homeOf(person.name))
  savePeople([person])
  return person
}

/**
 * Before each person had a folder of their own, the data lay in the folder itself: bots/,
 * the database and the rest. All of it is moved into the first person's folder, once. Not from
 * under a server of that time that is still running: this stops then, and says so.
 */
async function moveIn(to: string) {
  const here = new Set(['people', 'people.json', 'runtime'])
  // (The database in the folder itself is the data from before here: the note below is only left after this.)
  let found: string[] = []
  try {
    found = fs.readdirSync(BASE).filter((name) => !here.has(name) && path.join(BASE, name) !== process.env.OPENKUMI_RUNTIME)
  } catch {
    // No folder yet.
  }
  if (!found.some((name) => name === 'bots' || /^open(kumi|bot)\.db$/.test(name))) return
  const port = Number(process.env.OPENKUMI_PORT ?? 4317)
  // A server tells callers on its own computer where its data is.
  const served = await fetch(`http://127.0.0.1:${port}/api/hello`, { signal: AbortSignal.timeout(2000) }).then((res) => res.json()).then((said) => said?.home, () => null)
  if (served === BASE) {
    console.error(`\n  An OpenKumi server from before this version is running on this computer (port ${port}).\n  Its data moves into a folder of its own, which cannot be done while it runs: stop it, then do this again.\n`)
    process.exit(1)
  }
  fs.mkdirSync(to, { recursive: true })
  for (const name of found) {
    // The database kept its name from when OpenKumi was called Open Bot while its folder was used where it was.
    const as = name.replace(/^openbot\.db/, 'openkumi.db')
    try {
      if (!fs.existsSync(path.join(to, as))) fs.renameSync(path.join(BASE, name), path.join(to, as))
    } catch {
      // Moved by another start of OpenKumi at the same moment.
    }
  }
}

/** The person named after `--for`, when one is. */
function named(list: Person[]): Person | null {
  const at = process.argv.indexOf('--for')
  if (at < 0) return null
  const name = (process.argv[at + 1] ?? '').toLowerCase()
  const found = list.find((p) => p.name === name)
  if (found) return found
  console.error(`\n  ${name && !name.startsWith('-') ? `Nobody called “${name}” has bots on this computer.` : 'Say who: “--for <name>”.'} See who does with “openkumi people”.\n`)
  return process.exit(1)
}

/**
 * A version of OpenKumi from before each person had a folder looks for its database in the folder
 * itself. What it finds there is this one, which holds nothing but the number of a format newer
 * than it reads: so it leaves everything alone and says to update, where it would otherwise have
 * started afresh beside the people.
 */
function leaveNote() {
  const file = path.join(BASE, 'openkumi.db')
  if (fs.existsSync(file)) return
  const note = new DatabaseSync(file)
  note.exec(`PRAGMA user_version = ${FORMAT}`)
  note.close()
}

const everyone = people()
if (!everyone.length) everyone.push(await first())
leaveNote()
const person = named(everyone) ?? everyone[0]
/** The person whose server this is. */
export const PERSON = person.name
/** Whether that is the first person here: the one meant when no name is given, and whose server OPENKUMI_PORT and OPENKUMI_HOOKS_PORT are about. */
export const FIRST = person === everyone[0]
/** This server's data folder. */
export const HOME = homeOf(PERSON)
export const PORT = FIRST ? Number(process.env.OPENKUMI_PORT ?? person.port) : person.port
export const ROOT = path.resolve(import.meta.dirname, '..')
/** The version of OpenKumi this is, as its package says. */
export const VERSION: string = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
/** Started with --lan: serve other devices on the local network whatever the setting says. */
export const LAN = process.argv.includes('--lan') || process.env.OPENKUMI_LAN === '1'

/** The database, in HOME. */
export const DATABASE = path.join(HOME, 'openkumi.db')

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
