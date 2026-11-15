// How a server gets a new version of itself (src/update.ts), and how apps and servers know
// whether they can work together. The release it updates from is a stand-in served by the test,
// and the "new version" is just enough of one to be tried and pointed at.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { PROTOCOL as APPS, compatible } from '../../../packages/shared/src/protocol.ts'
import { PROTOCOL } from '../src/protocol.ts'

const PORT = 5200 + Math.floor(Math.random() * 90)
const RELEASES = PORT + 100
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-update-'))
const VERSION = JSON.parse(fs.readFileSync('package.json', 'utf8')).version
const TARGET = `${process.platform}-${process.arch}`
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))

const until = async (check, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('Condition was not met in time')
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** Starts the server on a data folder of its own. `extra` is what an installed one is started with. */
async function start(name, extra = {}) {
  const home = path.join(tmp, name)
  const server = spawn(process.execPath, ['src/index.ts'], {
    env: { ...process.env, OPENKUMI_HOME: home, OPENKUMI_PORT: String(PORT), OPENKUMI_HOOKS_PORT: String(PORT + 200), OPENKUMI_MOCK: '1', ...extra },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const exited = new Promise((resolve) => server.on('exit', resolve))
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('running at') && resolve())
    exited.then((code) => reject(new Error(`server exited with ${code}`)))
  })
  const token = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).accessToken
  const api = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, ...(await res.json()) }
  }
  return { api, exited, stop: () => (server.kill('SIGTERM'), exited) }
}

test('apps and servers compare one number, not their versions', async () => {
  assert.equal(PROTOCOL, APPS, 'the server’s copy of the number (apps/server/src/protocol.ts) and the apps’ (packages/shared/src/protocol.ts) are the same')
  assert.deepEqual([compatible(APPS), compatible(APPS - 1), compatible(APPS + 1), compatible(undefined)], ['ok', 'outdated', 'newer', 'outdated'])

  const server = await start('plain')
  try {
    const hello = await (await fetch(`http://127.0.0.1:${PORT}/api/hello`)).json()
    assert.deepEqual([hello.version, hello.protocol], [VERSION, PROTOCOL], 'it says both to anyone who asks, before any key is sent')
    const state = await server.api('GET', '/api/state')
    assert.equal(state.about.protocol, PROTOCOL)
    assert.equal(state.settings.autoUpdate, true)
    // Run from the repository it does not update itself, and says how it is updated instead.
    assert.deepEqual([state.update.how, state.update.state], ['source', 'idle'])
    const refused = await server.api('POST', '/api/update', {})
    assert.equal(refused.status, 409)
    assert.match(refused.error, /runs from its source/)
  } finally {
    await server.stop()
  }
})

test('an installed server fetches a new version, checks it, and starts it once no bot is working', { skip: process.platform === 'win32' }, async () => {
  // ---- a release to update to: a "version 9.9.9" that is no more than what is tried before it is pointed at
  const made = path.join(tmp, 'made')
  fs.mkdirSync(path.join(made, 'server', 'src'), { recursive: true })
  fs.symlinkSync(process.execPath, path.join(made, 'node'))
  fs.writeFileSync(path.join(made, 'server', 'package.json'), JSON.stringify({ version: '9.9.9', type: 'module' }))
  fs.copyFileSync('src/cli.ts', path.join(made, 'server', 'src', 'cli.ts'))
  const file = `openkumi-server-${TARGET}.tar.gz`
  execFileSync('tar', ['-czf', path.join(tmp, file), '-C', made, 'node', 'server'])
  const archive = fs.readFileSync(path.join(tmp, file))
  const sha256 = crypto.createHash('sha256').update(archive).digest('hex')
  /** What the release says its archive's checksum is; a test changes it to stand for a download that is not what was published. */
  let said = sha256
  const releases = http.createServer((req, res) => {
    if (req.url === '/latest/download/openkumi-server.json') return res.end(JSON.stringify({ version: '9.9.9', archives: { [TARGET]: { file, sha256: said } } }))
    if (req.url === `/download/v9.9.9/${file}`) return res.end(archive)
    res.writeHead(404).end()
  })
  await new Promise((resolve) => releases.listen(RELEASES, '127.0.0.1', resolve))

  const runtime = path.join(tmp, 'runtime')
  const installed = { OPENKUMI_RUNTIME: runtime, OPENKUMI_RELEASES_URL: `http://127.0.0.1:${RELEASES}` }
  const current = () => fs.readlinkSync(path.join(runtime, 'current'))
  try {
    // ---- a download that is not the file that was published is thrown away, and nothing changes
    fs.mkdirSync(path.join(runtime, 'versions', 'left-over'), { recursive: true })
    let server = await start('installed', installed)
    assert.ok(!fs.existsSync(path.join(runtime, 'versions', 'left-over')), 'versions that are neither running nor next are tidied away at the start')
    said = 'f'.repeat(64)
    let update = await server.api('POST', '/api/update', {})
    assert.deepEqual([update.how, update.state, update.latest], ['installed', 'failed', '9.9.9'])
    assert.match(update.error, /not the file that was published/)
    assert.ok(!fs.existsSync(path.join(runtime, 'current')) && !fs.existsSync(path.join(runtime, 'versions', '9.9.9')))

    // ---- the real one is put in place at once, but started only when the bot at work is done
    said = sha256
    const { id } = await server.api('POST', '/api/bots', { name: 'Busy', provider: 'mock' })
    await server.api('POST', `/api/bots/${id}/messages`, { text: '!slow' })
    update = await server.api('POST', '/api/update', {})
    assert.deepEqual([update.state, update.latest, update.working], ['ready', '9.9.9', 1])
    assert.equal(current(), path.join('versions', '9.9.9'), '“current”, which is what is started next, points at the new version')
    await new Promise((r) => setTimeout(r, 1200))
    assert.equal((await server.api('GET', '/api/update')).state, 'ready', 'it is still running while the bot works')
    // It ends with the code that asks whatever runs it to start it again: that start is the new version.
    assert.equal(await Promise.race([server.exited, new Promise((r) => setTimeout(() => r('still running'), 15_000))]), 75)

    // ---- told not to wait, it starts the new version with the bot still at work
    fs.rmSync(path.join(runtime, 'current'))
    server = await start('installed', installed)
    const bots = (await server.api('GET', '/api/state')).bots
    await server.api('POST', `/api/bots/${bots.find((b) => b.name === 'Busy').id}/messages`, { text: '!slow' })
    const began = Date.now()
    update = await server.api('POST', '/api/update', { now: true })
    assert.deepEqual([update.state, update.working], ['ready', 1])
    assert.equal(await server.exited, 75)
    assert.ok(Date.now() - began < 3500, 'it did not wait for the reply, which takes four seconds')
    assert.equal(current(), path.join('versions', '9.9.9'))
  } finally {
    releases.close()
    releases.closeAllConnections()
  }
})
