// The local environment: Open Bot's server on this computer, run by the app in a process of its
// own. The window and the app stay free while bots work, and a server that falls over does not
// take the app with it. If Open Bot is already running here (started from a terminal, say), the
// app joins that one instead of starting a second.
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { type UtilityProcess, utilityProcess } from 'electron'
import type { LocalEnvironment } from '@openbot/shared/desktop'
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
 * An app opened from the Dock gets a bare PATH, without the folders where programs the server
 * looks for (git, Claude Code, Codex, npx) are usually installed. This adds the usual ones.
 */
function searchPath() {
  const usual = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin')]
  const have = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  return [...have, ...usual.filter((dir) => !have.includes(dir))].join(path.delimiter)
}

/**
 * Takes the server at this port as the local environment. Its access code is in its data folder,
 * which the server names to callers on this computer, and which only this computer's user can read.
 * Whatever answers at the port first has to show that it knows that code, by signing a value made
 * up here: something else that got to the port first and only says it is Open Bot is never sent it.
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
  if (!token) throw new Error('Open Bot is running on this computer, but its access code could not be read.')
  const expected = crypto.createHmac('sha256', token).update(challenge).digest()
  const given = Buffer.from(said?.proof ?? '', 'hex')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error(`Something on this computer answers at port ${port} as Open Bot, but could not show that it is. It was not given the access code.`)
  // Turned off, or off and on again, while this was being found out.
  if (turn === turns) set({ state: 'running', error: '', port, token })
}

async function start(turn: number) {
  /** False once the local environment has been turned off (or off and on again) since this began. */
  const current = () => turn === turns
  set({ state: 'starting', error: '' })
  const preferred = Number(process.env.OPENBOT_PORT ?? 4317)
  // Open Bot may already be running here, started outside the app: then that is the one to use.
  if (await hello(address(preferred), 1500)) {
    try {
      return await adopt(preferred, turn)
    } catch {
      // Not one this app can use (another user's, or not Open Bot at all): it runs its own beside it.
    }
  }
  const port = (await canListen(preferred)) ? preferred : await anyPort()
  if (!current()) return

  // The log can name folders and addresses, so only the owner may read it.
  const log = fs.createWriteStream(LOG, { mode: 0o600 })
  const child = utilityProcess.fork(SERVER, [], {
    serviceName: 'Open Bot Server',
    stdio: ['ignore', 'pipe', 'pipe'],
    // The compiled server is kept between starts, so every start after the first is quicker.
    env: { ...process.env, PATH: searchPath(), OPENBOT_PORT: String(port), NODE_COMPILE_CACHE: path.join(USER_DATA, 'server-cache') },
  })
  local.child = child
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
    set({ state: 'failed', error: 'Open Bot on this computer stopped unexpectedly.', port: 0, token: '' })
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
  } catch (e) {
    if (local.child === child) local.child = null
    child.kill()
    throw e
  }
}

let starting: Promise<void> | null = null

/** Makes sure Open Bot is running on this computer. Throws with the reason when it cannot be started. */
export function startLocal(): Promise<void> {
  wanted = true
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

/** Stops the server this app started. One that was already running is left alone. */
export function stopLocal(): Promise<void> {
  wanted = false
  // Whatever was on its way to starting is abandoned.
  turns++
  starting = null
  const child = local.child
  local.child = null
  set({ state: 'off', error: '', port: 0, token: '' })
  if (!child) return Promise.resolve()
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
