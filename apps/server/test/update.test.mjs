// How a server gets a new version of itself (src/update.ts), and how apps and servers know
// whether they can work together. The release it updates from is a stand-in served by the test,
// and the "new version" is just enough of one to be tried and pointed at.
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'
import { PROTOCOL as APPS, compatible } from '../../../packages/shared/src/protocol.ts'
import { PROTOCOL } from '../src/protocol.ts'

/** A server keeps its data in the folder of the person it runs for: here the first one, made when it first starts. */
const dataOf = (home) => path.join(home, 'people', JSON.parse(fs.readFileSync(path.join(home, 'people.json'), 'utf8'))[0].name)

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
async function start(name, extra = {}, port = PORT) {
  const home = path.join(tmp, name)
  const server = spawn(process.execPath, ['src/index.ts'], {
    env: { ...process.env, OPENKUMI_HOME: home, OPENKUMI_PORT: String(port), OPENKUMI_HOOKS_PORT: String(port + 200), OPENKUMI_MOCK: '1', ...extra },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const exited = new Promise((resolve) => server.on('exit', resolve))
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('running at') && resolve())
    exited.then((code) => reject(new Error(`server exited with ${code}`)))
  })
  const token = JSON.parse(fs.readFileSync(path.join(dataOf(home), 'auth.json'), 'utf8')).accessToken
  const api = async (method, url, body) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, ...(await res.json()) }
  }
  return { api, exited, pid: server.pid, stop: () => (server.kill('SIGTERM'), exited) }
}

/**
 * A release to update to, served here: a "version 9.9.9" that is no more than what is tried before
 * it is pointed at. `said` is what it says its archive's checksum is, and `down` that it cannot be
 * reached: a test changes them.
 */
async function release(name, port) {
  const made = path.join(tmp, name)
  fs.mkdirSync(path.join(made, 'server', 'src'), { recursive: true })
  fs.symlinkSync(process.execPath, path.join(made, 'node'))
  fs.writeFileSync(path.join(made, 'server', 'package.json'), JSON.stringify({ version: '9.9.9', type: 'module' }))
  fs.copyFileSync('src/cli.ts', path.join(made, 'server', 'src', 'cli.ts'))
  const file = `openkumi-server-${TARGET}.tar.gz`
  execFileSync('tar', ['-czf', path.join(made, file), '-C', made, 'node', 'server'])
  const archive = fs.readFileSync(path.join(made, file))
  const sha256 = crypto.createHash('sha256').update(archive).digest('hex')
  const published = { sha256, said: sha256, down: false, url: `http://127.0.0.1:${port}`, close: () => (releases.close(), releases.closeAllConnections()) }
  const releases = http.createServer((req, res) => {
    if (published.down) return res.writeHead(503).end()
    if (req.url === '/latest/download/openkumi-server.json') return res.end(JSON.stringify({ version: '9.9.9', archives: { [TARGET]: { file, sha256: published.said } } }))
    if (req.url === `/download/v9.9.9/${file}`) return res.end(archive)
    res.writeHead(404).end()
  })
  await new Promise((resolve) => releases.listen(port, '127.0.0.1', resolve))
  return published
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
  const published = await release('made', RELEASES)

  const runtime = path.join(tmp, 'runtime')
  const installed = { OPENKUMI_RUNTIME: runtime, OPENKUMI_RELEASES_URL: published.url }
  const current = () => fs.readlinkSync(path.join(runtime, 'current'))
  let server
  try {
    // ---- a download that is not the file that was published is thrown away, and nothing changes
    fs.mkdirSync(path.join(runtime, 'versions', 'left-over'), { recursive: true })
    server = await start('installed', installed)
    assert.ok(!fs.existsSync(path.join(runtime, 'versions', 'left-over')), 'versions that are neither running nor next are tidied away at the start')
    published.said = 'f'.repeat(64)
    // Asked not to wait for the bots, too: that wish ends with this request, which fails, and is not handed on to the next.
    let update = await server.api('POST', '/api/update', { now: true })
    assert.deepEqual([update.how, update.state, update.latest, update.staged], ['installed', 'failed', '9.9.9', null])
    assert.match(update.error, /not the file that was published/)
    assert.ok(!fs.existsSync(path.join(runtime, 'current')) && !fs.existsSync(path.join(runtime, 'versions', '9.9.9')))

    // ---- the real one is put in place at once, but started only when the bot at work is done
    published.said = published.sha256
    const { id } = await server.api('POST', '/api/bots', { name: 'Busy', provider: 'mock' })
    await server.api('POST', `/api/bots/${id}/messages`, { text: '!slow' })
    update = await server.api('POST', '/api/update', {})
    assert.deepEqual([update.state, update.latest, update.staged, update.working], ['ready', '9.9.9', '9.9.9', 1])
    assert.equal(current(), path.join('versions', '9.9.9'), '“current”, which is what is started next, points at the new version')
    await new Promise((r) => setTimeout(r, 1200))
    assert.equal((await server.api('GET', '/api/update')).state, 'ready', 'it is still running while the bot works')
    // A look that fails meanwhile takes nothing away from the version that is in place: it still starts.
    published.down = true
    update = await server.api('POST', '/api/update', {})
    assert.deepEqual([update.state, update.staged], ['ready', '9.9.9'])
    assert.match(update.error, /could not be looked up/)
    published.down = false
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
    // The server too, when something failed before it stopped by itself.
    await server?.stop()
    published.close()
  }
})

