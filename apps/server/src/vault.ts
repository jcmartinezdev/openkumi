// The vault's key: what the bots' secrets are encrypted with (secrets.ts). Each person here has a
// key of their own, and it is kept apart from their data, so that a copy of the data folder (a
// backup, a folder that is synced, one sent to somebody) cannot be read without it:
//   on a Mac     in the login keychain
//   on Windows   in a file only this account on this computer can open (Windows' data protection)
//   on Linux     in the desktop's keyring when there is one, and otherwise in a file only this
//                account can read, outside the data folder
// It is no wall against a program that already runs as the person: that can ask for the key the
// way OpenKumi does. Which key a secret was encrypted with is written beside it, and a key is
// never replaced: one that cannot be found leaves its secrets unreadable until they are entered
// again, and one that cannot be asked for right now is asked for again later.
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { VaultKeeper } from '@openkumi/shared'
import { readSecrets, writeSecret } from './config.ts'

/** A test, or whoever wants the keys somewhere of their own, names a folder: the keys are then plain files there. */
const CHOSEN = process.env.OPENKUMI_VAULT_KEYS
const FOLDER =
  CHOSEN ??
  (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'OpenKumi', 'keys')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'openkumi', 'keys'))

/** What the key is filed under in the Mac's keychain and the Linux keyring. */
const SERVICE = 'OpenKumi vault'
// Plain letters only: it is typed into the keychain's own command line.
const NOTE = 'The key OpenKumi encrypts the secrets of its bots with. Without it they cannot be read.'

/** The key is known to exist but cannot be had right now (a locked keychain, a keyring that does not answer). */
export class Locked extends Error {}
/** The key is not on this computer: what it encrypted cannot be read here. */
export class Missing extends Error {}

/** Somewhere a key is kept. `get` gives null when it holds no such key, and throws Locked when it cannot say. */
interface Store {
  kept: VaultKeeper
  get(id: string): Buffer | null
  put(id: string, key: Buffer): void
}

const run = (program: string, args: string[], input?: string, timeout = 10_000) =>
  execFileSync(program, args, { input, encoding: 'utf8', timeout, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })

const fromHex = (text: string) => {
  const hex = text.trim()
  return /^[0-9a-f]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null
}

const keychain: Store = {
  kept: 'keychain',
  get(id) {
    try {
      const key = fromHex(run('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', id, '-w']))
      if (!key) throw new Locked('The keychain gave something that is not the vault’s key.')
      return key
    } catch (e: any) {
      if (e instanceof Locked) throw e
      // 44: the keychain was asked and holds no such item.
      if (e?.status === 44) return null
      throw new Locked(`The Mac’s keychain did not give the vault’s key (${String(e?.stderr || e?.message || e).trim().split('\n')[0]}). It is unlocked when you log in to the Mac.`)
    }
  },
  put(id, key) {
    // Given on its input, so that the key is never among the arguments, which other programs can list.
    run('/usr/bin/security', ['-i'], `add-generic-password -U -s "${SERVICE}" -a "${id}" -l "${SERVICE}" -j "${NOTE}" -w ${key.toString('hex')}\n`)
  },
}

const keyring: Store = {
  kept: 'keyring',
  get(id) {
    try {
      const key = fromHex(run('secret-tool', ['lookup', 'service', 'openkumi-vault', 'account', id], undefined, 5000))
      if (!key) throw new Locked('The keyring gave something that is not the vault’s key.')
      return key
    } catch (e: any) {
      if (e instanceof Locked) throw e
      // Not installed: there is no keyring to hold it.
      if (e?.code === 'ENOENT') return null
      // It says nothing when it has no such key, and says why when it could not look.
      if (e?.status === 1 && !String(e?.stderr ?? '').trim()) return null
      throw new Locked(`The keyring did not give the vault’s key (${String(e?.stderr || e?.message || e).trim().split('\n')[0]}). It is unlocked when you log in.`)
    }
  },
  put(id, key) {
    run('secret-tool', ['store', `--label=${SERVICE}`, 'service', 'openkumi-vault', 'account', id], key.toString('hex'), 5000)
  },
}

/** Windows encrypts for the account that is logged in (DPAPI), and what it gives back is kept in a file. */
const powershell = (call: 'Protect' | 'Unprotect', base64: string) =>
  run(
    'powershell.exe',
    [
      '-NoProfile', '-NonInteractive', '-Command',
      `Add-Type -AssemblyName System.Security; $in = [Convert]::FromBase64String([Console]::In.ReadLine()); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::${call}($in, $null, 'CurrentUser'))`,
    ],
    base64 + '\n',
    30_000,
  ).trim()

