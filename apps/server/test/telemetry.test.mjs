// What the server tells OpenKumi's makers (src/telemetry.ts): nothing before its owner has agreed,
// nothing a person wrote or named at any time, and nothing again once it is switched off. Each
// test runs its own server, which sends to a stand-in for PostHog that keeps what it is sent.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

/** A server keeps its data in the folder of the person it runs for: here the first one, made when it first starts. */
const dataOf = (home) => path.join(home, 'people', JSON.parse(fs.readFileSync(path.join(home, 'people.json'), 'utf8'))[0].name)

const PORT = 5100 + Math.floor(Math.random() * 90)
const running = new Set()

/** The stand-in: every event of every batch it was sent, and the key each batch came with. */
const received = []
const keys = new Set()
const posthog = http.createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/batch/') {
      const { api_key, batch } = JSON.parse(body)
      keys.add(api_key)
      received.push(...batch)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":1}')
  })
})
await new Promise((resolve) => posthog.listen(0, '127.0.0.1', resolve))
after(() => posthog.close())
const ADDRESS = `http://127.0.0.1:${posthog.address().port}`

/** Starts a server on the data in `home`. With `sends: false` it is one run from its source like any other, which sends nothing. */
async function start(home, { sends = true, env = {} } = {}) {
  // Whatever the shell running the tests says about telemetry is not what these servers go by.
  const { DO_NOT_TRACK: _, OPENKUMI_TELEMETRY: __, OPENKUMI_TELEMETRY_URL: ___, OPENKUMI_TELEMETRY_KEY: ____, ...shell } = process.env
  const server = spawn(process.execPath, ['src/index.ts'], {
    env: { ...shell, OPENKUMI_HOME: home, OPENKUMI_PORT: String(PORT), OPENKUMI_MOCK: '1', ...(sends ? { OPENKUMI_TELEMETRY_URL: ADDRESS, OPENKUMI_TELEMETRY_KEY: 'phc_test' } : {}), ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const exited = new Promise((resolve) => server.on('exit', resolve))
  running.add(server)
  void exited.then(() => running.delete(server))
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('running at') && resolve())
    exited.then((code) => reject(new Error(`server exited with ${code}`)))
  })
  const token = JSON.parse(fs.readFileSync(path.join(dataOf(home), 'auth.json'), 'utf8')).accessToken
  async function api(method, url, body) {
    const res = await fetch(`http://127.0.0.1:${PORT}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json()
    if (!res.ok) throw new Error(`${method} ${url}: ${json.error}`)
    return json
  }
  /** Stopped the way the desktop app stops it: what was waiting to be sent goes out first. */
  const stop = async () => {
    server.kill('SIGTERM')
    const late = setTimeout(() => server.kill('SIGKILL'), 20_000)
    await exited
    clearTimeout(late)
  }
  return { api, stop, token }
}

async function until(check, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('Condition was not met in time')
    await new Promise((r) => setTimeout(r, 50))
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-telemetry-'))
  received.length = 0
  try {
    await fn(home)
  } finally {
    await Promise.all([...running].map((server) => new Promise((resolve) => (server.once('exit', resolve), server.kill('SIGKILL')))))
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}

/** A bot is made and answers a message, both named and worded so that either would stand out in what is sent. */
async function use(server) {
  const bot = await server.api('POST', '/api/bots', { name: 'Zanzibar', provider: 'mock' })
  const thread = await server.api('POST', `/api/bots/${bot.id}/messages`, { text: 'xylophone quartz' })
  await until(async () => (await server.api('GET', `/api/threads/${thread.id}`)).thread.status === 'idle')
  return { bot, thread }
}
const names = () => received.map((e) => e.event)

test('nothing is sent until the owner agrees, and then only what is listed', () =>
  withHome(async (home) => {
    const server = await start(home)
    const state = await server.api('GET', '/api/state')
    assert.deepEqual(state.about.telemetry, { can: true, why: '' })
    assert.equal(state.settings.telemetry, null)
    await use(server)
    await sleep(500)
    assert.deepEqual(received, [], 'something was sent before anyone was asked')
    assert.equal((await server.api('GET', '/api/telemetry')).id, null)

    await server.api('PATCH', '/api/settings', { telemetry: true })
    await until(() => received.length)
    // What happened before the answer goes too: the start of the server, and what was done since.
    for (const event of ['server started', 'daily summary', 'bot created', 'message sent', 'run finished']) assert.ok(names().includes(event), `${event} was not sent`)
    assert.deepEqual([...keys], ['phc_test'])
    const ids = new Set(received.map((e) => e.distinct_id))
    assert.equal(ids.size, 1)
    const [id] = ids
    assert.match(id, /^[0-9a-f-]{36}$/)
    for (const e of received) {
      assert.match(e.properties.version, /^\d+\.\d+\.\d+/)
      assert.equal(e.properties.how, 'source')
      assert.equal(e.properties.$process_person_profile, false)
    }
    // Neither the bot's name, nor what was said to it, nor where the data is kept.
    const all = JSON.stringify(received)
    for (const secret of ['Zanzibar', 'zanzibar', 'xylophone', 'quartz', home, os.homedir(), os.userInfo().username]) assert.ok(!all.includes(secret), `“${secret}” was sent`)

    const run = received.find((e) => e.event === 'run finished').properties
    assert.equal(run.outcome, 'done')
    assert.equal(run.engine, 'other')
    assert.equal(run.steps, 1)
    const summary = received.find((e) => e.event === 'daily summary').properties
    assert.equal(summary.bots, 1)
    // The first bot, which the server made: on the tests' own engine, which is none of the ones named.
    assert.deepEqual(summary.engines, ['other'])
    const made = received.filter((e) => e.event === 'bot created').map((e) => e.properties.by)
    assert.deepEqual(made, ['server', 'user'])

    // The owner can read what went, and it is what went.
    const report = await server.api('GET', '/api/telemetry')
    assert.equal(report.id, id)
    assert.deepEqual(report.sent.map((e) => e.event).sort(), names().sort())
    // And can have a new id, which what is sent next comes with.
    const fresh = await server.api('POST', '/api/telemetry/id')
    assert.notEqual(fresh.id, id)
    received.length = 0
    await use(server)
    await server.stop()
    assert.ok(received.length, 'what was waiting was not sent as the server stopped')
    assert.deepEqual([...new Set(received.map((e) => e.distinct_id))], [fresh.id])
  }))

test('a no drops what was waiting, and switching off later throws the id away', () =>
  withHome(async (home) => {
    let server = await start(home)
    await use(server)
    await server.api('PATCH', '/api/settings', { telemetry: false })
    await use(server)
    await server.stop()
    assert.deepEqual(received, [])
    assert.ok(!fs.existsSync(path.join(dataOf(home), 'logs', 'telemetry.ndjson')))

    // Agreed to after all: what happens from then on is sent, and the server has an id.
    server = await start(home)
    await server.api('PATCH', '/api/settings', { telemetry: true })
    await use(server)
    await server.stop()
    assert.ok(names().includes('run finished'))
    assert.ok(JSON.parse(fs.readFileSync(path.join(dataOf(home), 'telemetry.json'), 'utf8')).id)

    // Then switched off again.
    server = await start(home)
    await server.api('PATCH', '/api/settings', { telemetry: false })
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataOf(home), 'telemetry.json'), 'utf8')).id, undefined)
    assert.equal((await server.api('GET', '/api/telemetry')).id, null)
    received.length = 0
    await use(server)
    await server.stop()
    assert.deepEqual(received, [])
  }))

test('a server run from its source, or told not to where it is started, sends nothing and is not asked about', () =>
  withHome(async (home) => {
    let server = await start(home, { sends: false })
    let { about } = await server.api('GET', '/api/state')
    assert.equal(about.telemetry.can, false)
    assert.match(about.telemetry.why, /from its source/)
    // Even with a yes.
    await server.api('PATCH', '/api/settings', { telemetry: true })
    await use(server)
    await server.stop()
    assert.deepEqual(received, [])

    for (const env of [{ DO_NOT_TRACK: '1' }, { OPENKUMI_TELEMETRY: '0' }]) {
      server = await start(home, { env })
      ;({ about } = await server.api('GET', '/api/state'))
      assert.equal(about.telemetry.can, false)
      assert.match(about.telemetry.why, /switched off where this server is started/)
      await use(server)
      await server.stop()
      assert.deepEqual(received, [])
    }
  }))

test('an app is counted once a day, by what it says it is', () =>
  withHome(async (home) => {
    const server = await start(home)
    await server.api('PATCH', '/api/settings', { telemetry: true })
    const connect = (query) =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${server.token}${query}`)
        ws.onopen = () => (ws.close(), resolve())
        ws.onerror = reject
      })
    await connect('&app=desktop&appVersion=1.2.3&os=macos')
    await connect('&app=desktop&appVersion=1.2.3&os=macos')
    // One that says something that is not on the list, and one from before apps said anything.
    await connect('&app=%2FUsers%2Fsomeone&appVersion=one%20two&os=plan9')
    await connect('')
    await server.stop()
    const apps = received.filter((e) => e.event === 'app connected').map(({ properties: p }) => [p.app, p.app_version, p.app_os, p.local])
    assert.deepEqual(apps, [
      ['desktop', '1.2.3', 'macos', true],
      ['other', undefined, 'other', true],
      ['other', undefined, 'other', true],
    ])
  }))

