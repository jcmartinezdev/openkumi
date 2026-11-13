// What the server keeps when it stops and starts again: each test runs its own server on a data
// folder of its own, and stops and starts it.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const PORT = 5000 + Math.floor(Math.random() * 90)

/** Starts the server on the data in `home`. `stop` shuts it down the way the desktop app does; `kill` as a crash would. */
async function start(home) {
  const server = spawn(process.execPath, ['src/index.ts'], {
    env: { ...process.env, OPENKUMI_HOME: home, OPENKUMI_PORT: String(PORT), OPENKUMI_MOCK: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const exited = new Promise((resolve) => server.on('exit', resolve))
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('running at') && resolve())
    exited.then((code) => reject(new Error(`server exited with ${code}`)))
  })
  const token = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).accessToken
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
  return { api, stop: () => (server.kill('SIGTERM'), exited), kill: () => (server.kill('SIGKILL'), exited) }
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
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-restart-'))
  try {
    await fn(home)
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
}

test('a reply being written when the server shuts down is kept as it stood', () =>
  withHome(async (home) => {
    let server = await start(home)
    const bot = await server.api('POST', '/api/bots', { name: 'Writer', provider: 'mock' })
    const thread = await server.api('POST', `/api/bots/${bot.id}/messages`, { text: '!drip one two three four five six seven eight nine ten' })
    await until(async () => (await server.api('GET', `/api/threads/${thread.id}`)).partial.text.includes('two'))
    await server.stop()

    server = await start(home)
    try {
      const { thread: after, items } = await server.api('GET', `/api/threads/${thread.id}`)
      assert.equal(after.status, 'idle')
      const cut = items.at(-2).data
      assert.deepEqual([cut.role, cut.stopped], ['assistant', true])
      assert.match(cut.text, /^one two/)
      assert.deepEqual(items.at(-1).data, { type: 'notice', level: 'info', text: 'Stopped.' })
    } finally {
      await server.stop()
    }
  }))

test('an app that has seen up to a change is sent only what changed after it, and what was removed', () =>
  withHome(async (home) => {
    const server = await start(home)
    try {
      const bot = await server.api('POST', '/api/bots', { name: 'Talker', provider: 'mock' })
      const before = await server.api('GET', '/api/state')
      assert.ok(before.database.startsWith('db_'))
      assert.equal(before.removed, undefined, 'without a change number, the whole list')

      const thread = await server.api('POST', `/api/bots/${bot.id}/messages`, { text: 'hello' })
      await until(async () => (await server.api('GET', `/api/threads/${thread.id}`)).thread.status === 'idle')
      const since = await server.api('GET', `/api/state?since=${before.seq}&db=${before.database}`)
      assert.deepEqual(since.threads.map((t) => t.id), [thread.id])
      assert.deepEqual(since.removed, [])
      assert.ok(since.seq > before.seq)
      const unchanged = await server.api('GET', `/api/state?since=${since.seq}&db=${before.database}`)
      assert.deepEqual([unchanged.threads, unchanged.removed, unchanged.seq], [[], [], since.seq])

      await server.api('DELETE', `/api/threads/${thread.id}`)
      const after = await server.api('GET', `/api/state?since=${since.seq}&db=${before.database}`)
      assert.deepEqual([after.threads, after.removed], [[], [thread.id]])
      // A change number from another database means nothing here.
      const other = await server.api('GET', `/api/state?since=${since.seq}&db=db_elsewhere`)
      assert.equal(other.removed, undefined)
    } finally {
      await server.stop()
    }
  }))

test('a thread left running by a crash is idle when the server starts again, and an app is told so', () =>
  withHome(async (home) => {
    let server = await start(home)
    const bot = await server.api('POST', '/api/bots', { name: 'Crasher', provider: 'mock' })
    const thread = await server.api('POST', `/api/bots/${bot.id}/messages`, { text: '!drip a b c d e f g h i j k l m n o p' })
    await until(async () => (await server.api('GET', `/api/threads/${thread.id}`)).partial.text.includes('b'))
    const { seq, database } = await server.api('GET', '/api/state')
    await server.kill()

    server = await start(home)
    try {
      const since = await server.api('GET', `/api/state?since=${seq}&db=${database}`)
      assert.equal(since.database, database, 'the same database, so the app keeps what it has')
      assert.deepEqual(since.threads.map((t) => [t.id, t.status]), [[thread.id, 'idle']])
    } finally {
      await server.stop()
    }
  }))

test('a thread is caught up from its last item, or sent its newest page when too much came', () =>
  withHome(async (home) => {
    const server = await start(home)
    try {
      await server.api('PATCH', '/api/settings', { maxSteps: 300 })
      const bot = await server.api('POST', '/api/bots', { name: 'Busy', provider: 'mock' })
      const thread = await server.api('POST', `/api/bots/${bot.id}/messages`, { text: 'first' })
      const idle = () => until(async () => (await server.api('GET', `/api/threads/${thread.id}`)).thread.status === 'idle', 60_000)
      await idle()
      const held = (await server.api('GET', `/api/threads/${thread.id}`)).items
      await server.api('POST', `/api/threads/${thread.id}/messages`, { text: 'second' })
      await idle()
      const caught = await server.api('GET', `/api/threads/${thread.id}?after=${held.at(-1).id}`)
      assert.deepEqual([caught.gap, caught.items.map((i) => i.data.text)], [false, ['second', 'Echo: second']])

      // 1 + 210 calls + 210 results + 1 reply: more than a page holds.
      await server.api('POST', `/api/threads/${thread.id}/messages`, { text: '!steps 210' })
      await idle()
      const behind = await server.api('GET', `/api/threads/${thread.id}?after=${held.at(-1).id}`)
      assert.equal(behind.gap, true)
      assert.equal(behind.items.at(-1).data.text, 'Done in 210 steps.')
      assert.equal(behind.items.length, 400, 'one turn longer than a page is cut where the page is full')
      assert.equal(behind.more, true)
    } finally {
      await server.stop()
    }
  }))
