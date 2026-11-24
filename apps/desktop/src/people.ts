// The people with bots on this computer, as the person at its window looks after them: who they
// are, adding one, another name for one, and taking one off. Whose bots the window shows is picked
// in main.ts; their devices are paired by their own server, which the window then talks to.
//
// Nothing of this goes over the network. The list is the server's own file, and a change to it is
// made by the server's own command line (apps/server/src/cli.ts, `openkumi people`), run here as
// that command is run in a terminal. So people are looked after at the computer that runs the
// bots, as paired computers are, and an app connected from elsewhere has no way to.
import { utilityProcess } from 'electron'
import type { PersonHere } from '@openkumi/shared/desktop'
import { hello } from './environments.ts'
import { codeIn, local, me, peopleHere, restartLocal, runHere, serverEnv, shows, startOther, startOthers, stopOther } from './local.ts'
import { CLI } from './paths.ts'

const address = (port: number) => `http://127.0.0.1:${port}`
/** The port a person's server listens on. The first person's may be another than the one written down. */
const portOf = (person: { name: string; port: number }) => (person.name === me() ? local.port : person.port)

function running() {
  if (local.state !== 'running') throw new Error('OpenKumi is not running on this computer.')
}
/** A change needs the servers to be this app's to stop and start. */
function ours() {
  running()
  if (!local.child) throw new Error('OpenKumi was started outside this app on this computer, so its people are looked after there: “openkumi people add <name>” in a terminal.')
}
const known = (name: unknown) => peopleHere().find((p) => p.name === name) ?? fail(`Nobody called “${String(name)}” has bots on this computer.`)
const fail = (message: string): never => {
  throw new Error(message)
}

/** Runs `openkumi people …` as the server's own command line does it, and resolves with what it said was done. */
function command(port: number, ...args: string[]): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(CLI, ['people', ...args, '--json'], { serviceName: 'OpenKumi', stdio: ['ignore', 'pipe', 'pipe'], env: serverEnv(port) })
    let out = ''
    let wrong = ''
    child.stdout?.on('data', (chunk: Buffer) => (out += chunk))
    child.stderr?.on('data', (chunk: Buffer) => (wrong += chunk))
    const late = setTimeout(() => child.kill(), 60_000)
    child.once('exit', (code) => {
      clearTimeout(late)
      let said: Record<string, any> | null = null
      try {
        said = JSON.parse(out.trim().split('\n').filter((line) => line.startsWith('{')).pop() ?? '')
      } catch {
        // It ended without saying.
      }
      if (code === 0 && said && !said.error) resolve(said)
      else reject(new Error(String(said?.error ?? (wrong.trim().split('\n').pop() || 'That could not be done.'))))
    })
  })
}

/** Everyone with bots on this computer, the first person first, and whether each one's server answers. */
export async function people(): Promise<PersonHere[]> {
  if (local.state !== 'running') return []
  return Promise.all(peopleHere().map(async (person) => ({ name: person.name, port: portOf(person), me: person.name === me(), running: person.name === me() || !!(await hello(address(portOf(person)), 1500)) })))
}

/** Bots of their own for someone else here: written down, and their server started. */
export async function addPerson(name: unknown): Promise<PersonHere[]> {
  ours()
  const { person } = await command(local.port, 'add', String(name ?? ''))
  await startOther(person.name)
  return people()
}

/** Another name for someone here. Their server is stopped for it, since their folder is renamed with them, and started again. */
export async function renamePerson(name: unknown, to: unknown): Promise<PersonHere[]> {
  ours()
  const person = known(name)
  const port = local.port
  const rename = () => command(port, 'rename', person.name, String(to ?? '')).then(() => {})
  if (person.name === me()) await restartLocal(rename)
  else {
    await stopOther(person.name)
    try {
      await rename()
    } finally {
      // Under the new name, or the old one if that was refused.
      await startOthers()
    }
  }
  return people()
}

/** Stops someone's server and takes them off the list. What it held stays in its folder. */
export async function removePerson(name: unknown): Promise<PersonHere[]> {
  ours()
  const person = known(name)
  if (person.name === me()) throw new Error('These are your own bots: you cannot remove yourself from here.')
  await stopOther(person.name)
  try {
    await command(local.port, 'remove', person.name)
  } finally {
    await startOthers()
  }
  return people()
}

/** Asks a server on this computer with its access code. What answers is what was asked: an answer passed on from somewhere else is none. */
const asked = (port: number, code: string, method: string, route: string, timeoutMs: number) =>
  fetch(address(port) + route, { method, headers: { Authorization: `Bearer ${code}` }, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })

/**
 * How many bots are at work in the servers this app runs, everyone's: what quitting the app would
 * cut off. Null when one of them did not say, or could not show it is the server it was started
 * as, which is not the same as none.
 */
export async function workingHere(): Promise<number | null> {
  const servers = [...(local.child ? [{ port: local.port, code: local.token }] : []), ...runHere().map(({ port, home }) => ({ port, code: codeIn(home) }))]
  const counts = await Promise.all(
    servers.map(async ({ port, code }) => {
      try {
        if (!(await shows(port, code))) return null
        const res = await asked(port, code, 'GET', '/api/update', 3000)
        const working = res.ok ? (await res.json()).working : null
        return typeof working === 'number' ? working : null
      } catch {
        return null
      }
    }),
  )
  return counts.some((n) => n === null) ? null : counts.reduce<number>((sum, n) => sum + n!, 0)
}
