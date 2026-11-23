// The people with bots on this computer. A server has one owner, who sees every bot on it, so two
// people do not share one: each has a server of their own here, side by side.
//   <base>/people.json        who they are, and on which port each one's server listens
//   <base>/people/<name>/     that person's data folder
// It is the same program for all of them, started with `--for <name>` (config.ts), and each is
// kept running by a background service of its own (service.ts). Nothing is shared between two
// people but the program and what the computer's account is signed in to: the bots of all of
// them run on the same Claude Code, Codex and Grok sign-ins.
//
// The first person is made when OpenKumi first starts (config.ts) and is the one meant when no
// name is given, which is all a computer with one person ever needs.
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { NAME, PORT, type Person, homeOf, openElsewhere, people, savePeople } from './config.ts'

const WRONG = 'A name is up to 30 small letters, digits and dashes, such as “ana”: it becomes part of a folder’s name.'

/** Whether nothing on this computer has the port: nothing answers there, and it can be listened on. */
async function free(port: number): Promise<boolean> {
  // Asked both ways. A program that listens on every address does not always stop another from
  // listening on this computer's own, so being able to listen there does not show the port is free.
  const answers = await new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    socket.setTimeout(1000, () => (socket.destroy(), resolve(false)))
    socket.once('connect', () => (socket.destroy(), resolve(true)))
    socket.once('error', () => resolve(false))
  })
  if (answers) return false
  return new Promise<boolean>((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

/** A port for a new server, with the one after it for its webhooks: the first such pair nobody here has. */
async function pickPort(taken: number[]): Promise<number> {
  for (let port = PORT + 10; port < 65_000; port += 10) {
    if (!taken.includes(port) && (await free(port)) && (await free(port + 1))) return port
  }
  throw new Error('No port is free for another server on this computer.')
}

/**
 * Writes a person down and makes their data folder. Their server is reachable from other computers
 * from its first start, since it is added for someone who uses it from their own: each of those
 * still needs a code to get in. Someone who had a server here before gets the data it left behind.
 */
export async function addPerson(given: string): Promise<Person> {
  const name = given.trim().toLowerCase()
  if (!NAME.test(name)) throw new Error(WRONG)
  const list = people()
  if (list.some((p) => p.name === name)) throw new Error(`${name} has bots here already.`)
  const person = { name, port: await pickPort(list.map((p) => p.port)) }
  const home = homeOf(name)
  fs.mkdirSync(home, { recursive: true })
  const settings = path.join(home, 'settings.json')
  if (!fs.existsSync(settings)) fs.writeFileSync(settings, JSON.stringify({ lan: true }, null, 2) + '\n')
  savePeople([...list, person])
  return person
}

/**
 * Says so when a program still has a person's data open: their server, however it was started
 * and whether or not it answers yet. Their folder is not renamed under it, and they are not taken
 * off the list while it goes on with their data.
 */
function notInUse(name: string) {
  if (openElsewhere(path.join(homeOf(name), 'openkumi.db'))) throw new Error(`${name}’s server is running: it still has their data open. Stop it (Ctrl-C in its terminal) and run this again.`)
}

/** Takes a person off the list, once their server has stopped. Their data folder is left where it is. */
export function forgetPerson(name: string) {
  notInUse(name)
  savePeople(people().filter((p) => p.name !== name))
}

/** Gives a person another name, and their folder with them. Their server must not be running. */
export function renamePerson(from: string, given: string): Person {
  const to = given.trim().toLowerCase()
  if (!NAME.test(to)) throw new Error(WRONG)
  const list = people()
  if (list.some((p) => p.name === to)) throw new Error(`Someone here is called ${to} already.`)
  if (fs.existsSync(homeOf(to))) throw new Error(`${path.join('people', to)} holds what someone called ${to} left here. Move it away first, or choose another name.`)
  const person = list.find((p) => p.name === from)!
  notInUse(from)
  fs.renameSync(homeOf(from), homeOf(to))
  person.name = to
  try {
    savePeople(list)
  } catch (e) {
    // The list still has the old name: the folder goes back under it, or a start would find it empty.
    fs.renameSync(homeOf(to), homeOf(from))
    throw e
  }
  return person
}

/** What the server on a port says about itself, or null when no OpenKumi answers there. */
export async function helloAt(port: number): Promise<{ version: string } | null> {
  const res = await fetch(`http://127.0.0.1:${port}/api/hello`, { signal: AbortSignal.timeout(3000) }).catch(() => null)
  const said = res?.ok ? await res.json().catch(() => null) : null
  return said?.app === 'openkumi' ? said : null
}

/** A person's server's own access code, which is only accepted on this computer. Null before its first start. */
export function codeOf(name: string): string | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(homeOf(name), 'auth.json'), 'utf8')).accessToken ?? null
  } catch {
    return null
  }
}
