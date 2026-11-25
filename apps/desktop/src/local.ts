// The local environment: OpenKumi's server on this computer, run by the app in a process of its
// own. The window and the app stay free while bots work, and a server that falls over does not
// take the app with it. If OpenKumi is already running here (started from a terminal, say), the
// app joins that one instead of starting a second.
//
// Bots belong to a person, and each person with bots on this computer has a server of their own
// (apps/server/src/people.ts). The local environment is the first person's. While this app runs
// it, it runs everyone else's beside it: they reach theirs from their own computers and phones.
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { type UtilityProcess, utilityProcess } from 'electron'
import type { FromServer, LocalEnvironment, ToServer } from '@openkumi/shared/desktop'
import { compatible } from '@openkumi/shared/protocol'
import { hello } from './environments.ts'
import { SERVER, USER_DATA } from './paths.ts'

const LOG = path.join(USER_DATA, 'server.log')
const address = (port: number) => `http://127.0.0.1:${port}`

export const local = {
  state: 'off' as LocalEnvironment['state'],
  error: '',
  port: 0,
  /** The server's access code, which the window needs to talk to it. */
  token: '',
  /** The server's data folder: that of the person it runs for, among everyone's. */
  home: '',
  /** The server's process, when this app started it. */
  child: null as UtilityProcess | null,
}

/** Whether the local environment is meant to be running, whatever state it is in right now. */
let wanted = false
/** Counts the times it was turned on or off. Work begun for an earlier time is abandoned when it notices. */
let turns = 0
let changed = () => {}
/** `fn` is called whenever the local environment changes state. */
export function onLocalChange(fn: () => void) {
  changed = fn
}
function set(patch: Partial<typeof local>) {
  Object.assign(local, patch)
  changed()
}

// ---- what the servers this app runs say to it
// Each says how many of its bots are at work, whenever that changes, and passes on a request to
// update, which is the app's to do (updateAsked.ts).

/** How many bots are at work in each server this app runs, as it said last. */
const counts = new Map<UtilityProcess, number>()
let heard: (child: UtilityProcess, message: FromServer | { type: 'gone' }) => void = () => {}
/** `fn` is given what each server this app runs says to it, and `gone` for one that has ended. */
export function onServerMessage(fn: (child: UtilityProcess, message: FromServer | { type: 'gone' }) => void) {
  heard = fn
}

/** Hears what a server this app started says, for as long as it runs. */
function listen(child: UtilityProcess) {
  child.on('message', (message: FromServer) => {
    if (message?.type === 'working' && Number.isInteger(message.working) && message.working >= 0) counts.set(child, message.working)
    heard(child, message)
  })
  child.once('exit', () => {
    counts.delete(child)
    heard(child, { type: 'gone' })
  })
}

/** The servers this app runs right now, everyone's. */
export const runningHere = (): UtilityProcess[] => [...(local.child ? [local.child] : []), ...[...others.values()].map((other) => other.child)]
/** How many bots are at work in a server this app runs, as it said last. */
export const workingIn = (child: UtilityProcess) => counts.get(child) ?? 0
/**
 * How many bots are at work in the servers this app runs, everyone's: what quitting the app would
 * cut off. Null while one of them has not said yet, which is not the same as none.
 */
export function workingInApp(): number | null {
  const all = runningHere()
  return all.some((child) => !counts.has(child)) ? null : all.reduce((sum, child) => sum + workingIn(child), 0)
}
/** Tells a server this app runs something. One that has just ended is not there to tell. */
export function tell(child: UtilityProcess, message: ToServer) {
  try {
    child.postMessage(message)
  } catch {
    // Gone.
  }
}

const canListen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })

const anyPort = () =>
  new Promise<number>((resolve) => {
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo
      probe.close(() => resolve(port))
    })
  })

/**
 * What the server is started with. An app opened from the Dock gets a bare PATH, without the
 * folders where programs the server looks for (git, Claude Code, Codex, npx) are usually
 * installed, so the usual ones are added. Windows spells the variable "Path" and takes whichever
 * spelling it meets first: there the app's own is passed on, under the one name the server reads.
 */
