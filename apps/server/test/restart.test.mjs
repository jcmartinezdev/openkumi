// What the server keeps when it stops and starts again: each test runs its own server on a data
// folder of its own, and stops and starts it.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const PORT = 5000 + Math.floor(Math.random() * 90)

/** Starts the server on the data in `home`. `stop` shuts it down the way the desktop app does. */
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
  return { api, stop: () => (server.kill('SIGTERM'), exited) }
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
