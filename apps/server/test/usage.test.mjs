// What the usage pages are told (src/usage.ts): the tokens each bot's model used, by provider and
// model, what they would have cost as API calls, and how much of each plan is used. Each test runs
// its own server, on the tests' stand-ins for the engines, with a stand-in for the list of prices.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

/** A server keeps its data in the folder of the person it runs for: here the first one, made when it first starts. */
const dataOf = (home) => path.join(home, 'people', JSON.parse(fs.readFileSync(path.join(home, 'people.json'), 'utf8'))[0].name)

const PORT = 5300 + Math.floor(Math.random() * 90)
const running = new Set()

/** The stand-in for the list of prices, as LiteLLM writes it: dollars a token, and more about each model than is needed. */
const LIST = {
  sample_spec: { input_cost_per_token: 0, output_cost_per_token: 0, mode: 'one of: chat, embedding' },
  'fake-model': { input_cost_per_token: 0.000001, cache_read_input_token_cost: 0.0000001, output_cost_per_token: 0.00001, mode: 'chat', max_input_tokens: 1000 },
  'some-picture-model': { input_cost_per_token: 0.5, output_cost_per_token: 0.5, mode: 'image_generation' },
  'xai/grok-9': { input_cost_per_token: 0.000002, output_cost_per_token: 0.000006, mode: 'chat' },
}
let fetched = 0
const list = http.createServer((_, res) => {
  fetched++
  res.writeHead(200, { 'Content-Type': 'text/plain' }).end(JSON.stringify(LIST))
})
await new Promise((resolve) => list.listen(0, '127.0.0.1', resolve))
after(() => list.close())
const PRICES = `http://127.0.0.1:${list.address().port}/prices.json`

const fixture = (name) => path.resolve('test/fixtures', name)