export function serverEnv(port: number): NodeJS.ProcessEnv {
  const usual = process.platform === 'win32' ? [] : ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin')]
  const have = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(process.env)) if (name.toUpperCase() !== 'PATH') env[name] = value
  return {
    ...env,
    PATH: [...have, ...usual.filter((dir) => !have.includes(dir))].join(path.delimiter),
    OPENKUMI_PORT: String(port),
    // What the first person here is called, when the app asked before there was anyone (the welcome).
    ...(firstName ? { OPENKUMI_NAME: firstName } : {}),
    NODE_COMPILE_CACHE: path.join(USER_DATA, 'server-cache'),
  }
}

/** OpenKumi is running on this computer in a version this app cannot work with. */
class Unfit extends Error {}

/**
 * Whether what answers at a port of this computer is the server that has this access code: it
 * signs a value made up here with it. Nothing else is ever sent an access code, so something that
 * got to the port first and only says it is OpenKumi learns nothing.
 */
export async function shows(port: number, token: string): Promise<boolean> {
  const challenge = crypto.randomBytes(16).toString('hex')
  const said = await hello(address(port), 3000, challenge)
  if (!said || !token) return false
  const expected = crypto.createHmac('sha256', token).update(challenge).digest()
  const given = Buffer.from(said.proof ?? '', 'hex')
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

/**
 * Takes the server at this port as the local environment. Its access code is in its data folder,
 * which the server names to callers on this computer, and which only this computer's user can read.
 * Whatever answers at the port first has to show that it knows that code, by signing a value made
 * up here: something else that got to the port first and only says it is OpenKumi is never sent it.
 */
async function adopt(port: number, turn: number) {
  const challenge = crypto.randomBytes(16).toString('hex')
  const said = await hello(address(port), 3000, challenge)
  let token = ''
  try {
    if (said?.home) token = JSON.parse(fs.readFileSync(path.join(said.home, 'auth.json'), 'utf8')).accessToken ?? ''
  } catch {
    // Reported below.
  }
  if (!token) throw new Error('OpenKumi is running on this computer, but its access code could not be read.')
  const expected = crypto.createHmac('sha256', token).update(challenge).digest()
  const given = Buffer.from(said?.proof ?? '', 'hex')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error(`Something on this computer answers at port ${port} as OpenKumi, but could not show that it is. It was not given the access code.`)
  // It is OpenKumi, and this user's. Whether this app can work with it is another matter: one
  // started outside the app (as a background service, say) is updated on its own.
  const fits = compatible(said?.protocol)
  if (fits === 'outdated') throw new Unfit(`OpenKumi ${said?.version} is already running on this computer, and is too old for this app. Update it with “openkumi update” in a terminal, or stop it and this app runs its own.`)
  if (fits === 'newer') throw new Unfit(`OpenKumi ${said?.version} is already running on this computer, and is newer than this app can work with. Update the app: see Settings › About.`)
  // Turned off, or off and on again, while this was being found out.
  if (turn === turns) set({ state: 'running', error: '', port, token, home: said!.home! })
}

async function start(turn: number) {
  /** False once the local environment has been turned off (or off and on again) since this began. */
  const current = () => turn === turns
  set({ state: 'starting', error: '' })
  const preferred = Number(process.env.OPENKUMI_PORT ?? 4317)
  // OpenKumi may already be running here, started outside the app: then that is the one to use.
  if (await hello(address(preferred), 1500)) {
    try {
      return await adopt(preferred, turn)
    } catch (e) {
      // This user's own OpenKumi, in a version this app cannot work with. A second one beside it
      // would share its data folder, so the person is told instead.
      if (e instanceof Unfit) throw e
      // Not one this app can use (another user's, or not OpenKumi at all): it runs its own beside it.
    }
  }
  const port = (await canListen(preferred)) ? preferred : await anyPort()
  if (!current()) return

  // The log can name folders and addresses, so only the owner may read it.
  const log = fs.createWriteStream(LOG, { mode: 0o600 })
  const child = utilityProcess.fork(SERVER, [], {
    serviceName: 'OpenKumi Server',
    stdio: ['ignore', 'pipe', 'pipe'],
    // The compiled server is kept between starts, so every start after the first is quicker.
    env: serverEnv(port),
  })
  local.child = child
  listen(child)
  /** The last things the server printed, for saying why it could not start. */
  let said = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk: Buffer) => {
      log.write(chunk)
      said = (said + chunk).slice(-2000)
    })
  }
  const startedAt = Date.now()
  child.once('exit', () => {
    log.end()
    if (local.child !== child) return
    local.child = null
    // It was running and stopped by itself. Once is put right quietly; a server that will not stay up is reported.
    if (!wanted || local.state !== 'running') return
    set({ state: 'failed', error: 'OpenKumi on this computer stopped unexpectedly.', port: 0, token: '' })
    if (Date.now() - startedAt > 30_000) void startLocal().catch(() => {})
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const late = setTimeout(() => reject(new Error('The server did not start in time.')), 40_000)
      // The server says when it is listening, so nothing has to keep asking.
      child.on('message', (message) => message?.type === 'ready' && (clearTimeout(late), resolve()))
      child.once('exit', () => (clearTimeout(late), reject(new Error(`The server could not start. ${said.trim().split('\n').slice(-3).join(' ')}`.trim()))))
    })
    await adopt(port, turn)
    // Everyone else's servers start once the first person's runs: it is the one that says who they are.
    if (current()) void startOthers()
  } catch (e) {
    if (local.child === child) local.child = null
    child.kill()
    throw e
  }
}

