// The people with bots on this computer, as the person at its window looks after them: who they
// are, adding one, another name for one, and a pairing code for one's own computer or phone.
//
// Nothing of this goes over the network. The list is the server's own file, and a change to it is
// made by the server's own command line (apps/server/src/cli.ts, `openkumi people`), run here as
// that command is run in a terminal. So people are looked after at the computer that runs the
// bots, as paired computers are, and an app connected from elsewhere has no way to.
import fs from 'node:fs'
import path from 'node:path'
import { utilityProcess } from 'electron'
import type { PersonHere, PersonPairing } from '@openkumi/shared/desktop'
import { hello } from './environments.ts'
import { local, me, peopleHere, restartLocal, runHere, serverEnv, shows, startOther, startOthers, stopOther } from './local.ts'
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

/** A person's server's own access code, from its data folder, which only this computer's user can read. '' before its first start. */
function codeOf(name: string): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(local.home), name, 'auth.json'), 'utf8')).accessToken ?? ''
  } catch {
    return ''
  }
}

/**
 * A code that lets one computer or phone into someone's server, and where it can be reached. Their
 * server makes it: this asks it as the app on its own computer does, with its access code from
 * its data folder, once what answers at its port has shown that it is that server.
 */
export async function pairingFor(name: unknown): Promise<PersonPairing> {
  running()
  const person = known(name)
  const [port, code] = [portOf(person), codeOf(person.name)]
  if (!(await shows(port, code))) throw new Error(`${person.name}’s server is not running, so it cannot make a code.`)
  const ask = async (method: string, route: string) => {
    const res = await fetch(address(port) + route, { method, headers: { Authorization: `Bearer ${code}` }, signal: AbortSignal.timeout(8000) }).catch(() => null)
    if (!res?.ok) throw new Error(`${person.name}’s server did not answer.`)
    return res.json()
  }
  const [pairing, access] = await Promise.all([ask('POST', '/api/pairing'), ask('GET', '/api/access')])
  return { code: String(pairing.code), expiresAt: Number(pairing.expiresAt), port: Number(access.port), on: !!access.on, addresses: access.addresses ?? [], tailscale: access.tailscale ?? [] }
}

/**
 * How many bots are at work in the servers this app runs, everyone's: what quitting the app would
 * cut off. Null when one of them did not say, which is not the same as none.
 */
export async function workingHere(): Promise<number | null> {
  const servers = [...(local.child ? [{ port: local.port, code: local.token }] : []), ...peopleHere().filter((p) => runHere().includes(p.name)).map((p) => ({ port: p.port, code: codeOf(p.name) }))]
  const counts = await Promise.all(
    servers.map(async ({ port, code }) => {
      try {
        const res = await fetch(`${address(port)}/api/update`, { headers: { Authorization: `Bearer ${code}` }, signal: AbortSignal.timeout(3000) })
        const working = res.ok ? (await res.json()).working : null
        return typeof working === 'number' ? working : null
      } catch {
        return null
      }
    }),
  )
  return counts.some((n) => n === null) ? null : counts.reduce<number>((sum, n) => sum + n!, 0)
}