const fileOf = (id: string, ending: string) => path.join(FOLDER, `${id}.${ending}`)
function keep(file: string, text: string) {
  fs.mkdirSync(FOLDER, { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, text, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}
const read = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch (e: any) {
    if (e?.code === 'ENOENT') return null
    throw new Locked(`The vault’s key could not be read (${e?.message ?? e}).`)
  }
}

const windows: Store = {
  kept: 'windows',
  get(id) {
    const sealed = read(fileOf(id, 'dpapi'))
    if (sealed === null) return null
    try {
      return Buffer.from(powershell('Unprotect', sealed.trim()), 'base64')
    } catch (e: any) {
      throw new Locked(`Windows did not open the vault’s key (${String(e?.stderr || e?.message || e).trim().split('\n')[0]}). It opens only for the account that made it, on this computer.`)
    }
  },
  put(id, key) {
    keep(fileOf(id, 'dpapi'), powershell('Protect', key.toString('base64')) + '\n')
  },
}

const file: Store = {
  kept: 'file',
  get(id) {
    const text = read(fileOf(id, 'key'))
    if (text === null) return null
    const key = fromHex(text)
    if (!key) throw new Locked('The file with the vault’s key does not hold a key.')
    return key
  },
  put(id, key) {
    keep(fileOf(id, 'key'), key.toString('hex') + '\n')
  },
}

/** Where a key is looked for, the safest place first. A key is put in the first of them that takes it. */
const stores: Store[] = CHOSEN ? [file] : [...(process.platform === 'darwin' ? [keychain] : process.platform === 'win32' ? [windows] : [keyring]), file]

/** The keys found so far, by id. */
const found = new Map<string, Buffer>()
/**
 * Keys that could not be had, and until when that is taken as said: what comes back to a bot is
 * searched for its secrets after every step, and a keychain that is asked each time, and takes
 * its time to say no, would hold everything up.
 */
const failed = new Map<string, { error: Error; until: number }>()

function keyOf(id: string): Buffer {
  const known = found.get(id)
  if (known) return known
  if (!/^k_[\w-]{6,40}$/.test(id)) throw new Missing('This secret does not say which key it was encrypted with.')
  const before = failed.get(id)
  if (before && Date.now() < before.until) throw before.error
  try {
    const key = look(id)
    found.set(id, key)
    failed.delete(id)
    return key
  } catch (e) {
    if (e instanceof Missing || e instanceof Locked) failed.set(id, { error: e, until: Date.now() + 60_000 })
    throw e
  }
}

/** Looks for a key in every place one is kept. */
function look(id: string): Buffer {
  // Where the person's own key was put when it was made is written down, and for that key only that
  // place's word counts: a keyring that never answers on this computer says nothing about a key that
  // was kept in a file. Of any other key it is not known, so a place that cannot be asked may hold it.
  const recorded = readSecrets().vault
  const keeper: VaultKeeper | undefined = recorded?.key === id ? recorded.kept : undefined
  let locked: Locked | undefined
  for (const store of stores) {
    try {
      const key = store.get(id)
      if (key?.length === 32) return key
    } catch (e) {
      if (!(e instanceof Locked)) throw e
      if (!keeper || store.kept === keeper) locked ??= e
    }
  }
  throw locked ?? new Missing('The key this was encrypted with is not on this computer, so it cannot be read here. Enter it again.')
}

/** Makes the person's key, in the first place that takes it and gives it back as it was. */
function make(): { id: string; key: Buffer } {
  // A test that made a key in the keychain of whoever runs it would leave it there for good.
  if (process.env.NODE_TEST_CONTEXT && !CHOSEN) throw new Error('A test that uses the vault has to set OPENKUMI_VAULT_KEYS: without it the key would go into the real keychain.')
  const id = `k_${crypto.randomBytes(9).toString('base64url')}`
  const key = crypto.randomBytes(32)
  for (const store of stores) {
    try {
      store.put(id, key)
      if (!store.get(id)?.equals(key)) continue
    } catch {
      continue
    }
    writeSecret('vault', { key: id, kept: store.kept })
    found.set(id, key)
    return { id, key }
  }
  throw new Error('The vault’s key could not be kept anywhere on this computer, so nothing was saved.')
}

/**
 * The key new secrets are encrypted with: the person's own, made the first time one is needed.
 * When that key is gone from this computer (the data was moved here without it), a new one takes
 * its place; what the old one encrypted stays as it is, unreadable, until it is entered again.
 */
function current(): { id: string; key: Buffer } {
  const id = readSecrets().vault?.key
  if (typeof id !== 'string') return make()
  try {
    return { id, key: keyOf(id) }
  } catch (e) {
    if (e instanceof Missing) return make()
    throw e
  }
}

/** Where this person's key is kept, or null when they have none yet. */
export const keptIn = (): VaultKeeper | null => readSecrets().vault?.kept ?? null

/** Something encrypted: which key it takes, and the text itself. Nothing in it is of use without the key. */
export interface Sealed {
  key: string
  iv: string
  data: string
}

/**
 * Encrypts `text` (AES-256-GCM). `about` says what it is the value of: it is not kept, and has to
 * be given again to read the text, so that one secret cannot be put in another's place.
 */
export function seal(text: string, about: string): Sealed {
  const { id, key } = current()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(about))
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final(), cipher.getAuthTag()])
  return { key: id, iv: iv.toString('base64'), data: data.toString('base64') }
}

/** Reads what `seal` wrote. Throws Missing when its key is not on this computer, and Locked when the key cannot be had right now. */
export function open(sealed: Sealed, about: string): string {
  const key = keyOf(sealed.key)
  try {
    const data = Buffer.from(sealed.data, 'base64')
    // The last 16 bytes say that the rest is as it was written: with fewer, less would be checked.
    if (data.length < 16) throw new Error('too short')
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'), { authTagLength: 16 })
    decipher.setAAD(Buffer.from(about))
    decipher.setAuthTag(data.subarray(data.length - 16))
    return Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8')
  } catch {
    throw new Missing('This secret could not be read: what is kept of it was changed or damaged. Enter it again.')
  }
}
