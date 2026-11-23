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

/**
 * The people here, the first one first: that is the one meant when no name is given. Nobody, when
 * the list has not been made yet. A list that is there but cannot be read is not taken for none:
 * that would make a new first person in place of everyone on it. It throws instead.
 */
export function people(): Person[] {
  let text: string
  try {
    text = fs.readFileSync(PEOPLE, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw new Error(`${PEOPLE} could not be read: ${(e as Error).message}`)
  }
  let said: unknown
  try {
    said = JSON.parse(text)
  } catch {
    // Said below.
  }
  if (!Array.isArray(said) || !said.length || !said.every((p) => NAME.test(p?.name) && Number.isInteger(p?.port))) {
    throw new Error(`${PEOPLE} is not a list of the people with bots on this computer, each with a name and a port. Nothing is started or changed until it is put right.`)
  }
  return said.map(({ name, port }) => ({ name, port }))
}

/** Written beside it and put in its place in one step, so that nothing ever reads half a list. */
export function savePeople(list: Person[]) {
  fs.mkdirSync(BASE, { recursive: true })
  const next = `${PEOPLE}.${process.pid}.next`
  fs.writeFileSync(next, JSON.stringify(list, null, 2) + '\n')
  fs.renameSync(next, PEOPLE)
}

/** Where a person's server keeps its data. */
export const homeOf = (person: string) => path.join(BASE, 'people', person)

/** A name made to fit: small letters, digits and dashes, a letter with an accent as the letter ("José" is jose). '' when nothing of it is left. */
export const fitted = (text: string) => text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '')
/** A person's name as it is shown: "juan-cruz" is Juan Cruz. */
export const shown = (name: string) => name.split('-').filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(' ')

/** Says why nothing can go on, and ends. */
function stop(message: string): never {
  console.error(`\n  ${message}\n`)
  return process.exit(1)
}

/**
 * The first person here, made when there is none: whoever uses this computer, under the name
 * they gave where they were asked (OPENKUMI_NAME, from the desktop app's welcome), or else the
 * name their account on the computer has. What OpenKumi kept here before each person had a folder
 * becomes theirs.
 */
function first(): Person {
  // A start that was cut short has already begun someone's folder: that is who it is, whatever name this start would have given.
  let begun: string[] = []
  try {
    begun = fs.readdirSync(path.join(BASE, 'people')).filter((name) => NAME.test(name))
  } catch {
    // Nobody yet.
  }
  if (begun.length > 1) stop(`${PEOPLE} is gone, and ${path.join(BASE, 'people')} holds the folders of several people (${begun.join(', ')}). Which of them is first, and their ports, was in that file: put it back, as a list like [{ "name": "ana", "port": 4317 }].`)
  let name = begun[0] ?? fitted(process.env.OPENKUMI_NAME ?? '')
  try {
    name ||= fitted(os.userInfo().username)
  } catch {
    // An account without a name.
  }
  const person = { name: NAME.test(name) ? name : 'me', port: 4317 }
  moveIn(homeOf(person.name))
  savePeople([person])
  return person
}

/**
 * Whether another program has a database open. The last connection to close takes the file
 * beside it that changes are first written to away with it, so one that is still there after
 * this look has closed belongs to someone else. One left by a program that ended without closing
 * is taken up into the database by this look, and is gone after it.
 */
export function openElsewhere(file: string): boolean {
  if (!fs.existsSync(`${file}-wal`)) return false
  try {
    const look = new DatabaseSync(file)
    look.prepare('PRAGMA user_version').get()
    look.close()
  } catch {
    // Not even to be opened: not ours to move.
    return true
  }
  return fs.existsSync(`${file}-wal`)
}

/** Whether the database in the folder itself is only the note `leaveNote` leaves, not anyone's data. */
function isNote(file: string): boolean {
  try {
    const look = new DatabaseSync(file, { readOnly: true })
    const { user_version } = look.prepare('PRAGMA user_version').get() as { user_version: number }
    look.close()
    return user_version >= 2
  } catch {
    return false
  }
}

/**
 * Before each person had a folder of their own, the data lay in the folder itself: bots/, the
 * database and the rest. All of it is moved into the first person's folder, once, and the list
 * of people is only written when all of it is there: a move that was cut short, or that met
 * something it could not move, is carried on with at the next start. Nothing is moved from under
 * a server of that time that still has the database open: this stops then, and says so.
 */
function moveIn(to: string) {
  // What stays where it is: the people, the program, and what the one service from before prints, which it goes on writing there (service.ts).
  const here = new Set(['people', 'people.json', 'runtime', 'server.log'])
  let found: string[] = []
  try {
    found = fs.readdirSync(BASE).filter((name) => !here.has(name) && !name.startsWith('people.json.') && path.join(BASE, name) !== process.env.OPENKUMI_RUNTIME)
  } catch (e) {
    // No folder yet. One that is there and cannot be looked into is not taken for empty.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') stop(`${BASE} could not be read (${(e as Error).message}). Nothing was changed.`)
  }
  // The note for versions from before stays where they look for it.
  if (found.includes('openkumi.db') && isNote(path.join(BASE, 'openkumi.db'))) found = found.filter((name) => !name.startsWith('openkumi.db'))
  if (!found.length) return
  if (['openkumi.db', 'openbot.db'].some((name) => found.includes(name) && openElsewhere(path.join(BASE, name)))) {
    // The one service there was before each person had one (service.ts), when that is what runs it.
    const service = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'LaunchAgents', 'ai.openkumi.server.plist') : path.join(os.homedir(), '.config', 'systemd', 'user', 'openkumi.service')
    const how = !fs.existsSync(service)
      ? 'Stop it (Ctrl-C in its terminal, or quit the OpenKumi app), then do this again.'
      : `It is kept running in the background. Stop it, then do this again:  ${process.platform === 'darwin' ? `launchctl bootout gui/${process.getuid!()}/ai.openkumi.server` : 'systemctl --user stop openkumi.service'}`
    stop(`OpenKumi from before this version is still running on this computer, with its data open.\n  Each person’s data has a folder of its own now, and it is not moved there from under a running server.\n  ${how}`)
  }
  fs.mkdirSync(to, { recursive: true })
  for (const name of found) {
    // The database kept its name from when OpenKumi was called Open Bot while its folder was used where it was.
    const [from, into] = [path.join(BASE, name), path.join(to, name.replace(/^openbot\.db/, 'openkumi.db'))]
    if (fs.existsSync(into)) stop(`${from} could not be moved into its person’s folder: there is already something at ${into}. Move one of the two away, then do this again.`)
    try {
      fs.renameSync(from, into)
    } catch (e) {
      // Moved by another start of OpenKumi at the same moment, or not to be moved: then nothing is written down, and the next start carries on from here.
      if (fs.existsSync(from)) stop(`${from} could not be moved into its person’s folder (${(e as Error).message}). Nothing else was changed. Put that right, then do this again.`)
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

let everyone: Person[] = []
try {
  everyone = people()
} catch (e) {
  stop((e as Error).message)
}
if (!everyone.length) everyone.push(first())
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
