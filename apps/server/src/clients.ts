// The other computers allowed to use this server. Each one is paired once, with a code that
// works a single time, and from then on has a key of its own that can be taken away again
// without disturbing the others. The server's own access code never leaves this computer.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { PairedComputer } from '@openbot/shared'
import { HOME, serverId } from './config.ts'

interface Stored extends PairedComputer {
  /** A hash of the computer's key. The key itself is only ever held by that computer. */
  hash: string
}

const FILE = path.join(HOME, 'clients.json')
const hashOf = (key: string) => crypto.createHash('sha256').update(key).digest('hex')

function read(): Stored[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}
let clients = read()

function save() {
  fs.writeFileSync(FILE, JSON.stringify(clients, null, 2) + '\n', { mode: 0o600 })
  fs.chmodSync(FILE, 0o600)
}

export const listComputers = (): PairedComputer[] => clients.map(({ hash: _, ...computer }) => computer)

/** The paired computer this key belongs to, or null. Notes that it was here. */
export function computerWith(key: string): string | null {
  const hash = hashOf(key)
  const found = clients.find((c) => c.hash === hash)
  if (!found) return null
  // Written down at most once a minute; every request passes through here.
  if (Date.now() - found.lastSeenAt > 60_000) {
    found.lastSeenAt = Date.now()
    save()
  }
  return found.id
}

// ---- showing a paired computer who this is
// Before a computer sends its key to an address, whatever answers there has to show that it is
// the server the key came from. The computer names itself by a tag made from the key's hash, and
// the server signs a value the computer made up with that hash. Only this server and that computer
// know the hash, so nothing else can sign it, and the tag and the signature give nothing away.

const tagOf = (hash: string) => crypto.createHash('sha256').update(`device:${hash}`).digest('hex')

/** The signature that shows the paired computer with this tag who this is, or null when no paired computer has it. */
export function proveTo(tag: string, challenge: string, server: string): string | null {
  const found = clients.find((c) => tagOf(c.hash) === tag)
  return found ? crypto.createHmac('sha256', found.hash).update(`server:${server}:${challenge}`).digest('hex') : null
}

export function removeComputer(id: string): boolean {
  const before = clients.length
  clients = clients.filter((c) => c.id !== id)
  if (clients.length !== before) save()
  return clients.length !== before
}

// ---- pairing
// The person at this computer asks for a code and gives it to the person at the other one (often
// the same person). The code is never sent over the network. Instead each side shows the other
// that it has it, by signing two made-up values with it: the other computer learns that this is
// the server the code came from, and this server learns that the other computer was given the code.

const LETTERS = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
const LIFETIME = 10 * 60_000
/** The one code that can be used right now. Asking for a new one replaces it. */
let pending: { code: string; expiresAt: number; wrong: number } | null = null

/** A code as typed: any case, with or without the dashes. */
export const plain = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')
const sign = (code: string, who: 'server' | 'computer', theirs: string, ours: string) => crypto.createHmac('sha256', code).update(`${who}:${theirs}:${ours}`).digest('hex')
const current = () => (pending && pending.expiresAt > Date.now() ? pending : (pending = null))

export function newPairingCode(): { code: string; expiresAt: number } {
  const code = Array.from(crypto.randomBytes(12), (byte) => LETTERS[byte % LETTERS.length]).join('')
  pending = { code, expiresAt: Date.now() + LIFETIME, wrong: 0 }
  return { code: code.match(/.{4}/g)!.join('-'), expiresAt: pending.expiresAt }
}

/** First step: the other computer sends a made-up value, and gets back one of ours and our signature. */
export function beginPairing(theirs: string): { nonce: string; proof: string } | null {
  const now = current()
  if (!now || !/^[0-9a-f]{32}$/.test(theirs)) return null
  const nonce = crypto.randomBytes(16).toString('hex')
  return { nonce, proof: sign(now.code, 'server', theirs, nonce) }
}

/**
 * Second step: the other computer's signature. When it is right the code is used up and the
 * computer gets its key, and this server's id to know it by.
 */
export function finishPairing(theirs: string, ours: string, proof: string, name: string): { key: string; id: string; server: string } | null {
  const now = current()
  if (!now) return null
  const expected = Buffer.from(sign(now.code, 'computer', theirs, ours), 'hex')
  const given = Buffer.from(String(proof), 'hex')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    // A handful of wrong tries and the code is gone, so it cannot be guessed at.
    if (++now.wrong >= 5) pending = null
    return null
  }
  pending = null
  const key = crypto.randomBytes(24).toString('base64url')
  const id = `c_${crypto.randomBytes(6).toString('base64url')}`
  clients.push({ id, name: name.trim().slice(0, 60) || 'A computer', pairedAt: Date.now(), lastSeenAt: Date.now(), hash: hashOf(key) })
  save()
  return { key, id, server: serverId() }
}