test('a failed run is reported by where it failed, never by what the error said', () =>
  withHome(async (home) => {
    const server = await start(home)
    await server.api('PATCH', '/api/settings', { telemetry: true, maxSteps: 5 })
    const bot = await server.api('POST', '/api/bots', { name: 'Looper', provider: 'mock' })
    const thread = await server.api('POST', `/api/bots/${bot.id}/messages`, { text: '!steps 9' })
    await until(async () => (await server.api('GET', `/api/threads/${thread.id}`)).thread.status === 'error')
    // A tool that fails: a file that is not there, named so that it would stand out.
    const other = await server.api('POST', `/api/bots/${bot.id}/messages`, { text: '!tool read_file {"path":"marmalade.txt"}' })
    await until(async () => (await server.api('GET', `/api/threads/${other.id}`)).thread.status !== 'running')
    await server.stop()

    const run = received.find((e) => e.event === 'run finished' && e.properties.outcome === 'failed').properties
    assert.equal(run.error, 'src/agent.ts:turn')
    const exception = received.find((e) => e.event === '$exception').properties
    assert.deepEqual([exception.where, exception.error, exception.type], ['run', 'src/agent.ts:turn', 'Error'])
    const [listed] = exception.$exception_list
    assert.deepEqual([listed.type, listed.value, listed.mechanism.handled], ['Error', 'src/agent.ts:turn', true])
    assert.ok(listed.stacktrace.frames.length)
    for (const frame of listed.stacktrace.frames) {
      assert.match(frame.filename, /^src\/[\w./-]+\.ts$/)
      assert.equal(frame.platform, 'custom')
    }
    const tool = received.find((e) => e.event === 'tool failed')?.properties
    assert.equal(tool?.tool, 'read_file')
    const all = JSON.stringify(received)
    for (const secret of ['Stopped after', 'marmalade', home, os.homedir()]) assert.ok(!all.includes(secret), `“${secret}” was sent`)
  }))

