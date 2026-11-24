// The people with bots on one computer (src/people.ts). Each has a server of their own, with a
// data folder of its own under people/ and a port of its own, started with `--for <name>`. The
// first is made when OpenKumi first starts and is the one meant when no name is given. Two are
// run side by side here, and neither shows the other's bots.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, test } from 'node:test'

const PORT = 5400 + Math.floor(Math.random() * 40) * 10
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-people-'))
// The port and the webhooks port chosen here are the first person's server's. Nobody else's takes them.
const env = { ...process.env, OPENKUMI_HOME: home, OPENKUMI_PORT: String(PORT), OPENKUMI_HOOKS_PORT: String(PORT + 5), OPENKUMI_MOCK: '1', OPENKUMI_RUNTIME: '' }
/** The port the first person is written down with, run from the repository as these tests are. An installed OpenKumi's is 4317 (migrate.test.mjs). */
const USUAL = 4417

const running = new Set()
after(async () => {
  for (const server of running) server.kill('SIGKILL')
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/** The `openkumi` command, as run from the repository: what it printed, and the code it ended with. */
function openkumi(...args) {
  const ran = spawnSync(process.execPath, ['src/cli.ts', ...args], { env, encoding: 'utf8' })
  return { code: ran.status, said: ran.stdout + ran.stderr }
}
const listed = () => JSON.parse(fs.readFileSync(path.join(home, 'people.json'), 'utf8'))
const folder = (who, ...parts) => path.join(home, 'people', who, ...parts)

/** Starts a person's server: with no name, the first person's. */
async function start(who = '') {
  const server = spawn(process.execPath, ['src/index.ts', ...(who ? ['--for', who] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise((resolve) => server.on('exit', resolve))
  running.add(server)
  void exited.then(() => running.delete(server))
  let printed = ''
  server.stderr.on('data', (d) => (printed += d))
  const port = await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => {
      printed += d
      const at = /running at http:\/\/127\.0\.0\.1:(\d+)/.exec(printed)
      if (at) resolve(Number(at[1]))
    })
    exited.then((code) => reject(new Error(`server exited with ${code}: ${printed}`)))
  })
  const data = folder(who || listed()[0].name)
  const token = JSON.parse(fs.readFileSync(path.join(data, 'auth.json'), 'utf8')).accessToken
  const api = async (method, url, body, key = token) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, ...(await res.json().catch(() => ({}))) }
  }
  return { api, port, token, data, stop: () => (server.kill('SIGTERM'), exited) }
}

