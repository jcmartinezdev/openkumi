// The people with bots on one computer (src/people.ts). Each has a server of their own, with a
// data folder of its own under people/ and a port of its own, started with `--for <name>`. The
// first is made when OpenKumi first starts and is the one meant when no name is given. Two are
// run side by side here, and neither shows the other's bots.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const PORT = 5400 + Math.floor(Math.random() * 40) * 10
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-people-'))
// The port and the webhooks port chosen here are the first person's server's. Nobody else's takes them.
const env = { ...process.env, OPENKUMI_HOME: home, OPENKUMI_PORT: String(PORT), OPENKUMI_HOOKS_PORT: String(PORT + 5), OPENKUMI_MOCK: '1', OPENKUMI_RUNTIME: '' }

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
  assert.deepEqual([listed().length, me.port], [1, 4317], 'written down with the usual port, which this test’s own choice stands in for')
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
  assert.equal((await theirs.api('GET', '/api/state')).settings.lan, false)
  const list = openkumi('people').said
  assert.match(list, new RegExp(`juan +port ${PORT} +running`))
  assert.match(list, new RegExp(`ana +port ${ana.port} +running`))
  assert.match(list, new RegExp(`leo +port ${leo.port} +not running`))
  assert.match(openkumi('people', 'add', 'eve', '--for', 'ana').said, /leave out “--for”/)
  assert.match(openkumi('people', 'rename', 'ana', 'anna').said, /is running, started by hand/, 'a folder is not moved from under a server that has it open')

  // ---- taken off the list, what their server held stays, and is theirs again when they are added again
  const removed = openkumi('people', 'remove', 'ana')
  assert.equal(removed.code, 0, removed.said)
  assert.match(removed.said, /started by hand and is still running/)
  await theirs.stop()
  await mine.stop()
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

  // ---- the last one cannot be removed, and when the first one goes the next is the one meant
  assert.equal(openkumi('people', 'remove', 'leo').code, 0)
  assert.match(openkumi('people', 'remove', 'juan').said, /A command with no name after it is about anna’s server from now on/)
  assert.match(openkumi('people', 'remove', 'anna').said, /is the only one with bots here/)
  assert.deepEqual(listed().map((p) => p.name), ['anna'])
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
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(asked, 'people.json'), 'utf8')), [{ name: 'maria-jose', port: 4317 }])
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
    const computer = os.hostname().replace(/\.local$/, '')
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
    assert.deepEqual(command('remove', 'maria-jose'), { error: 'maria-jose is the only one with bots here. “openkumi uninstall” removes OpenKumi from this computer.' })
  } finally {
    server.kill('SIGTERM')
    await new Promise((r) => server.on('exit', r))
    fs.rmSync(asked, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})

test('what a server from before kept in the folder itself is not moved from under it while it runs', async () => {
  // A folder as it was before each person had one of their own in it, and a stand-in for the server that still has it open.
  const old = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-before-'))
  fs.mkdirSync(path.join(old, 'bots', 'b_1'), { recursive: true })
  fs.writeFileSync(path.join(old, 'auth.json'), JSON.stringify({ accessToken: 'keep-me' }))
  const port = PORT + 7
  const before = http.createServer((_, res) => res.end(JSON.stringify({ app: 'openkumi', home: old })))
  await new Promise((resolve) => before.listen(port, '127.0.0.1', resolve))
  // Not waited for in one go: the stand-in has to be able to answer meanwhile.
  const run = (...args) =>
    new Promise((resolve) => {
      const ran = spawn(process.execPath, ['src/cli.ts', ...args], { env: { ...env, OPENKUMI_HOME: old, OPENKUMI_PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] })
      let stderr = ''
      ran.stderr.on('data', (d) => (stderr += d))
      ran.on('exit', (status) => resolve({ status, stderr }))
    })
  try {
    const refused = await run('people')
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /An OpenKumi server from before this version is running on this computer/)
    assert.deepEqual(fs.readdirSync(old).sort(), ['auth.json', 'bots'], 'nothing was moved or made')

    // Once it has stopped, all of it becomes the first person's.
    await new Promise((resolve) => before.close(resolve))
    assert.equal((await run('people')).status, 0)
    const [{ name }] = JSON.parse(fs.readFileSync(path.join(old, 'people.json'), 'utf8'))
    assert.deepEqual(fs.readdirSync(old).sort(), ['openkumi.db', 'people', 'people.json'])
    assert.ok(fs.existsSync(path.join(old, 'people', name, 'bots', 'b_1')))
    assert.equal(JSON.parse(fs.readFileSync(path.join(old, 'people', name, 'auth.json'), 'utf8')).accessToken, 'keep-me')
  } finally {
    before.close()
    fs.rmSync(old, { recursive: true, force: true })
  }
})
