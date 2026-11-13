// Superpowers: what a bot can do beyond its own tools, such as working in the user's Notion or
// researching a question properly. Every one ships with OpenKumi, as a folder in superpowers/<id>:
//   superpower.json   its name, what it is for and what a bot can do with it, and its service
//   icon.svg          its app icon, on a square, with nothing outside a viewBox (the apps round its corners)
//   README.md         its page in the app
//   instructions.md   how the bot goes about it, read when a task calls for it
// A superpower has instructions, a service the bot signs in to and works in (over MCP, see mcp.ts),
// or both. Each is switched on for one bot at a time, by the owner; a bot cannot switch one on.
import fs from 'node:fs'
import path from 'node:path'
import type { Superpower } from '@openkumi/shared'
import { announce } from './bots.ts'
import { HOME, ROOT, botDir, emit, privateDir, readSecrets, writeSecret } from './config.ts'
import * as mcp from './mcp.ts'

/** Where a superpower's tools come from: a service on the web, or a program run on this computer. */
export interface Service {
  name: string
  url?: string
  command?: string
  args?: string[]
  /** What the bot asks the service for when it signs in. Without them, whatever the service offers. */
  scopes?: string[]
}

interface Manifest {
  name: string
  category: string
  tagline: string
  /** What the bot is told the superpower is for, in a line. */
  summary: string
  can: string[]
  mcp?: { url: string; scopes?: string[] } | { command: string; args?: string[] }
  site?: string
}

/** The superpowers that ship with OpenKumi. Tests bring a set of their own. */
export const SUPERPOWERS = process.env.OPENKUMI_SUPERPOWERS ?? path.join(ROOT, 'superpowers')
const ID = /^[a-z0-9][a-z0-9-]{0,40}$/

function manifest(id: string): Manifest | null {
  if (!ID.test(id)) return null
  try {
    return JSON.parse(fs.readFileSync(path.join(SUPERPOWERS, id, 'superpower.json'), 'utf8'))
  } catch {
    return null
  }
}
const ids = () => (fs.existsSync(SUPERPOWERS) ? fs.readdirSync(SUPERPOWERS).filter((id) => manifest(id)).sort() : [])
const hasInstructions = (id: string) => fs.existsSync(path.join(SUPERPOWERS, id, 'instructions.md'))

/** A superpower's app icon. Every app draws it at its own size, so its size is given by a viewBox alone. */
function iconOf(id: string): string {
  try {
    const svg = fs.readFileSync(path.join(SUPERPOWERS, id, 'icon.svg'), 'utf8').trim()
    return svg.length < 20_000 && /^<svg[^>]*\bviewBox=/.test(svg) && !/^<svg[^>]*\b(width|height)=/.test(svg) ? svg : ''
  } catch {
    return ''
  }
}

export function serviceOf(id: string): Service | null {
  const m = manifest(id)
  if (!m?.mcp) return null
  return 'url' in m.mcp ? { name: m.name, url: m.mcp.url, scopes: m.mcp.scopes } : { name: m.name, command: m.mcp.command, args: m.mcp.args }
}

/** A superpower that works in an app on the web is active only once the bot is signed in to it. */
export const needsSignIn = (id: string) => !!serviceOf(id)?.url

/** A superpower's folder, for reading its instructions. */
export const superpowerDir = (id: string) => path.join(SUPERPOWERS, id)

// ---- which bot has which

const botFile = (botId: string) => path.join(botDir(botId), 'superpowers.json')

/** The superpowers switched on for a bot that OpenKumi still has. */
export function enabledSuperpowers(botId: string): string[] {
  try {
    const list = JSON.parse(fs.readFileSync(botFile(botId), 'utf8')).on
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string' && !!manifest(id)).sort() : []
  } catch {
    return []
  }
}
const record = (botId: string, list: string[]) => fs.writeFileSync(botFile(botId), JSON.stringify({ on: [...new Set(list)].sort() }, null, 2) + '\n')
const botsWith = (id: string) => fs.readdirSync(path.join(HOME, 'bots')).filter((botId) => enabledSuperpowers(botId).includes(id))

