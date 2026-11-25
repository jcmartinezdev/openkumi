// Where the vault's key is kept on Linux and on Windows, tried here with stand-ins for the
// programs that keep it there (secret-tool, PowerShell): which place is chosen, what is left on
// disk, and what happens when a place stops answering. Each step runs the real vault.ts in a
// process of its own that is told it is on that system, as a server started again would be.
// The Mac's keychain is not tried here: a test must not write into the keychain of whoever runs it.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-vault-'))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** A program on the PATH, written in JavaScript. */
function program(dir, name, source) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), `#!${process.execPath}\n${source}`, { mode: 0o755 })
}

// secret-tool as a desktop's keyring answers it: it keeps what it is given under the account
// named, says nothing for one it does not have, and says why when there is no keyring to ask.
const SECRET_TOOL = `
const fs = require('node:fs'), path = require('node:path')
if (process.env.FAKE_KEYRING_DOWN) { console.error('secret-tool: Cannot autolaunch D-Bus without X11 $DISPLAY'); process.exit(1) }
const [verb, ...rest] = process.argv.slice(2)
const account = rest[rest.indexOf('account') + 1]
const file = path.join(process.env.FAKE_KEYRING, account)
if (verb === 'store') { fs.mkdirSync(process.env.FAKE_KEYRING, { recursive: true }); fs.writeFileSync(file, fs.readFileSync(0, 'utf8')) }
else if (verb === 'lookup') { if (!fs.existsSync(file)) process.exit(1); process.stdout.write(fs.readFileSync(file, 'utf8')) }
else process.exit(2)
`
// PowerShell asked to protect or unprotect for the account: what it hands back is of no use as the key itself.
const POWERSHELL = `
if (process.env.FAKE_DPAPI_DOWN) { console.error('Exception calling "Unprotect": Key not valid for use in specified state.'); process.exit(1) }
const command = process.argv[process.argv.indexOf('-Command') + 1]
const given = Buffer.from(require('node:fs').readFileSync(0, 'utf8').trim(), 'base64')
const mask = (bytes) => Buffer.from(bytes.map((b) => b ^ 0x5a))
if (command.includes('::Protect(')) console.log(Buffer.concat([Buffer.from('DPAPI'), mask(given)]).toString('base64'))
else if (command.includes('::Unprotect(') && given.subarray(0, 5).toString() === 'DPAPI') console.log(mask(given.subarray(5)).toString('base64'))
else process.exit(1)
`

// What a step does with the vault, in a process that takes itself to be on `platform`.
const STEP = `
Object.defineProperty(process, 'platform', { value: process.env.AS_PLATFORM })
const vault = await import(process.env.VAULT)
const [verb, given] = process.argv.slice(2)
try {
  if (verb === 'seal') console.log(JSON.stringify({ sealed: vault.seal(given, 'bot/name'), kept: vault.keptIn() }))
  else console.log(JSON.stringify({ text: vault.open(JSON.parse(given), 'bot/name') }))
} catch (e) {
  console.log(JSON.stringify({ error: e.constructor.name, message: e.message }))
}
`

/** A computer of one kind: its own data, its own places for a key, and the programs it has. */
function computer(name, platform, programs) {
  const root = path.join(tmp, name)
  for (const [program_, source] of Object.entries(programs)) program(path.join(root, 'bin'), program_, source)
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true })
  const step = path.join(root, 'step.mjs')
  fs.writeFileSync(step, STEP)
  const env = {
    // Only what the stand-ins and Node need: none of this computer's own programs, and no word that this is a test, so the vault goes where it would for anyone.
    PATH: path.join(root, 'bin'),
    HOME: root,
    OPENKUMI_HOME: path.join(root, 'data'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
    LOCALAPPDATA: path.join(root, 'AppData', 'Local'),
    FAKE_KEYRING: path.join(root, 'keyring'),
    AS_PLATFORM: platform,
    VAULT: path.resolve('src/vault.ts'),
  }
  const run = (verb, given, more = {}) => JSON.parse(execFileSync(process.execPath, [step, verb, typeof given === 'string' ? given : JSON.stringify(given)], { env: { ...env, ...more }, encoding: 'utf8' }))
  /** Whether some text is written anywhere on this computer. */
  const written = (text, dir = root) =>
    fs.readdirSync(dir, { withFileTypes: true }).some((entry) => (entry.isDirectory() ? written(text, path.join(dir, entry.name)) : entry.name !== 'step.mjs' && fs.readFileSync(path.join(dir, entry.name)).includes(text)))
  return { root, run, written }
}