let starting: Promise<void> | null = null
/** The name the person at the welcome gave: what the first person here is called, if this start makes them. */
let firstName = ''

/**
 * Makes sure OpenKumi is running on this computer. Throws with the reason when it cannot be
 * started. `name` is what the first person here is called, when nobody has bots here yet.
 */
export function startLocal(name = ''): Promise<void> {
  wanted = true
  if (name) firstName = name
  if (local.state === 'running') return Promise.resolve()
  if (!starting) {
    const turn = ++turns
    starting = start(turn)
      .catch((e: Error) => {
        // Turned off while it was starting: that is not a failure, and there is nothing to report.
        if (turn !== turns) return
        set({ state: 'failed', error: e.message, port: 0, token: '' })
        throw e
      })
      .finally(() => {
        if (turn === turns) starting = null
      })
  }
  return starting
}

/** Looks again: reads the access code again if the server is still there, and starts it if it is not. */
export async function retryLocal() {
  if (local.state === 'running' && (await hello(address(local.port), 1500))) return adopt(local.port, turns)
  // One the app had joined is gone. One it started itself reports its own end.
  if (local.state === 'running' && !local.child) local.state = 'off'
  if (local.state === 'running') return
  return startLocal()
}

/** Ends a server this app started, once it has stopped by itself or after a while has not. */
function end(child: UtilityProcess): Promise<void> {
  return new Promise((resolve) => {
    // Asked to stop, the server closes its bots' browsers first. If that hangs, it is ended anyway.
    const giveUp = setTimeout(() => {
      try {
        if (child.pid) process.kill(child.pid, 'SIGKILL')
      } catch {
        // Already gone.
      }
      resolve()
    }, 6000)
    child.once('exit', () => (clearTimeout(giveUp), resolve()))
    child.kill()
  })
}

/** Stops the servers this app started, everyone's. One that was already running is left alone. */
export function stopLocal(): Promise<void> {
  wanted = false
  // Whatever was on its way to starting is abandoned.
  turns++
  starting = null
  const child = local.child
  local.child = null
  set({ state: 'off', error: '', port: 0, token: '', home: '' })
  return Promise.all([child ? end(child) : null, ...[...others.keys()].map(stopOther)]).then(() => {})
}

/**
 * Stops the server this app started for the first person, does `work` while it is down, and starts
 * it again: for what cannot be done to a server's data folder while it has it open. Asked to
 * start meanwhile, the app waits for this instead.
 */
export function restartLocal(work: () => Promise<void>): Promise<void> {
  const child = local.child
  if (!child) return Promise.reject(new Error('OpenKumi was not started by this app.'))
  const turn = ++turns
  local.child = null
  set({ state: 'starting', error: '', port: 0, token: '', home: '' })
  const again = (async () => {
    await end(child)
    try {
      await work()
    } finally {
      // Whatever became of the work, the server runs again, unless it was turned off meanwhile.
      if (turn === turns) {
        starting = null
        local.state = 'off'
        await startLocal()
      }
    }
  })()
  starting = again.catch(() => {})
  return again
}

// ---- everyone else's servers