test('what a crash left behind is reported at the next start, and only what the server itself would have written', () =>
  withHome(async (home) => {
    // The folder of the person whose server crashed, as it left it.
    fs.mkdirSync(path.join(home, 'people', 'ana'), { recursive: true })
    fs.writeFileSync(path.join(home, 'people.json'), JSON.stringify([{ name: 'ana', port: 4317 }]))
    fs.writeFileSync(
      path.join(dataOf(home), 'telemetry-crash.json'),
      JSON.stringify({
        type: 'TypeError',
        error: 'src/agent.ts:turn',
        version: '0.0.1',
        frames: [
          { file: 'src/agent.ts', fn: 'turn', line: 12, column: 3 },
          { file: '/Users/someone/secret place/x.ts', fn: 'a b', line: 1, column: 1 },
          { file: 'src/http.ts', fn: 'not a name!', line: 4, column: 2 },
        ],
      }),
    )
    const server = await start(home)
    assert.ok(!fs.existsSync(path.join(dataOf(home), 'telemetry-crash.json')))
    await server.api('PATCH', '/api/settings', { telemetry: true })
    await until(() => received.length)
    const crash = received.find((e) => e.event === '$exception').properties
    assert.deepEqual([crash.where, crash.type, crash.error], ['crash', 'TypeError', 'src/agent.ts:turn'])
    assert.deepEqual(crash.frames, ['src/agent.ts:turn:12', 'src/http.ts:<anonymous>:4'])
    assert.equal(crash.$exception_list[0].mechanism.handled, false)
    assert.ok(!JSON.stringify(received).includes('someone'))
    await server.stop()
  }))

