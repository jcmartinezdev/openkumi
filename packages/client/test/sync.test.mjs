// The store that every app shares, against a real server: catching up after the connection drops,
// and the copy kept on the device. Each scenario (catch-up.ts, copies.ts) is bundled and run in a
// process of its own, as each app has one store; this file starts the server for them.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { build } from 'esbuild'

const PORT = 5100 + Math.floor(Math.random() * 90)
const SERVER = path.resolve(import.meta.dirname, '../../../apps/server')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-client-test-'))
const home = path.join(out, 'home')
let server = null

async function start() {
  server = spawn(process.execPath, ['src/index.ts'], {
    cwd: SERVER,
    env: { ...process.env, OPENKUMI_HOME: home, OPENKUMI_PORT: String(PORT), OPENKUMI_MOCK: '1' },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const exited = new Promise((resolve) => server.on('exit', resolve))
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('running at') && resolve())
    exited.then((code) => reject(new Error(`server exited with ${code}`)))
  })
  server.exited = exited
}
async function stop() {
  server?.kill('SIGTERM')
  await server?.exited
  server = null
}

/** Runs a scenario in a process of its own; it fails the test by exiting with an error. */
async function run(scenario, ...args) {
  const bundle = path.join(out, `${scenario}.mjs`)
  if (!fs.existsSync(bundle)) {
    await build({ entryPoints: [path.join(import.meta.dirname, `${scenario}.ts`)], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'warning' })
  }
  const child = spawn(process.execPath, [bundle, ...args], { stdio: ['ignore', 'inherit', 'pipe'] })
  let errors = ''
  child.stderr.on('data', (d) => (errors += d))
  const code = await new Promise((resolve) => child.on('exit', resolve))
  assert.equal(code, 0, errors)
}

before(async () => {
  fs.mkdirSync(home)
  await start()
})

after(async () => {
  await stop()
  fs.rmSync(out, { recursive: true, force: true })
})

test('the store catches up on what happened while it was away, a chat at a time, and keeps what it held', () => run('catch-up', home, String(PORT)))

test('a copy kept on the device is shown before the server answers and while it cannot be reached, and is not taken for another database', async () => {
  const shelf = path.join(out, 'shelf')
  fs.mkdirSync(shelf)
  await run('copies', 'first', home, String(PORT), shelf)
  await run('copies', 'second', home, String(PORT), shelf)
  // The server's data is started afresh: a new database, the same server.
  await stop()
  for (const file of fs.readdirSync(home)) if (file.startsWith('openkumi.db')) fs.rmSync(path.join(home, file))
  await start()
  await run('copies', 'third', home, String(PORT), shelf)
})