/** Who has bots on this computer, as the first person's server keeps the list: beside its data folder's own. */
export function peopleHere(): { name: string; port: number }[] {
  // Not known while the first person's server is down, or is one from before people had folders.
  if (path.basename(path.dirname(local.home)) !== 'people') return []
  try {
    const said = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(local.home)), 'people.json'), 'utf8'))
    return Array.isArray(said) ? said.filter((p) => typeof p?.name === 'string' && /^[a-z0-9][a-z0-9-]{0,29}$/.test(p.name) && Number.isInteger(p?.port)) : []
  } catch {
    return []
  }
}
/** The person the local environment is: the one whose data folder its server has. */
export const me = () => path.basename(local.home)

/** A server's own access code, from its data folder, which only this computer's user can read. '' before its first start. */
export function codeIn(home: string): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).accessToken ?? ''
  } catch {
    return ''
  }
}

/**
 * Where the server of someone else here is reached, with its access code from their data folder,
 * once what answers at their port has shown that it knows that code. Null while it does not answer:
 * the code is never handed to anything else.
 */
export async function serverOf(name: string): Promise<{ port: number; token: string } | null> {
  const person = peopleHere().find((p) => p.name === name)
  if (!person || local.state !== 'running') return null
  const token = codeIn(path.join(path.dirname(local.home), person.name))
  return token && (await shows(person.port, token)) ? { port: person.port, token } : null
}

/** A server of someone else here that this app started: its process, the port it listens on, and its data folder. */
interface Other {
  child: UtilityProcess
  port: number
  home: string
}
/** The servers of the other people here that this app started, by the person's name. One stays here until its process has ended. */
const others = new Map<string, Other>()

/** Whether this app runs any server at the moment, or is about to: what quitting has to stop first. */
export const managing = () => !!local.child || others.size > 0 || !!starting

/**
 * Starts the server of someone else here, and resolves once it listens. One this app already
 * runs is left as it is, and so is one that something else keeps running (a background service,
 * a terminal): two servers are never started on one person's data.
 */
export async function startOther(name: string): Promise<void> {
  const person = peopleHere().find((p) => p.name === name)
  if (!person || others.has(name) || !local.child || (await hello(address(person.port), 1500))) return
  // Stopped, or started by another call, while that was being asked.
  if (others.has(name) || !local.child) return
  const log = fs.createWriteStream(path.join(USER_DATA, `server-${name}.log`), { mode: 0o600 })
  const child = utilityProcess.fork(SERVER, ['--for', name], { serviceName: `OpenKumi Server (${name})`, stdio: ['ignore', 'pipe', 'pipe'], env: serverEnv(local.port) })
  others.set(name, { child, port: person.port, home: path.join(path.dirname(local.home), name) })
  listen(child)
  let said = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk: Buffer) => {
      log.write(chunk)
      said = (said + chunk).slice(-2000)
    })
  }
  const startedAt = Date.now()
  /** It never said it listens, and was ended for it: not one to start again by itself. */
  let gaveUp = false
  return new Promise<void>((resolve, reject) => {
    // One that never says it listens is ended, not left behind: asked to stop, and made to if it does not. It counts as this app's until it is gone.
    const late = setTimeout(() => {
      gaveUp = true
      void end(child)
      reject(new Error(`${name}’s server did not start in time.`))
    }, 40_000)
    // The window may be waiting to show their bots.
    child.on('message', (message) => message?.type === 'ready' && (clearTimeout(late), resolve(), changed()))
    child.once('exit', () => {
      clearTimeout(late)
      log.end()
      // Says nothing once it had started.
      reject(new Error(`${name}’s server could not start. ${said.trim().split('\n').slice(-3).join(' ')}`.trim()))
      if (others.get(name)?.child !== child) return
      others.delete(name)
      // It was running and stopped by itself: put right once, as the first person's is.
      if (!gaveUp && wanted && local.child && Date.now() - startedAt > 30_000 && peopleHere().some((p) => p.name === name)) void startOther(name).catch(() => {})
    })
  })
}

/** Stops the server of someone else here, if this app runs it. */
export function stopOther(name: string): Promise<void> {
  const other = others.get(name)
  if (!other) return Promise.resolve()
  // Taken off the list here, so that its ending is not taken for a crash; a start of it waits for the port to be free.
  others.delete(name)
  return end(other.child)
}

/** Starts the server of everyone here but the first person, whose is the local environment. One that will not start does not hold up the others. */
export async function startOthers() {
  if (!local.child) return
  await Promise.all(peopleHere().filter((p) => p.name !== me()).map((p) => startOther(p.name).catch((e) => console.error(String(e.message ?? e)))))
}