test('the page in the docs is what the list of events says, and every event the code records is on the list', async () => {
  const { PAGE, page } = await import('../../docs/scripts/telemetry.mjs')
  assert.equal(fs.readFileSync(PAGE, 'utf8'), page(), 'The docs are behind the list of events. Run: node apps/docs/scripts/telemetry.mjs')
  const { EVENTS, SCREENS } = await import('../src/telemetry-events.ts')
  const listed = (fromApp) => Object.keys(EVENTS).filter((name) => (EVENTS[name].from === 'app') === fromApp).sort()
  // Each call that records an event names it; none names one that is not listed, and each listed one is recorded somewhere.
  const recorded = new Set()
  for (const file of fs.readdirSync('src')) {
    if (!file.endsWith('.ts')) continue
    for (const [, name] of fs.readFileSync(path.join('src', file), 'utf8').matchAll(/\b(?:track|record)\('([^']+)'/g)) recorded.add(name)
  }
  assert.deepEqual([...recorded].sort(), listed(false))
  // What the apps may record is what the server takes from them.
  const types = fs.readFileSync('../../packages/shared/src/types.ts', 'utf8')
  const apps = [...types.slice(types.indexOf('export type AppEvent')).split('\n\n')[0].matchAll(/event: '([^']+)'/g)].map(([, name]) => name)
  assert.deepEqual(apps.sort(), listed(true))
  // Every screen of the phone app has its name on the list; one that has not would be sent as "other".
  const routes = fs
    .readdirSync('../mobile/app', { recursive: true })
    .filter((file) => file.endsWith('.tsx') && !file.endsWith('_layout.tsx'))
    .map((file) => file.replaceAll(path.sep, '/').replace(/\.tsx$/, '').replace(/(^|\/)index$/, '') || 'home')
  assert.deepEqual(routes.filter((route) => !SCREENS.includes(route)), [])
})

test('what an app records about itself is sent by the server, checked like anything else', () =>
  withHome(async (home) => {
    const server = await start(home)
    await server.api('PATCH', '/api/settings', { telemetry: true })
    const earlier = new Date(Date.now() - 3600_000).toISOString()
    await server.api('POST', '/api/telemetry/events', {
      app: { app: 'iphone', version: '1.2.3', os: 'ios' },
      events: [
        { event: 'app opened', at: earlier, carries: { first: true, note: 'something else' } },
        { event: 'screen opened', at: earlier, carries: { screen: 'chat/[id]' } },
        // A screen that is not on the list, named after something a person might have written.
        { event: 'screen opened', carries: { screen: 'chat/holiday-plans' } },
        { event: 'app error', carries: { type: 'TypeError', position: 'main.jsbundle:1:2345' } },
        { event: 'app error', carries: { type: 'TypeError', position: 'could not read “my diary.txt”' } },
        // An app cannot pass itself off as the server, nor make up an event.
        { event: 'run finished', carries: { outcome: 'failed' } },
        { event: '$exception', carries: { where: 'crash' } },
        { event: 'toString' },
        { event: 'made up' },
        'not an event',
      ],
    })
    await server.stop()
    const fromApp = received.filter((e) => e.properties.app === 'iphone').map(({ event, timestamp, properties: { $process_person_profile, $lib, version, how, os, arch, ...carried } }) => [event, timestamp === earlier, carried])
    const app = { app: 'iphone', app_version: '1.2.3', app_os: 'ios' }
    assert.deepEqual(fromApp, [
      ['app opened', true, { first: true, ...app }],
      ['screen opened', true, { screen: 'chat/[id]', ...app }],
      ['screen opened', false, { screen: 'other', ...app }],
      ['app error', false, { type: 'TypeError', position: 'main.jsbundle:1:2345', ...app }],
      ['app error', false, { type: 'TypeError', ...app }],
    ])
    const all = JSON.stringify(received)
    for (const secret of ['holiday', 'diary', 'something else', 'made up']) assert.ok(!all.includes(secret), `“${secret}” was sent`)
    assert.ok(!received.some((e) => e.event === 'run finished' || e.event === '$exception'))
  }))

test('the tokens a run used are counted by model, as each engine reports them, and a conversation carried on is not counted twice', () =>
  withHome(async (home) => {
    const fixture = (name) => path.resolve('test/fixtures', name)
    const server = await start(home, { env: { OPENKUMI_CLAUDE_BIN: fixture('fake-claude.mjs'), OPENKUMI_CODEX_BIN: fixture('fake-codex.mjs') } })
    await server.api('PATCH', '/api/settings', { telemetry: true })
    await until(async () => (await server.api('GET', '/api/state')).providers.filter((p) => p.connected).length >= 3)
    for (const provider of ['mock', 'claude-code', 'codex']) {
      const bot = await server.api('POST', '/api/bots', { name: `On ${provider}`, provider, look: { creature: 'cat', color: 'sky', hat: 'none', extra: 'none', clothes: 'navy' } })
      // Twice: both engines count for the whole conversation, and the second turn must only add its own.
      for (const text of ['one', 'two']) {
        const thread = await server.api('POST', `/api/bots/${bot.id}/messages`, { text })
        await until(async () => (await server.api('GET', `/api/threads/${thread.id}`)).thread.status === 'idle')
      }
    }
    await server.stop()
    const tokens = received.filter((e) => e.event === 'tokens used').map((e) => e.properties)
    for (const p of tokens) assert.equal(p.total_tokens, p.input_tokens + p.output_tokens)
    const used = tokens.map((p) => [p.engine, p.model, p.input_tokens, p.cached_tokens, p.output_tokens])
    assert.deepEqual(used, [
      // A model that is not one of an engine's is not named.
      ['other', 'other', 12, 0, 3],
      ['other', 'other', 12, 0, 3],
      // By the name its maker gives it, not the one it goes by where it is run.
      ['claude-code', 'claude-test-1', 100, 60, 10],
      ['claude-code', 'claude-test-1', 100, 60, 10],
      ['codex', 'fake-model', 200, 50, 20],
      ['codex', 'fake-model', 200, 50, 20],
    ])
  }))

test('what a turn used is what its engine added to its own count, and a name that is not a model’s plain name is not sent', async () => {
  // The server's modules keep their data in OPENKUMI_HOME, so it is set before they are loaded.
  process.env.OPENKUMI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-telemetry-'))
  after(() => fs.rmSync(process.env.OPENKUMI_HOME, { recursive: true, force: true }))
  const { usedSince } = await import('../src/providers/types.ts')
  const { modelSent } = await import('../src/telemetry.ts')
  const at = (input, read, output) => ({ 'claude-x': { inputTokens: input, cacheReadInputTokens: read, cacheCreationInputTokens: 5, outputTokens: output } })
  // A new conversation: all of it. Then only what was added.
  assert.deepEqual(usedSince('s1', false, at(10, 20, 3)), [{ type: 'usage', model: 'claude-x', input: 35, cached: 20, output: 3 }])
  assert.deepEqual(usedSince('s1', true, at(15, 40, 7)), [{ type: 'usage', model: 'claude-x', input: 25, cached: 20, output: 4 }])
  assert.deepEqual(usedSince('s1', true, at(15, 40, 7)), [])
  // A count that started over (an older program counts each turn by itself) is taken as it is.
  assert.deepEqual(usedSince('s1', true, at(1, 0, 2)), [{ type: 'usage', model: 'claude-x', input: 6, cached: 0, output: 2 }])
  // A conversation from before the server started: its count so far is not this turn's.
  assert.deepEqual(usedSince('s2', true, at(1000, 0, 500)), [])
  assert.deepEqual(usedSince('s2', true, at(1010, 0, 501)), [{ type: 'usage', model: 'claude-x', input: 10, cached: 0, output: 1 }])
  assert.deepEqual(usedSince('s3', false, undefined), [])

  assert.equal(modelSent('claude-code', 'claude-opus-5-5'), 'claude-opus-5-5')
  assert.equal(modelSent('claude-code', 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude'), 'other')
  assert.equal(modelSent('codex', ''), 'default')
  assert.equal(modelSent('local', 'my-secret-model'), 'local')
  assert.equal(modelSent('openai-compatible', 'gpt-4o'), 'other')
})
