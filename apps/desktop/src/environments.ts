// The environments the app knows: where bots run. The local one is run by this app on this
// computer, when it is turned on. The others are OpenKumi on other computers, reached over the
// network at one or more addresses. The list is kept in a file of the app's own, with the key each
// remote one gave this computer when the two were paired.
import fs from 'node:fs'
import path from 'node:path'
import { type SavedAddress, isServer, ordered, probe, verdict } from '@openkumi/client/addresses'
import type { EnvironmentReport } from '@openkumi/shared/desktop'
import { USER_DATA } from './paths.ts'

export interface Environment {
  id: string
  name: string
  /** Where it can be reached: the home network, Tailscale, or an address put in by hand. */
  addresses: SavedAddress[]
  token: string
  enabled: boolean
  /** Its server's own id, once known: another server answering at one of the addresses is not it. */
  serverId?: string
}

/** An environment as an earlier version kept it, with a single address. */
const upgraded = ({ url, ...rest }: Environment & { url?: string }): Environment => ({ ...rest, addresses: rest.addresses ?? (url ? [{ url }] : []) })

interface Config {
  local: { enabled: boolean }
  environments: Environment[]
  /** The environment the window shows: "local" or the id of a remote one. */
  current: string | null
}

const FILE = path.join(USER_DATA, 'desktop.json')

function read(): Config {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    if (Array.isArray(saved.servers)) {
      // An earlier version kept one list of "servers", the local one among them.
      return {
        local: { enabled: saved.servers.some((s: { kind: string }) => s.kind === 'local') },
        environments: saved.servers.filter((s: { kind: string }) => s.kind === 'remote').map(({ id, name, url, token }: { id: string; name: string; url: string; token: string }) => ({ id, name, addresses: [{ url }], token, enabled: true })),
        current: saved.current ?? null,
      }
    }
    if (saved.local && Array.isArray(saved.environments)) return { local: { enabled: !!saved.local.enabled }, environments: saved.environments.map(upgraded), current: saved.current ?? null }
  } catch {
    // First run: nothing chosen yet.
  }
  return { local: { enabled: false }, environments: [], current: null }
}

export const config = read()

export function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  // It holds the access codes of other computers, so only the owner may read it.
  fs.writeFileSync(FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  fs.chmodSync(FILE, 0o600)
}

/** The environments that are turned on, by id, in the order they are offered. */
export const turnedOn = () => [...(config.local.enabled ? ['local'] : []), ...config.environments.filter((e) => e.enabled).map((e) => e.id)]
export const find = (id: string | null) => config.environments.find((e) => e.id === id)
export const nameOf = (id: string) => (id === 'local' ? 'This computer' : (find(id)?.name ?? 'The environment'))

/** What the window should be showing: the one last chosen if it is still turned on, else the first that is. */
export function showing(): string | null {
  const on = turnedOn()
  if (!config.current || !on.includes(config.current)) config.current = on[0] ?? null
  return config.current
}

/**
 * What an OpenKumi server on this computer says about itself, or null when there is none at the
 * address. With a `challenge`, it answers with that value signed with its access code.
 */
export async function hello(url: string, timeoutMs = 6000, challenge = ''): Promise<{ app: string; version: string; protocol?: number; home?: string; proof?: string } | null> {
  try {
    // What answers is what is asked: an answer passed on from somewhere else is none.
    const res = await fetch(`${url}/api/hello${challenge ? `?challenge=${challenge}` : ''}`, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
    const said = res.ok ? await res.json() : null
    return isServer(said) ? said : null
  } catch {
    return null
  }
}

/**
 * How each remote environment stands right now, and what each of its addresses said. Every address
 * is asked who it is, without being sent the key (see packages/client/src/addresses.ts).
 */
export async function statuses(): Promise<Record<string, EnvironmentReport>> {
  const found = await Promise.all(
    config.environments.map(async (environment): Promise<EnvironmentReport> => {
      if (!environment.enabled) return { status: 'off', addresses: {} }
      const answers = await Promise.all(ordered(environment.addresses).map((url) => probe(url, environment.token, environment.serverId)))
      const status = verdict(answers)
      const said = answers.find((answer) => answer.proven)
      return { status, addresses: Object.fromEntries(answers.map((answer) => [answer.url, answer.answer])), version: said?.version, canUpdate: status === 'outdated' && !!said }
    }),
  )
  return Object.fromEntries(config.environments.map((environment, i) => [environment.id, found[i]]))
}

/**
 * Asks a remote environment that runs an older OpenKumi to fetch the newest and start it. Each
 * address is asked who it is first, and the key only goes to one that showed it is the environment.
 * Gives back what it said it will do, for the person to read.
 */
export async function askToUpdate(environment: Environment): Promise<string> {
  const answers = await Promise.all(ordered(environment.addresses).map((url) => probe(url, environment.token, environment.serverId)))
  const there = answers.find((answer) => answer.proven)
  if (!there) throw new Error(`${environment.name} cannot be reached right now, or is too old to be updated from here. Update OpenKumi on that computer.`)
  const res = await fetch(`${there.url}/api/update`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${environment.token}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(120_000),
  }).catch(() => null)
  const said = await res?.json().catch(() => null)
  if (!res?.ok) throw new Error(res?.status === 404 ? `${environment.name} runs a version from before OpenKumi could update itself. Update it on that computer.` : (said?.error ?? `${environment.name} did not answer.`))
  if (said.state === 'failed') throw new Error(said.error)
  if (said.state !== 'ready') {
    // It knows of a newer version than the one it runs and has not put it in place: that is not "up to date".
    if (said.latest && there.version && said.latest !== there.version) return `${environment.name} found OpenKumi ${said.latest} but has not put it in place yet. Try again in a moment.`
    return `${environment.name} already runs the newest OpenKumi (${said.latest ?? there.version}). This app may need the update: see Settings › About.`
  }
  const staged = said.staged ?? said.latest
  return said.working ? `${environment.name} has OpenKumi ${staged} in place and starts it once its bots are done.` : `${environment.name} is starting OpenKumi ${staged}. It connects by itself in a moment.`
}