/** The ones that work in an app come first, then those that are know-how only, each by name. */
export function listSuperpowers(): Superpower[] {
  const order = (p: Superpower) => `${p.service ? 0 : 1}${p.name.toLowerCase()}`
  return ids().map((id): Superpower => {
    const m = manifest(id)!
    let about = ''
    try {
      about = fs.readFileSync(path.join(SUPERPOWERS, id, 'README.md'), 'utf8')
    } catch {
      // One without a page of its own still has its tagline.
    }
    const service = serviceOf(id)
    return {
      id,
      name: m.name,
      icon: iconOf(id),
      category: m.category,
      tagline: m.tagline,
      about,
      can: m.can,
      instructions: hasInstructions(id),
      signIn: needsSignIn(id),
      service: service ? (service.url ? new URL(service.url).host : 'a program on this computer') : null,
      site: m.site ?? '',
      onFor: botsWith(id),
    }
  }).sort((a, b) => order(a).localeCompare(order(b)))
}

export const announceSuperpowers = () => emit({ type: 'superpowers', superpowers: listSuperpowers() })

export async function setSuperpower(botId: string, id: string, on: boolean) {
  const m = manifest(id)
  if (!m) throw new Error('No such superpower')
  if (on && needsSignIn(id)) throw new Error(`${m.name} becomes active once the bot is signed in to it.`)
  const now = enabledSuperpowers(botId)
  if (on === now.includes(id)) return
  record(botId, on ? [...now, id] : now.filter((other) => other !== id))
  if (on) mcp.wake(botId, id)
  else await mcp.forget(botId, id)
}

/** A bot has signed in to a superpower's app, which makes the superpower active for it. */
export function signedIn(botId: string, id: string) {
  const now = enabledSuperpowers(botId)
  if (now.includes(id)) return
  record(botId, [...now, id])
  announceSuperpowers()
  announce(botId)
}

/** What a bot is told about its superpowers: a line each, with where its instructions are and anything that is wrong. */
export function superpowerIndex(botId: string, problems: Record<string, string>): string[] {
  return enabledSuperpowers(botId).map((id) => {
    const m = manifest(id)!
    const how = [
      hasInstructions(id) && `Instructions: superpowers/${id}/instructions.md.`,
      m.mcp && `Its tools' names start with mcp__${id}__.`,
      problems[id] && `Not available right now: ${problems[id]}.`,
    ].filter(Boolean)
    return `- ${m.name}: ${m.summary}${how.length ? ` ${how.join(' ')}` : ''}`
  })
}

/** The names of a bot's superpowers, for telling the other bots what it can do. */
export const superpowerNames = (botId: string) => enabledSuperpowers(botId).map((id) => manifest(id)!.name)

/**
 * A bot used to have skills, connections and plugins, each switched on in a place of its own, and
 * OpenKumi kept a copy of every skill in ~/.openkumi/skills. Whatever a bot had that is now a
 * superpower stays switched on; the rest goes, along with the sign-ins, which were for addresses
 * that are no longer used.
 */
export function moveToSuperpowers() {
  for (const botId of fs.readdirSync(path.join(HOME, 'bots'))) {
    const dir = botDir(botId)
    const had = new Set<string>()
    const read = (file: string, key: string) => {
      try {
        for (const id of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))[key] ?? []) had.add(String(id))
      } catch {}
    }
    read('plugins.json', 'installed')
    read('mcp.json', 'enabled')
    try {
      for (const name of fs.readdirSync(path.join(dir, 'skills'))) had.add(name)
    } catch {}
    const carried = [...had].filter((id) => manifest(id))
    if (carried.length) record(botId, [...enabledSuperpowers(botId), ...carried])
    // The skills folder only ever held links into the catalog, never the bot's own files.
    for (const old of ['skills', 'mcp.json', 'plugins.json']) fs.rmSync(path.join(dir, old), { recursive: true, force: true })
    fs.rmSync(path.join(privateDir(botId), 'mcp'), { recursive: true, force: true })
  }
  const catalog = path.join(HOME, 'skills')
  if (fs.existsSync(catalog)) {
    // Copies of the skills that came with OpenKumi go. A skill the owner put there is theirs, so it is left where it is.
    for (const name of fs.readdirSync(catalog)) if (fs.existsSync(path.join(catalog, name, '.bundled'))) fs.rmSync(path.join(catalog, name), { recursive: true, force: true })
    if (fs.readdirSync(catalog).every((name) => name === '.DS_Store')) fs.rmSync(catalog, { recursive: true, force: true })
  }
  fs.rmSync(path.join(HOME, 'mcp.json'), { force: true })
  // What the Google plugins were set up with, and OpenKumi's registration with Google, from while it had Google superpowers.
  if (readSecrets().plugins) writeSecret('plugins', null)
  if (readSecrets().registrations) writeSecret('registrations', null)
}