test('each person has a server of their own on the same computer, apart from the others’', async () => {
  // ---- the first person is whoever uses the computer, made when OpenKumi is first asked anything
  const first = openkumi('people')
  assert.equal(first.code, 0, first.said)
  const [me] = listed()
  assert.deepEqual([listed().length, me.port], [1, USUAL], 'written down with the usual port, which this test’s own choice stands in for')
  assert.match(first.said, new RegExp(`${me.name} +port ${PORT} +not running`))
  assert.ok(fs.existsSync(folder(me.name, 'bots')), 'their data folder is one of people/, like anyone’s')
  assert.deepEqual(fs.readdirSync(home).sort(), ['openkumi.db', 'people', 'people.json'], 'no data lies in the folder itself: its database is a note for versions from before')

  // ---- another name for them, and their folder with it
  assert.match(openkumi('people', 'rename', me.name, 'Not A Name').said, /up to 30 small letters, digits and dashes/)
  assert.match(openkumi('people', 'rename', 'nobody', 'juan').said, /Nobody called “nobody”/)
  assert.equal(openkumi('people', 'rename', me.name, 'juan').code, 0)
  assert.deepEqual([listed()[0].name, fs.readdirSync(path.join(home, 'people'))], ['juan', ['juan']])

  // ---- someone else: written down, with a port of their own and a folder beside the first one's
  assert.match(openkumi('people', 'add', 'Not A Name').said, /up to 30 small letters, digits and dashes/)
  assert.equal(openkumi('status', '--for', 'ana').code, 1, 'a name nobody here has is refused')
  const added = openkumi('people', 'add', 'Ana')
  assert.equal(added.code, 0, added.said)
  const ana = listed()[1]
  assert.equal(ana.name, 'ana')
  assert.ok(ana.port > PORT, 'the port is another one than the first person’s')
  assert.match(added.said, new RegExp(`on port ${ana.port}`))
  assert.deepEqual(JSON.parse(fs.readFileSync(folder('ana', 'settings.json'), 'utf8')), { lan: true }, 'other computers can reach it from its first start: it was added for someone who uses it from theirs')
  assert.match(openkumi('people', 'add', 'ana').said, /has bots here already/)
  assert.equal(openkumi('people', 'add', 'leo').code, 0)
  const leo = listed()[2]
  assert.ok(leo.port !== ana.port && leo.port !== PORT, 'each person has a port of their own')
  assert.match(openkumi('people', 'rename', 'leo', 'ana').said, /Someone here is called ana already/)

  // ---- two run at once, each on its own port and data
  const mine = await start()
  const theirs = await start('ana')
  assert.deepEqual([mine.port, theirs.port], [PORT, ana.port])
  const [my, their] = [await mine.api('GET', '/api/state'), await theirs.api('GET', '/api/state')]
  assert.deepEqual([my.home, their.home].map((dir) => fs.realpathSync(dir)), [folder('juan'), folder('ana')].map((dir) => fs.realpathSync(dir)))
  assert.deepEqual([my.about.hooksPort, their.about.hooksPort], [PORT + 5, ana.port + 1], 'the webhooks port chosen for the first person’s server is not theirs too')
  assert.notEqual((await (await fetch(`http://127.0.0.1:${mine.port}/api/hello`)).json()).id, (await (await fetch(`http://127.0.0.1:${theirs.port}/api/hello`)).json()).id, 'they are two servers to an app')
  assert.deepEqual([my.settings.lan, their.settings.lan], [false, true])

  // ---- neither shows the other's bots, and the access code of one is nothing to the other
  const made = await theirs.api('POST', '/api/bots', { name: 'Garden', provider: 'mock' })
  assert.ok(fs.existsSync(folder('ana', 'bots', made.id, 'bot.md')))
  assert.ok(!fs.existsSync(folder('juan', 'bots', made.id)))
  assert.deepEqual((await theirs.api('GET', '/api/state')).bots.map((b) => b.name).sort(), [their.bots[0].name, 'Garden'].sort())
  assert.deepEqual((await mine.api('GET', '/api/state')).bots.map((b) => b.name), my.bots.map((b) => b.name), 'the other server knows nothing of it')
  assert.equal((await theirs.api('GET', '/api/state', undefined, mine.token)).status, 401)
  assert.equal((await mine.api('GET', '/api/state', undefined, theirs.token)).status, 401)

  // ---- a command is about the first person's server, or about another's with --for, wherever that stands
  assert.match(openkumi('status', '--for', 'ana').said, new RegExp(`ana’s OpenKumi \\S+ is running on port ${ana.port}`))
  assert.match(openkumi('--for', 'ana', 'status').said, new RegExp(`running on port ${ana.port}`))
  assert.match(openkumi('status').said, new RegExp(`juan’s OpenKumi \\S+ is running on port ${PORT}\\.[\\s\\S]*People: +juan, ana, leo each have a server of their own here`))
  assert.match(openkumi('status', '--for', 'juan').said, new RegExp(`running on port ${PORT}`), 'the first person can be named too')
  const paired = openkumi('pair', '--for', 'ana').said
  assert.match(paired, /Pairing code: {2}[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)
  // The code is one their server gave: it begins a pairing there, and none on the first person's.
  const begin = (port) => fetch(`http://127.0.0.1:${port}/api/pair/begin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: 'ab'.repeat(16) }) })
  assert.deepEqual([(await begin(theirs.port)).status, (await begin(mine.port)).status], [200, 403])
  assert.match(openkumi('lan', 'off', '--for', 'ana').said, /Only this computer can reach ana’s OpenKumi/)
  // (Switching that moves the server to another address of the computer, which takes it a moment.)
  for (let tries = 0; tries < 100; tries++) {
    if ((await theirs.api('GET', '/api/state').catch(() => ({}))).settings?.lan === false) break
    await new Promise((r) => setTimeout(r, 100))
  }
  await new Promise((r) => setTimeout(r, 400))
  assert.equal((await theirs.api('GET', '/api/state')).settings.lan, false)
  const list = openkumi('people').said
  assert.match(list, new RegExp(`juan +port ${PORT} +running`))
  assert.match(list, new RegExp(`ana +port ${ana.port} +running`))
  assert.match(list, new RegExp(`leo +port ${leo.port} +not running`))
  assert.match(openkumi('people', 'add', 'eve', '--for', 'ana').said, /leave out “--for”/)
  assert.match(openkumi('people', 'rename', 'ana', 'anna').said, /is running, started by hand/, 'a folder is not moved from under a server that has it open')

  // ---- nobody is taken off the list from under their running server, which would go on with their data
  assert.match(openkumi('people', 'remove', 'ana').said, /ana’s server is running, started by hand/)
  assert.deepEqual(listed().map((p) => p.name), ['juan', 'ana', 'leo'])
  await theirs.stop()
  await mine.stop()

  // ---- taken off the list, what their server held stays, and is theirs again when they are added again
  const removed = openkumi('people', 'remove', 'ana')
  assert.equal(removed.code, 0, removed.said)
  assert.deepEqual(listed().map((p) => p.name), ['juan', 'leo'])
  assert.ok(fs.existsSync(folder('ana', 'bots', made.id, 'bot.md')), 'nothing of theirs was deleted')
  assert.equal(openkumi('status', '--for', 'ana').code, 1)
  assert.match(openkumi('people', 'remove', 'ana').said, /Nobody called “ana”/)
  assert.equal(openkumi('people', 'add', 'ana').code, 0)
  // Renamed while stopped, their server is the same one to the apps paired with it.
  assert.equal(openkumi('people', 'rename', 'ana', 'anna').code, 0)
  const again = await start('anna')
  assert.ok((await again.api('GET', '/api/state')).bots.some((b) => b.name === 'Garden'))
  assert.equal(again.token, theirs.token)
  await again.stop()

  // ---- nor while a program has their data open that does not answer on their port: a server still starting, or stopping, or run some other way
  const file = folder('anna', 'openkumi.db')
  const holding = spawn(process.execPath, ['-e', `const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(${JSON.stringify(file)}); db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS held (x); INSERT INTO held VALUES (1)'); console.log('open'); setInterval(() => {}, 1000)`], { stdio: ['ignore', 'pipe', 'inherit'] })
  running.add(holding)
  await new Promise((resolve) => holding.stdout.on('data', resolve))
  assert.match(openkumi('people', 'rename', 'anna', 'hanna').said, /anna’s server is running: it still has their data open/)
  assert.match(openkumi('people', 'remove', 'anna').said, /anna’s server is running: it still has their data open/)
  assert.deepEqual([listed().map((p) => p.name), fs.existsSync(folder('anna', 'bots'))], [['juan', 'leo', 'anna'], true])
  holding.kill('SIGKILL')
  await new Promise((resolve) => holding.on('exit', resolve))
  running.delete(holding)

  // ---- the first person stays: who a command with no name is about, and whose the ports given by hand are, does not pass to someone else
  assert.equal(openkumi('people', 'remove', 'leo').code, 0)
  const kept = openkumi('people', 'remove', 'juan')
  assert.equal(kept.code, 1)
  assert.match(kept.said, /juan is the first person here[\s\S]*is not removed[\s\S]*people rename juan/)
  assert.deepEqual(listed().map((p) => p.name), ['juan', 'anna'])
})

test('the first person is called what they said where they were asked, and a paired computer is told whose server it has', async () => {
  // What the desktop app does: the name from its welcome goes with the first start, and people are looked after with the commands, answered for a program to read.
  const asked = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-named-'))
  const port = PORT + 9
  const its = { ...env, OPENKUMI_HOME: asked, OPENKUMI_PORT: String(port), OPENKUMI_HOOKS_PORT: '', OPENKUMI_NAME: 'María José' }
  const command = (...args) => JSON.parse(spawnSync(process.execPath, ['src/cli.ts', 'people', ...args, '--json'], { env: its, encoding: 'utf8' }).stdout.trim().split('\n').pop())
  const server = spawn(process.execPath, ['src/index.ts'], { env: its, stdio: ['ignore', 'pipe', 'inherit'] })
  running.add(server)
  try {
    await new Promise((resolve, reject) => {
      server.stdout.on('data', (d) => String(d).includes('running at') && resolve())
      server.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
    })
    // A name as people write it is made to fit a folder's.
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(asked, 'people.json'), 'utf8')), [{ name: 'maria-jose', port: USUAL }])
    const token = JSON.parse(fs.readFileSync(path.join(asked, 'people', 'maria-jose', 'auth.json'), 'utf8')).accessToken
    const api = async (method, url) => (await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { Authorization: `Bearer ${token}` } })).json()
    assert.equal((await api('GET', '/api/state')).about.person, 'maria-jose')
    assert.equal('person' in (await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json()), false, 'whose it is is only told to a computer that was let in')

    // A computer that pairs is told what to call the server: the computer it is on, and whose it is once several people have one there.
    const pairAs = async (name) => {
      const code = (await api('POST', '/api/pairing')).code.replaceAll('-', '')
      const sign = (who, theirs, ours) => crypto.createHmac('sha256', code).update(`${who}:${theirs}:${ours}`).digest('hex')
      const post = async (url, body) => (await fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
      const nonce = crypto.randomBytes(16).toString('hex')
      const begun = await post('/api/pair/begin', { nonce })
      return post('/api/pair/finish', { nonce, serverNonce: begun.nonce, proof: sign('computer', nonce, begun.nonce), name })
    }
    const computer = os.hostname().split('.')[0]
    assert.equal((await pairAs('Laptop')).name, computer)

    // The commands, as the app asks them.
    assert.deepEqual(command().people.map((p) => p.name), ['maria-jose'])
    assert.deepEqual(command('add', 'Not A Name'), { error: 'A name is up to 30 small letters, digits and dashes, such as “ana”: it becomes part of a folder’s name.' })
    const { person } = command('add', 'leo')
    assert.deepEqual([person.name, person.port > port], ['leo', true])
    assert.deepEqual(command('add', 'leo'), { error: 'leo has bots here already.' })
    assert.equal((await pairAs('Phone')).name, `Maria Jose on ${computer}`)
    assert.deepEqual(command('rename', 'leo', 'leon'), { renamed: 'leon' })
    assert.deepEqual(command('remove', 'leon'), { removed: 'leon' })
    assert.match(command('remove', 'maria-jose').error, /^maria-jose is the first person here, whom a command with no name is about, and is not removed\./)
  } finally {
    server.kill('SIGTERM')
    await new Promise((r) => server.on('exit', r))
    fs.rmSync(asked, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

/** A data folder as a version from before each person had one left it: everything in the folder itself. */
function before(name) {
  const old = fs.mkdtempSync(path.join(os.tmpdir(), `openkumi-${name}-`))
  fs.mkdirSync(path.join(old, 'bots', 'b_1'), { recursive: true })
  fs.writeFileSync(path.join(old, 'auth.json'), JSON.stringify({ accessToken: 'keep-me' }))
  fs.writeFileSync(path.join(old, 'settings.json'), JSON.stringify({ lan: true }))
  return old
}
/** A start of this version on that folder, as any command is: what it said, and the code it ended with. */
const startOn = (old, more = {}) => spawnSync(process.execPath, ['src/cli.ts', 'people'], { env: { ...env, OPENKUMI_HOME: old, ...more }, encoding: 'utf8' })
const inFolder = (old) => fs.readdirSync(old).sort()

test('what a server from before kept in the folder itself is not moved from under it while it has it open', async () => {
  const old = before('open')
  const file = path.join(old, 'openkumi.db')
  // The server from before, standing in: a program with the database open, as a running server has it. Whatever port it listens on, or none.
  const holding = spawn(process.execPath, ['-e', `const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(${JSON.stringify(file)}); db.exec('PRAGMA journal_mode = WAL; CREATE TABLE threads (id TEXT); INSERT INTO threads VALUES (1)'); console.log('open'); setInterval(() => {}, 1000)`], { stdio: ['ignore', 'pipe', 'inherit'] })
  try {
    await new Promise((resolve) => holding.stdout.on('data', resolve))
    const refused = startOn(old)
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /OpenKumi from before this version is still running on this computer, with its data open/)
    assert.deepEqual(inFolder(old), ['auth.json', 'bots', 'openkumi.db', 'openkumi.db-shm', 'openkumi.db-wal', 'settings.json'], 'nothing was moved or made')

    // It ends without closing its database, as a crash does. What it had not yet put into the database is not lost, and all of it becomes the first person's.
    holding.kill('SIGKILL')
    await new Promise((resolve) => holding.on('exit', resolve))
    assert.ok(fs.existsSync(`${file}-wal`))
    assert.equal(startOn(old).status, 0)
    const [{ name }] = JSON.parse(fs.readFileSync(path.join(old, 'people.json'), 'utf8'))
    assert.deepEqual(inFolder(old), ['openkumi.db', 'people', 'people.json'])
    assert.deepEqual(fs.readdirSync(path.join(old, 'people', name)).sort(), ['auth.json', 'bots', 'openkumi.db', 'settings.json'])
    assert.equal(JSON.parse(fs.readFileSync(path.join(old, 'people', name, 'auth.json'), 'utf8')).accessToken, 'keep-me')
    const moved = new DatabaseSync(path.join(old, 'people', name, 'openkumi.db'))
    assert.equal(moved.prepare('SELECT count(*) AS n FROM threads').get().n, 1)
    moved.close()
  } finally {
    holding.kill('SIGKILL')
    fs.rmSync(old, { recursive: true, force: true })
  }
})

test('a move into the first person’s folder that was cut short is carried on with, and one that cannot be finished writes nothing down', () => {
  // ---- cut short after the bots had moved: the rest follows, into the folder that was begun, whatever this start would have called its person
  const cut = before('cut')
  fs.mkdirSync(path.join(cut, 'people', 'whoever'), { recursive: true })
  fs.renameSync(path.join(cut, 'bots'), path.join(cut, 'people', 'whoever', 'bots'))
  try {
    assert.equal(startOn(cut, { OPENKUMI_NAME: 'Someone Else' }).status, 0)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cut, 'people.json'), 'utf8')), [{ name: 'whoever', port: USUAL }])
    assert.deepEqual(inFolder(cut), ['openkumi.db', 'people', 'people.json'])
    assert.deepEqual(fs.readdirSync(path.join(cut, 'people', 'whoever')).sort(), ['auth.json', 'bots', 'settings.json'])
  } finally {
    fs.rmSync(cut, { recursive: true, force: true })
  }

  // ---- something is in the way: it says what, and nobody is written down, so the next start tries again
  const blocked = before('blocked')
  fs.mkdirSync(path.join(blocked, 'people', 'whoever'), { recursive: true })
  fs.writeFileSync(path.join(blocked, 'people', 'whoever', 'auth.json'), JSON.stringify({ accessToken: 'another' }))
  try {
    const stopped = startOn(blocked)
    assert.equal(stopped.status, 1)
    assert.match(stopped.stderr, /auth\.json could not be moved into its person’s folder: there is already something at /)
    assert.ok(!fs.existsSync(path.join(blocked, 'people.json')) && !fs.existsSync(path.join(blocked, 'openkumi.db')))
    assert.equal(JSON.parse(fs.readFileSync(path.join(blocked, 'auth.json'), 'utf8')).accessToken, 'keep-me')
    fs.rmSync(path.join(blocked, 'people', 'whoever', 'auth.json'))
    assert.equal(startOn(blocked).status, 0)
    assert.equal(JSON.parse(fs.readFileSync(path.join(blocked, 'people', 'whoever', 'auth.json'), 'utf8')).accessToken, 'keep-me')
  } finally {
    fs.rmSync(blocked, { recursive: true, force: true })
  }

  // ---- a list of people that is there but cannot be read is not taken for nobody: everyone on it would be replaced by one new person
  const torn = before('torn')
  try {
    assert.equal(startOn(torn).status, 0)
    fs.writeFileSync(path.join(torn, 'people.json'), '[{ "name": "an')
    const refused = startOn(torn)
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /people\.json is not a list of the people with bots on this computer/)
    assert.equal(fs.readFileSync(path.join(torn, 'people.json'), 'utf8'), '[{ "name": "an')
    // Gone altogether, with the note for versions from before still there: the note is not taken for anyone's data.
    fs.rmSync(path.join(torn, 'people.json'))
    const [name] = fs.readdirSync(path.join(torn, 'people'))
    assert.equal(startOn(torn, { OPENKUMI_NAME: 'Someone Else' }).status, 0)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(torn, 'people.json'), 'utf8')), [{ name, port: USUAL }])
    assert.ok(!fs.existsSync(path.join(torn, 'people', name, 'openkumi.db')) && fs.existsSync(path.join(torn, 'openkumi.db')))
  } finally {
    fs.rmSync(torn, { recursive: true, force: true })
  }
})