test('Linux with a desktop keyring: the key goes into the keyring, and is read from it by the next start', () => {
  const pc = computer('desktop', 'linux', { 'secret-tool': SECRET_TOOL })
  const { sealed, kept } = pc.run('seal', 'a value worth keeping')
  assert.equal(kept, 'keyring')
  assert.match(sealed.key, /^k_[\w-]{12}$/)
  // The keyring has it, under the name of the key, and no file does.
  assert.match(fs.readFileSync(path.join(pc.root, 'keyring', sealed.key), 'utf8'), /^[0-9a-f]{64}$/)
  assert.ok(!fs.existsSync(path.join(pc.root, 'config')))
  assert.ok(!pc.written('a value worth keeping'))
  assert.deepEqual(pc.run('open', sealed), { text: 'a value worth keeping' })
  // The next value is encrypted with the same key.
  assert.equal(pc.run('seal', 'another').sealed.key, sealed.key)

  // A keyring that does not answer (nobody is logged in yet) is not taken for a key that is gone:
  // what there is stays unread for now, and no new key is made in its place.
  const locked = pc.run('open', sealed, { FAKE_KEYRING_DOWN: '1' })
  assert.equal(locked.error, 'Locked')
  assert.match(locked.message, /^The keyring did not give the vault’s key \(secret-tool: Cannot autolaunch D-Bus/)
  assert.equal(pc.run('seal', 'while it is locked', { FAKE_KEYRING_DOWN: '1' }).error, 'Locked')
  assert.deepEqual(fs.readdirSync(path.join(pc.root, 'keyring')), [sealed.key])
  assert.deepEqual(pc.run('open', sealed), { text: 'a value worth keeping' })

  // A key taken out of the keyring is gone, and says so.
  fs.rmSync(path.join(pc.root, 'keyring', sealed.key))
  assert.equal(pc.run('open', sealed).error, 'Missing')
})

test('Linux without a keyring, as on a server: the key is a file only the account reads, outside the data folder', () => {
  for (const [name, programs, env] of [
    ['no-keyring', {}, {}],
    // The program is installed, but there is nothing behind it to ask.
    ['keyring-down', { 'secret-tool': SECRET_TOOL }, { FAKE_KEYRING_DOWN: '1' }],
  ]) {
    const pc = computer(name, 'linux', programs)
    const { sealed, kept } = pc.run('seal', 'a value worth keeping', env)
    assert.equal(kept, 'file', name)
    const file = path.join(pc.root, 'config', 'openkumi', 'keys', `${sealed.key}.key`)
    assert.match(fs.readFileSync(file, 'utf8'), /^[0-9a-f]{64}\n$/)
    assert.equal(fs.statSync(file).mode & 0o777, 0o600)
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o700)
    assert.ok(!file.startsWith(path.join(pc.root, 'data')), 'not in the data folder')
    // Read by the next start, though the keyring still cannot be asked.
    assert.deepEqual(pc.run('open', sealed, env), { text: 'a value worth keeping' }, name)
    assert.equal(pc.run('seal', 'another', env).sealed.key, sealed.key)
    // The data arrives on another server without the key (restored there, say): what it encrypted is gone, and
    // says so, whatever the keyring's program has to say about itself. A new value gets a new key.
    fs.rmSync(file)
    assert.equal(pc.run('open', sealed, env).error, 'Missing', name)
    const again = pc.run('seal', 'entered again', env)
    assert.equal(again.kept, 'file', name)
    assert.notEqual(again.sealed.key, sealed.key)
    assert.deepEqual(pc.run('open', again.sealed, env), { text: 'entered again' }, name)
  }
})

test('Windows: the key is kept in a file that Windows opens for the account alone', () => {
  const pc = computer('windows', 'win32', { 'powershell.exe': POWERSHELL })
  const { sealed, kept } = pc.run('seal', 'a value worth keeping')
  assert.equal(kept, 'windows')
  const file = path.join(pc.root, 'AppData', 'Local', 'OpenKumi', 'keys', `${sealed.key}.dpapi`)
  // What is in the file is what Windows made of the key, not the key.
  const protectedKey = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64')
  assert.equal(protectedKey.subarray(0, 5).toString(), 'DPAPI')
  assert.equal(protectedKey.length, 5 + 32)
  assert.deepEqual(fs.readdirSync(path.dirname(file)), [`${sealed.key}.dpapi`])
  assert.deepEqual(pc.run('open', sealed), { text: 'a value worth keeping' })
  // Another account, or another computer: Windows does not open it, and it is not taken for gone.
  const refused = pc.run('open', sealed, { FAKE_DPAPI_DOWN: '1' })
  assert.equal(refused.error, 'Locked')
  assert.match(refused.message, /^Windows did not open the vault’s key \(Exception calling "Unprotect"/)
})

test('what is encrypted opens only as what it was encrypted as', () => {
  const pc = computer('about', 'linux', {})
  const { sealed } = pc.run('seal', 'a value worth keeping')
  assert.deepEqual(pc.run('open', sealed), { text: 'a value worth keeping' })
  // Changed on disk, it is refused rather than read as something else.
  const changed = Buffer.from(sealed.data, 'base64')
  changed[0] ^= 1
  assert.equal(pc.run('open', { ...sealed, data: changed.toString('base64') }).error, 'Missing')
  assert.equal(pc.run('open', { ...sealed, key: 'k_someOtherKey0' }).error, 'Missing')
})