test('servers started from one folder of versions fetch a new one at once without harm, and one that did not fetch it starts it too', { skip: process.platform === 'win32' }, async () => {
  const published = await release('made-again', RELEASES + 1)
  const runtime = path.join(tmp, 'shared')
  const installed = { OPENKUMI_RUNTIME: runtime, OPENKUMI_RELEASES_URL: published.url }
  const versions = (name = '') => path.join(runtime, 'versions', name)
  const notes = (name = '') => path.join(runtime, 'running', name)
  const within = (server, ms) => Promise.race([server.exited, new Promise((r) => setTimeout(() => r('still running'), ms))])
  // Two servers of other versions left their notes: one is still there (this test stands in for it), one is gone.
  const gone = String(spawnSync(process.execPath, ['-e', '']).pid)
  for (const version of ['1.2.3', '1.2.4']) fs.mkdirSync(versions(version), { recursive: true })
  fs.mkdirSync(notes(), { recursive: true })
  fs.writeFileSync(notes(String(process.pid)), '1.2.3')
  fs.writeFileSync(notes(gone), '1.2.4')
  let servers = []
  try {
    // ---- a version a server still runs is not tidied away from under it
    servers = [await start('shared-a', installed), await start('shared-b', installed, PORT + 1)]
    assert.deepEqual(fs.readdirSync(versions()), ['1.2.3'], 'the version of the server that is gone was tidied away, the other left')
    assert.deepEqual(fs.readdirSync(notes()).sort(), [process.pid, ...servers.map((s) => s.pid)].map(String).sort(), 'each server left a note, and the one of the server that is gone was thrown away')

    // ---- both fetch the new version at the same moment
    const updates = await Promise.all(servers.map((s) => s.api('POST', '/api/update', {})))
    assert.deepEqual(updates.map((u) => [u.state, u.staged, u.error]), [['ready', '9.9.9', ''], ['ready', '9.9.9', '']])
    assert.deepEqual(await Promise.all(servers.map((s) => within(s, 15_000))), [75, 75])
    assert.equal(fs.readlinkSync(path.join(runtime, 'current')), path.join('versions', '9.9.9'))
    assert.deepEqual(fs.readdirSync(versions()).sort(), ['1.2.3', '9.9.9'], 'nothing is left of the fetching')
    assert.deepEqual(fs.readdirSync(runtime).filter((name) => name.startsWith('.')), [])
    assert.deepEqual(fs.readdirSync(notes()), [String(process.pid)], 'a server that stops takes its note with it')

    // ---- one fetches it, and the other starts it without having been asked anything
    fs.rmSync(path.join(runtime, 'current'))
    fs.rmSync(versions('9.9.9'), { recursive: true })
    servers = [await start('shared-a', installed), await start('shared-b', installed, PORT + 1)]
    assert.equal((await servers[0].api('POST', '/api/update', {})).state, 'ready')
    assert.equal(await within(servers[0], 15_000), 75)
    assert.equal(await within(servers[1], 25_000), 75, 'it looks now and then whether a new version was put in place')
  } finally {
    await Promise.all(servers.map((s) => s.stop()))
    published.close()
  }
})