test('“start” runs everyone’s servers in one terminal, starts one again when it stops to update, and stops them all together', async () => {
  // ---- two people, and one command: a server for each, what each prints under its person's name
  const both = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-start-'))
  const port = PORT + 8
  const its = { ...env, OPENKUMI_HOME: both, OPENKUMI_PORT: String(port), OPENKUMI_HOOKS_PORT: '', OPENKUMI_NAME: 'juan' }
  const answers = (at) => fetch(`http://127.0.0.1:${at}/api/hello`).then((r) => r.ok, () => false)
  const until = async (check, what) => {
    for (let tries = 0; tries < 300; tries++) {
      if (await check()) return
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`Not in time: ${what}`)
  }
  /** Runs `openkumi start` with these words after it. What it printed so far is `said()`. */
  const started = (more, words = []) => {
    const run = spawn(process.execPath, ['src/cli.ts', 'start', ...words], { env: { ...its, ...more }, stdio: ['ignore', 'pipe', 'pipe'] })
    running.add(run)
    let said = ''
    run.stdout.on('data', (d) => (said += d))
    run.stderr.on('data', (d) => (said += d))
    // Once it has ended and all it printed has been read.
    const ended = new Promise((resolve) => run.on('close', (code) => (running.delete(run), resolve(code))))
    return { run, ended, said: () => said }
  }
  try {
    assert.equal(spawnSync(process.execPath, ['src/cli.ts', 'people', 'add', 'ana'], { env: its, encoding: 'utf8' }).status, 0)
    const ana = JSON.parse(fs.readFileSync(path.join(both, 'people.json'), 'utf8'))[1]
    const everyone = started()
    await until(async () => (await answers(port)) && (await answers(ana.port)), 'both servers answer')
    assert.match(everyone.said(), new RegExp(`^juan \\| +The OpenKumi server is running at http://127\\.0\\.0\\.1:${port}$`, 'm'))
    assert.match(everyone.said(), new RegExp(`^ana \\| +The OpenKumi server is running at http://127\\.0\\.0\\.1:${ana.port}$`, 'm'))
    // Asked to stop, it stops them both, and ends once they have closed their data.
    everyone.run.kill('SIGTERM')
    assert.equal(await everyone.ended, 0)
    assert.deepEqual([await answers(port), await answers(ana.port)], [false, false])
    assert.ok(!fs.existsSync(path.join(both, 'people', 'ana', 'openkumi.db-wal')) && !fs.existsSync(path.join(both, 'people', 'juan', 'openkumi.db-wal')), 'each closed its database')

    // ---- with a name after it, only that person's, printing as a single server always has
    const one = started({}, ['--for', 'ana'])
    await until(() => answers(ana.port), 'her server answers')
    assert.equal(await answers(port), false)
    assert.match(one.said(), new RegExp(`^ +The OpenKumi server is running at http://127\\.0\\.0\\.1:${ana.port}$`, 'm'))

    // ---- someone whose server already runs is left to that: a second one is never started on their data
    const rest = started()
    await until(() => answers(port), 'the first person’s server answers')
    assert.match(rest.said(), /^ana \| Their server is already running on this computer, and is left as it is\.$/m)
    assert.doesNotMatch(rest.said(), /ana \| .*running at/)
    // Nor by starting the server itself: it stops before it has loaded anything that touches the data.
    const second = spawnSync(process.execPath, ['src/index.ts', '--for', 'ana'], { env: its, encoding: 'utf8' })
    assert.equal(second.status, 1)
    assert.match(second.stderr, /ana’s OpenKumi server is already running on this computer: its data is open\. This one was not started\./)
    assert.doesNotMatch(second.stdout + second.stderr, /running at|already in use/)
    assert.equal(await answers(ana.port), true, 'the one that was running was not disturbed')
    rest.run.kill('SIGTERM')
    one.run.kill('SIGTERM')
    assert.deepEqual([await rest.ended, await one.ended], [0, 0])

    // ---- the same when it is the first person's that already runs, as when a background service keeps it running: those started after are still this command's to stop
    const mine = started({}, ['--for', 'juan'])
    await until(() => answers(port), 'the first person’s server answers')
    const others = started()
    await until(() => answers(ana.port), 'her server answers')
    assert.match(others.said(), /^juan \| Their server is already running on this computer, and is left as it is\.$/m)
    others.run.kill('SIGTERM')
    assert.equal(await others.ended, 0)
    assert.deepEqual([await answers(ana.port), await answers(port)], [false, true], 'hers was stopped with the command that started it, and the one it left alone goes on')
    // And with everyone's running already, there is nothing for it to do: it says so and ends.
    const again = started({}, ['--for', 'juan'])
    assert.equal(await again.ended, 0)
    assert.match(again.said(), /juan’s server is already running on this computer, and is left as it is\./)
    mine.run.kill('SIGTERM')
    assert.equal(await mine.ended, 0)

    // ---- an installed OpenKumi: a server that stops to update is started again, in the version that is current then
    // A stand-in for the installed program: each start writes down whose it is, and the first start of each stops as a server does to update.
    const runtime = path.join(both, 'installed')
    fs.mkdirSync(path.join(runtime, 'current', 'server', 'src'), { recursive: true })
    fs.symlinkSync(process.execPath, path.join(runtime, 'current', 'node'))
    const starts = path.join(both, 'starts.txt')
    fs.writeFileSync(
      path.join(runtime, 'current', 'server', 'src', 'index.ts'),
      `import fs from 'node:fs'
       const who = process.argv[process.argv.indexOf('--for') + 1]
       const before = fs.existsSync(${JSON.stringify(starts)}) ? fs.readFileSync(${JSON.stringify(starts)}, 'utf8').split('\\n').filter((line) => line === who).length : 0
       // Which process it is, put in place in one step and before the start is written down: whoever has seen the start reads this process, whole.
       fs.writeFileSync(${JSON.stringify(path.join(both, 'pid-'))} + who + '.next', String(process.pid))
       fs.renameSync(${JSON.stringify(path.join(both, 'pid-'))} + who + '.next', ${JSON.stringify(path.join(both, 'pid-'))} + who)
       fs.appendFileSync(${JSON.stringify(starts)}, who + '\\n')
       if (!before) process.exit(75)
       if (who === 'ana') {
         process.stderr.write('no end of line')
         process.exit(3)
       }
       process.on('SIGTERM', () => process.exit(0))
       setInterval(() => {}, 1000)`,
    )
    const installed = started({ OPENKUMI_RUNTIME: runtime })
    const count = (who) => (fs.existsSync(starts) ? fs.readFileSync(starts, 'utf8').split('\n').filter((line) => line === who).length : 0)
    /** Ends a stand-in server as the system would. Never anything but the one process it wrote down. */
    const end = (who) => {
      const pid = Number(fs.readFileSync(path.join(both, `pid-${who}`), 'utf8'))
      assert.ok(Number.isInteger(pid) && pid > 1, `the process of ${who}’s stand-in`)
      process.kill(pid, 'SIGKILL')
    }
    await until(() => count('juan') === 2 && count('ana') === 2, 'each was started again after it stopped to update')
    // One that stops for another reason is not started again, and says so; the other goes on.
    await until(() => /ana \| This server has stopped \(3\)\. The others go on\./.test(installed.said()), 'it says the one has stopped')
    assert.match(installed.said(), /^ana \| no end of line$/m, 'what it printed last is shown, whether or not it ended the line')
    await new Promise((r) => setTimeout(r, 500))
    assert.deepEqual([count('juan'), count('ana')], [2, 2])
    // One ended by something else (the system, out of memory) is said too. With none left, it ends by itself, with what the first that stopped badly ended with.
    end('juan')
    assert.equal(await installed.ended, 3)
    assert.match(installed.said(), /^juan \| This server has stopped \(SIGKILL\)\. The others go on\.$/m)
    // A single server ended from outside is said too: it had no chance to say why itself.
    const single = started({ OPENKUMI_RUNTIME: runtime }, ['--for', 'juan'])
    await until(() => count('juan') === 3, 'the one server was started')
    end('juan')
    assert.equal(await single.ended, 1)
    assert.match(single.said(), /The server was ended \(SIGKILL\)\./)
  } finally {
    for (const run of running) run.kill('SIGKILL')
    fs.rmSync(both, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