async function start(home, env = {}) {
  const server = spawn(process.execPath, ['src/index.ts'], {
    env: { ...process.env, OPENKUMI_HOME: home, OPENKUMI_PORT: String(PORT), OPENKUMI_MOCK: '1', OPENKUMI_TELEMETRY: '0', OPENKUMI_PRICES_URL: PRICES, OPENKUMI_CLAUDE_BIN: fixture('fake-claude.mjs'), OPENKUMI_CODEX_BIN: fixture('fake-codex.mjs'), ...env },
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
  const stop = async () => {
    server.kill('SIGTERM')
    const late = setTimeout(() => server.kill('SIGKILL'), 20_000)
    await exited
    clearTimeout(late)
  }
  return { api, stop }
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

async function withHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-usage-'))
  try {
    await fn(home)
  } finally {
    await Promise.all([...running].map((server) => new Promise((resolve) => (server.once('exit', resolve), server.kill('SIGKILL')))))
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}

/** Says something to a bot and waits until it has answered. */
async function say(server, bot, text) {
  const thread = await server.api('POST', `/api/bots/${bot.id}/messages`, { text })
  await until(async () => (await server.api('GET', `/api/threads/${thread.id}`)).thread.status === 'idle')
}

const HOUR = 60 * 60_000
/** When the hour a moment is counted under began, and the date of that on this computer's calendar, as the server has them. */
const hourOf = (time) => Math.floor(time / HOUR) * HOUR
const dateOf = (time) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(time)

/**
 * What was used as [provider, model, sent, from the cache, written, dollars], in a fixed order,
 * added up over the time shown: a test that runs as the hour or the day turns has its turns
 * counted under two of them.
 */
function table(usage) {
  const sums = new Map()
  for (const r of usage.rows) {
    const sum = sums.get(`${r.provider}\n${r.model}`) ?? [r.provider, r.model, 0, 0, 0, 0]
    sums.set(`${r.provider}\n${r.model}`, [r.provider, r.model, sum[2] + r.input, sum[3] + r.cached, sum[4] + r.output, sum[5] === null || r.cost === null ? null : sum[5] + r.cost])
  }
  return [...sums.values()].map((sum) => [...sum.slice(0, 5), sum[5] === null ? null : Number(sum[5].toFixed(6))]).sort((a, b) => a[0].localeCompare(b[0]))
}

test('what each bot’s model used is counted by provider and model, with what it would cost as API calls', () =>
  withHome(async (home) => {
    let server = await start(home)
    await until(async () => (await server.api('GET', '/api/state')).providers.filter((p) => p.connected).length >= 3)
    const before = await server.api('GET', '/api/usage')
    assert.deepEqual([before.rows, before.since], [[], null], 'something was counted before any bot ran')

    const began = Date.now()
    const bots = {}
    for (const provider of ['mock', 'claude-code', 'codex']) {
      bots[provider] = await server.api('POST', '/api/bots', { name: `On ${provider}`, provider, look: { creature: 'cat', color: 'sky', hat: 'none', extra: 'none', clothes: 'navy' } })
      // Twice: both engines count for the whole conversation, and the second turn must only add its own.
      for (const text of ['one', 'two']) await say(server, bots[provider], text)
    }

    const week = await server.api('GET', '/api/usage?days=7')
    assert.equal(week.step, 'day')
    assert.equal(week.starts.length, 7)
    for (const date of week.starts) assert.match(date, /^\d{4}-\d{2}-\d{2}$/)
    assert.deepEqual([...week.starts].sort(), week.starts, 'the days are not oldest first')
    // Each turn is under the day its hour began in: the hour the turns began in, or one that has begun since.
    // (Half an hour off the clock's hours, just after midnight, that is still the day before.)
    const days = [began, Date.now()].map((time) => week.starts.indexOf(dateOf(hourOf(time))))
    assert.ok(days.every((at) => at >= 5), 'the hour that is running is not in the last two days')
    for (const row of week.rows) assert.ok(days.includes(row.at), `something was counted under ${week.starts[row.at]}`)
    assert.deepEqual(table(week), [
      // Claude Code says what its turns would cost itself: a quarter of a dollar each.
      ['claude-code', 'claude-test-1', 200, 120, 20, 0.5],
      // Codex does not, so its tokens are priced from the list: 150 sent, 50 from the cache and 20 written, twice.
      ['codex', 'fake-model', 400, 100, 40, 0.00071],
      // The list has no such model.
      ['mock', 'mock-1', 24, 0, 6, null],
    ])
    assert.deepEqual([...new Set(week.rows.map((r) => r.botId))].sort(), Object.values(bots).map((b) => b.id).sort())
    // Counting began with the first turn: in the hour the turns began in, or one that has begun since.
    assert.ok(week.since >= hourOf(began) && week.since <= hourOf(Date.now()), 'counting did not begin with the first turn')
    assert.ok(Date.now() - week.pricedAt < 60_000, 'the prices were not fetched just now')

    // The last 24 hours, by the hour, the last of them the one that is running: all of it in the hours the turns ran in.
    const today = await server.api('GET', '/api/usage?days=1')
    assert.equal(today.step, 'hour')
    assert.equal(today.starts.length, 24)
    assert.ok([hourOf(began), hourOf(Date.now())].includes(Date.parse(today.starts[23])))
    const hours = [began, Date.now()].map((time) => today.starts.indexOf(new Date(hourOf(time)).toISOString()))
    for (const row of today.rows) assert.ok(hours.includes(row.at), `something was counted under ${today.starts[row.at]}`)
    assert.deepEqual(table(today), table(week))

    // Started again, the server still knows where Claude Code's count for the conversation stood: the next turn adds only itself.
    await server.stop()
    server = await start(home)
    await until(async () => (await server.api('GET', '/api/state')).providers.filter((p) => p.connected).length >= 3)
    await say(server, bots['claude-code'], 'three')
    assert.deepEqual(table(await server.api('GET', '/api/usage?days=30'))[0], ['claude-code', 'claude-test-1', 300, 180, 30, 0.75])
    // The prices are kept: a day has not passed, so they were fetched once.
    assert.equal(fetched, 1)
    assert.ok(fs.existsSync(path.join(dataOf(home), 'prices.json')))

    // Deleting a bot leaves what it used.
    await server.api('DELETE', `/api/bots/${bots.codex.id}`)
    assert.ok((await server.api('GET', '/api/usage')).rows.some((r) => r.botId === bots.codex.id))
  }))

test('a server that cannot reach the list of prices still counts, and says what Claude Code said its turns cost', () =>
  withHome(async (home) => {
    const server = await start(home, { OPENKUMI_PRICES_URL: 'http://127.0.0.1:9/nothing-listens-here.json' })
    await until(async () => (await server.api('GET', '/api/state')).providers.filter((p) => p.connected).length >= 3)
    for (const provider of ['claude-code', 'codex']) {
      const bot = await server.api('POST', '/api/bots', { name: `On ${provider}`, provider, look: { creature: 'cat', color: 'sky', hat: 'none', extra: 'none', clothes: 'navy' } })
      await say(server, bot, 'one')
    }
    const usage = await server.api('GET', '/api/usage')
    assert.equal(usage.pricedAt, null)
    assert.deepEqual(table(usage), [
      ['claude-code', 'claude-test-1', 100, 60, 10, 0.25],
      ['codex', 'fake-model', 200, 50, 20, null],
    ])
  }))

test('how much of each plan is used is asked of the engines’ own programs', () =>
  withHome(async (home) => {
    const server = await start(home)
    await until(async () => (await server.api('GET', '/api/state')).providers.filter((p) => p.connected).length >= 3)
    const limits = await server.api('GET', '/api/usage/limits')
    // Only the providers that have plans and can say: not the tests' own model.
    assert.deepEqual(limits.map((l) => l.provider).sort(), ['claude-code', 'codex'])
    const claude = limits.find((l) => l.provider === 'claude-code')
    assert.equal(claude.plan, 'Pro plan')
    assert.equal(claude.note, '')
    // No 5-hour session is under way, so none is listed; one model has a week's allowance of its own.
    assert.deepEqual(claude.limits, [
      { label: 'Week', used: 25, resetsAt: Date.parse('2030-01-07T13:00:00.000Z') },
      { label: 'Week, Opus only', used: 80.5, resetsAt: Date.parse('2030-01-07T13:00:00.000Z') },
    ])
    const codex = limits.find((l) => l.provider === 'codex')
    assert.equal(codex.plan, 'Plus plan')
    // This plan's only window is a week long, and is named for that; another model's allowance is not the plan's.
    assert.deepEqual(codex.limits, [{ label: 'Week', used: 3, resetsAt: 1893500000000 }])
    assert.ok(Date.now() - codex.checkedAt < 60_000)

    // Asked again within the minute, the programs are not started again.
    assert.equal((await server.api('GET', '/api/usage/limits')).find((l) => l.provider === 'codex').checkedAt, codex.checkedAt)
    assert.ok((await server.api('GET', '/api/usage/limits?fresh')).find((l) => l.provider === 'codex').checkedAt >= codex.checkedAt)
  }))

test('a Claude Code too old to say how much of its plan is used is said to be', () =>
  withHome(async (home) => {
    const server = await start(home, { OPENKUMI_FAKE_OLD_CLAUDE: '1' })
    await until(async () => (await server.api('GET', '/api/state')).providers.filter((p) => p.connected).length >= 3)
    const claude = (await server.api('GET', '/api/usage/limits')).find((l) => l.provider === 'claude-code')
    assert.deepEqual(claude.limits, [])
    assert.match(claude.note, /update it/i)
  }))

test('usage is laid out by the days of this computer’s calendar, and a model on this computer has no price', async () => {
  // The server's modules keep their data in OPENKUMI_HOME, so it is set before they are loaded.
  process.env.OPENKUMI_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-usage-'))
  process.env.OPENKUMI_PRICES_URL = PRICES
  after(() => fs.rmSync(process.env.OPENKUMI_HOME, { recursive: true, force: true }))
  const db = await import('../src/db.ts')
  const { usage, count } = await import('../src/usage.ts')
  const { parse } = await import('../src/prices.ts')

  // Only what is paid for by the token is kept of the list, and what is read from a cache costs as the rest when it has no price of its own.
  assert.deepEqual(parse(LIST), { 'fake-model': [0.000001, 0.0000001, 0.00001], 'xai/grok-9': [0.000002, 0.000002, 0.000006] })
  assert.deepEqual(parse('not a list'), {})

  // Noon today, on this computer's clock: the hour that holds it began on today's date however far the time zone is
  // off the clock's whole hours, and so did the hours 72 hours and forty days before it, whatever the clocks did since.
  const noon = new Date()
  noon.setHours(12, 0, 0, 0)
  const now = noon.getTime()
  const date = dateOf
  const one = { botId: 'a-bot', provider: 'codex', model: 'fake-model', costed: false, input: 1000, cached: 0, output: 0, cost: 0 }
  db.addUsage(one, now)
  db.addUsage(one, now)
  db.addUsage(one, now - 72 * HOUR)
  db.addUsage(one, now - 40 * 24 * HOUR)
  // A model on this computer, though the list has a price for one of its name; Grok's models, listed under their maker's name; one named as a service that passes requests on names it.
  db.addUsage({ ...one, provider: 'local' }, now)
  db.addUsage({ ...one, provider: 'grok', model: 'grok-9' }, now)
  db.addUsage({ ...one, provider: 'openai-compatible', model: 'x-ai/grok-9' }, now)
  // What a model did not name is counted as its provider's default; nothing used is not counted at all.
  // These are counted under the hour that is running, whichever that is.
  count('a-bot', 'codex', { model: '', input: 10.4, cached: 99, output: 0 })
  count('a-bot', 'codex', { model: 'never-ran', input: 0, cached: 0, output: 0 })

  const week = await usage(7, now)
  assert.equal(week.starts[6], date(now))
  const at = (time) => week.rows.filter((r) => r.at === week.starts.indexOf(date(time)))
  const row = (rows, provider, model) => rows.find((r) => r.provider === provider && r.model === model)
  assert.equal(row(at(now), 'codex', 'fake-model').input, 2000)
  assert.equal(Number(row(at(now), 'codex', 'fake-model').cost.toFixed(6)), 0.002)
  assert.equal(row(at(now - 72 * HOUR), 'codex', 'fake-model').input, 1000)
  assert.equal(row(at(now), 'local', 'fake-model').cost, null)
  assert.equal(Number(row(at(now), 'grok', 'grok-9').cost.toFixed(6)), 0.002)
  assert.equal(Number(row(at(now), 'openai-compatible', 'x-ai/grok-9').cost.toFixed(6)), 0.002)
  // No more can have come from a cache than was sent.
  assert.deepEqual([row(week.rows, 'codex', 'default').input, row(week.rows, 'codex', 'default').cached], [10, 10])
  assert.equal(row(week.rows, 'codex', 'never-ran'), undefined)
  // Forty days ago is not in a week, and is in ninety days.
  assert.equal(week.rows.reduce((sum, r) => sum + (r.model === 'fake-model' && r.provider === 'codex' ? r.input : 0), 0), 3000)
  const quarter = await usage(90, now)
  assert.equal(quarter.starts.length, 90)
  assert.equal(quarter.rows.reduce((sum, r) => sum + (r.model === 'fake-model' && r.provider === 'codex' ? r.input : 0), 0), 4000)
  assert.equal(new Set(quarter.starts).size, 90)
  db.closeDb()
})
