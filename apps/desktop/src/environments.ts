// The environments the app knows: where bots run. The local one is run by this app on this
// computer, when it is turned on. The others are Open Bot on other computers, reached over the
// network. The list is kept in a file of the app's own, with the key each remote one gave this
// computer when the two were paired.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { EnvironmentStatus } from '@openbot/shared/desktop'
import { USER_DATA } from './paths.ts'

export interface Environment {
  id: string
  name: string
  url: string
  token: string
  enabled: boolean
}

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
        environments: saved.servers.filter((s: { kind: string }) => s.kind === 'remote').map(({ id, name, url, token }: Environment) => ({ id, name, url, token, enabled: true })),
        current: saved.current ?? null,
      }
    }
    if (saved.local && Array.isArray(saved.environments)) return { local: { enabled: !!saved.local.enabled }, environments: saved.environments, current: saved.current ?? null }
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

const UNREACHABLE = (url: string) => `Could not reach Open Bot at ${url}. Check that the other computer is on, that “Let other computers connect” is switched on in its Settings, under Environments, and that both computers are on the same network.`

/** The other computer's address as typed: with or without http://, with or without the port. */
export function parseAddress(address: unknown): string {
  const text = String(address ?? '').trim()
  if (!text) throw new Error('Enter the address of the other computer.')
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`)
    if (!url.port && url.protocol === 'http:') url.port = '4317'
    return url.origin
  } catch {
    throw new Error('That does not look like an address. It should be like 192.168.1.20:4317')
  }
}

const sign = (code: string, who: 'server' | 'computer', ours: string, theirs: string) => crypto.createHmac('sha256', code).update(`${who}:${ours}:${theirs}`).digest('hex')

/**
 * Pairs this computer with the server at `url`, using the code shown on that computer. The code
 * itself is never sent. First the server has to show that it has the code, so this cannot be
 * talked into pairing with something else at that address; then this computer shows the same,
 * and is given a key of its own. Returns the key.
 */
export async function pair(url: string, typed: unknown): Promise<string> {
  const code = String(typed ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length !== 12) throw new Error('Enter the pairing code shown on the other computer. It looks like ABCD-EFGH-JKMN.')
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${url}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) }).catch(() => null)
    if (!res) throw new Error(UNREACHABLE(url))
    const said = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(said.error ?? `${url} answered, but it is not Open Bot.`)
    return said
  }
  const nonce = crypto.randomBytes(16).toString('hex')
  const begun = await post('/api/pair/begin', { nonce })
  const expected = Buffer.from(sign(code, 'server', nonce, String(begun.nonce)), 'hex')
  const given = Buffer.from(String(begun.proof ?? ''), 'hex')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new Error('The pairing code is not the one that computer is showing. Check it, or make a new one there.')
  const done = await post('/api/pair/finish', { nonce, serverNonce: begun.nonce, proof: sign(code, 'computer', nonce, String(begun.nonce)), name: os.hostname().replace(/\.local$/, '') })
  if (typeof done.key !== 'string' || !done.key) throw new Error('Pairing did not finish. Make a new code on the other computer and try again.')
  return done.key
}

/**
 * What an Open Bot server says about itself, or null when there is none at the address. With a
 * `challenge`, a server on this computer answers with that value signed with its access code.
 */
export async function hello(url: string, token = '', timeoutMs = 6000, challenge = ''): Promise<{ app: string; version: string; authorized: boolean; home?: string; proof?: string } | null> {
  try {
    const res = await fetch(`${url}/api/hello${challenge ? `?challenge=${challenge}` : ''}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(timeoutMs) })
    const said = res.ok ? await res.json() : null
    return said?.app === 'open-bot' ? said : null
  } catch {
    return null
  }
}

/** Asks the server whether it is there and accepts the access code. Throws with a reason when not. */
export async function check({ url, token }: { url: string; token: string }) {
  const said = await hello(url, token)
  if (!said) throw new Error(UNREACHABLE(url))
  if (!said.authorized) throw new Error('That computer no longer accepts this one. Pair them again.')
}

/** The state of each remote environment right now, in a word. */
export async function statuses(): Promise<Record<string, EnvironmentStatus>> {
  const found = await Promise.all(
    config.environments.map(async (environment): Promise<EnvironmentStatus> => {
      if (!environment.enabled) return 'off'
      const said = await hello(environment.url, environment.token, 2500)
      return !said ? 'unreachable' : said.authorized ? 'connected' : 'refused'
    }),
  )
  return Object.fromEntries(config.environments.map((environment, i) => [environment.id, found[i]]))
}
