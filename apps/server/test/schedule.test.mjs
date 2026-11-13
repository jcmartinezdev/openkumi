// Scheduled tasks across time: runs that fell due while OpenKumi was not running, and times of day
// across a change of the clocks. Each test has a data folder of its own.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'

const PORT = 5000 + Math.floor(Math.random() * 90)
const fixture = (name) => path.resolve('test/fixtures', name)

async function withServer(home, fn) {
  const server = spawn(process.execPath, ['src/index.ts'], {
    env: {
      ...process.env,
      OPENKUMI_HOME: home,
      OPENKUMI_PORT: String(PORT),
      OPENKUMI_MOCK: '1',
      OPENKUMI_CLAUDE_BIN: fixture('fake-claude.mjs'),
      OPENKUMI_CODEX_BIN: fixture('fake-codex.mjs'),
      OPENKUMI_GROK_BIN: fixture('fake-grok.mjs'),
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('running at') && resolve())
    server.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
  try {
    const token = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).accessToken
    const api = async (method, url, body) =>
      (await fetch(`http://127.0.0.1:${PORT}${url}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })).json()
    return await fn(api)
  } finally {
    server.kill('SIGTERM')
    await new Promise((r) => server.on('exit', r))
  }
}

async function until(check, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error('Condition was not met in time')
    await new Promise((r) => setTimeout(r, 100))
  }
}

test('runs that fell due while OpenKumi was off: a time of day long past is missed, the others run late, and a run cut off is stopped', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-schedule-'))
  try {
    const botId = await withServer(home, async (api) => {
      const [main] = (await api('GET', '/api/state')).bots
      await api('PATCH', `/api/bots/${main.id}`, { provider: 'mock' })
      return main.id
    })

    // Written while the server is not running, as if the computer had been asleep.
    const now = Date.now()
    const db = new DatabaseSync(path.join(home, 'openkumi.db'))
    const add = (id, schedule, nextRunAt, lastStatus = null) =>
      db.prepare(
        `INSERT INTO tasks (id, bot_id, title, prompt, schedule, enabled, created_by, next_run_at, last_run_at, last_status, last_error, last_thread_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 'user', ?, NULL, ?, NULL, NULL, ?, ?)`,
      ).run(id, botId, id, `do ${id}`, JSON.stringify(schedule), nextRunAt, lastStatus, now, now)
    const at = (minutesAgo) => new Date(now - minutesAgo * 60_000)
    const clock = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    add('long-past', { type: 'daily', time: clock(at(120)), days: [] }, at(120).getTime())
    add('just-past', { type: 'daily', time: clock(at(2)), days: [] }, at(2).getTime())
    add('hourly', { type: 'interval', minutes: 60 }, now - 3 * 3_600_000)
    add('once', { type: 'once', at: now - 3_600_000 }, now - 3_600_000)
    add('cut-off', { type: 'interval', minutes: 60 }, now + 3_600_000, 'running')
    db.close()

    await withServer(home, async (api) => {
      const tasks = await until(async () => {
        const all = (await api('GET', '/api/tasks')).filter((t) => t.id !== 'cut-off')
        return all.every((t) => t.lastStatus && t.lastStatus !== 'running') && all
      })
      const of = (id) => tasks.find((t) => t.id === id)
      assert.equal(of('long-past').lastStatus, 'missed')
      assert.ok(of('long-past').nextRunAt > Date.now() + 20 * 3_600_000, 'the next one is tomorrow')
      assert.equal(of('just-past').lastStatus, 'completed', 'a few minutes late is still on time')
      assert.equal(of('hourly').lastStatus, 'completed')
      assert.ok(Math.abs(of('hourly').nextRunAt - (Date.now() + 3_600_000)) < 60_000, 'it carries on an hour from now')
      assert.deepEqual([of('once').lastStatus, of('once').nextRunAt], ['completed', null])
      assert.equal((await api('GET', '/api/tasks')).find((t) => t.id === 'cut-off').lastStatus, 'stopped')

      // Each run that happened reported to the bot's conversation; the missed one did not run at all.
      const { threads } = await api('GET', '/api/state')
      assert.deepEqual(threads.filter((t) => t.kind === 'task').map((t) => t.taskId).sort(), ['hourly', 'just-past', 'once'])
    })
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})

test('a time of day stays that time across a change of the clocks', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-schedule-'))
  try {
    const script = `
      const { nextRun } = await import('./src/tasks.ts')
      const after = (y, m, d, h) => new Date(y, m, d, h).getTime()
      const show = (t) => { const d = new Date(t); return [d.getDate(), d.getHours(), d.getMinutes()].join(' ') }
      console.log(JSON.stringify([
        show(nextRun({ type: 'daily', time: '08:00', days: [] }, after(2026, 9, 24, 9))),
        show(nextRun({ type: 'daily', time: '08:00', days: [1] }, after(2026, 9, 24, 9))),
        show(nextRun({ type: 'daily', time: '08:00', days: [] }, after(2026, 2, 28, 9))),
      ]))
      process.exit(0)
    `
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: 'Europe/Berlin', OPENKUMI_HOME: home }, encoding: 'utf8' })
    assert.equal(out.status, 0, out.stderr)
    // Summer time ends on 25 October 2026 and begins on 29 March 2026 in Berlin.
    assert.deepEqual(JSON.parse(out.stdout), ['25 8 0', '26 8 0', '29 8 0'])
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
})
