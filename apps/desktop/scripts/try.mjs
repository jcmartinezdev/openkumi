// Opens an OpenKumi that was packaged, the way someone who installed it would, and uses it: the
// window, the server the app starts, a bot on each kind of engine, and a bot's browser. The
// release runs this on every kind of computer the app is made for, before anything is published
// (.github/workflows/release.yml), because an app can be put together without a fault and still
// not open, or open and not find a program that is installed.
//
//   node apps/desktop/scripts/try.mjs <the program inside the app> [options]
//     --out <folder>   where a picture of the window and the server's log are left
//     --no-sandbox     for Linux computers that do not let an unpacked app use Chromium's sandbox
//     --browser        a bot's browser has to open too (Google Chrome is on this computer)
//     --hidden         keep the window and the bots' browsers off the screen
//
// Nothing here is the user's: the app's data and the server's are in a temporary folder, and
// the engines are scripted stand-ins (apps/server/test/fixtures). They are not handed to the
// server by their path, as the tests do: they are installed the way the real ones are, as
// `claude`, `codex` and `grok` on the PATH (on Windows as npm's launcher scripts), so that the
// server has to find and start them as it would the real ones.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { _electron } from 'playwright-core'

const args = process.argv.slice(2)
const program = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : ''
if (!program || !fs.existsSync(program)) {
  console.error('Say which program to open: node apps/desktop/scripts/try.mjs <the program inside the packaged app>')
  process.exit(2)
}
const has = (name) => args.includes(name)
const out = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(os.tmpdir(), 'openkumi-try'))
fs.mkdirSync(out, { recursive: true })

const WINDOWS = process.platform === 'win32'
const repo = path.resolve(import.meta.dirname, '..', '..', '..')
const version = JSON.parse(fs.readFileSync(path.join(repo, 'apps', 'server', 'package.json'), 'utf8')).version
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-try-'))
const home = path.join(tmp, 'home')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- the engines, installed as the real ones are

const bin = path.join(tmp, 'bin')
fs.mkdirSync(bin, { recursive: true })
for (const name of ['claude', 'codex', 'grok']) {
  const fixture = path.join(repo, 'apps', 'server', 'test', 'fixtures', `fake-${name}.mjs`)
  if (!WINDOWS) {
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`, { mode: 0o755 })
    continue
  }
  // What `npm install -g` leaves for a program that is a script for Node: the script among the
  // packages, a launcher beside them, and a script for other systems under the bare name.
  const scripts = path.join(bin, 'node_modules', 'stand-ins')
  fs.mkdirSync(scripts, { recursive: true })
  fs.copyFileSync(fixture, path.join(scripts, `${name}.mjs`))
  fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nexec node "$(dirname "$0")/node_modules/stand-ins/${name}.mjs" "$@"\n`)
  fs.writeFileSync(
    path.join(bin, `${name}.cmd`),
    [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      '',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ') ELSE (',
      '  SET "_prog=node"',
      '  SET PATHEXT=%PATHEXT:;.JS;=;%',
      ')',
      '',
      `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\stand-ins\\${name}.mjs" %*`,
      '',
    ].join('\r\n'),
  )
}

const freePort = () =>
  new Promise((resolve) => {
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
// Not the usual port: an OpenKumi that runs on this computer would be joined instead of the app starting its own.
const port = await freePort()

const env = {}
// Windows spells the variable "Path"; whichever spelling is there is the one replaced.
for (const [name, value] of Object.entries(process.env)) if (name.toUpperCase() !== 'PATH') env[name] = value
Object.assign(env, {
  PATH: [bin, process.env.PATH ?? ''].join(path.delimiter),
  OPENKUMI_DESKTOP_DATA: path.join(tmp, 'app'),
  OPENKUMI_DESKTOP_YES: '1',
  OPENKUMI_DESKTOP_HIDDEN: has('--hidden') ? '1' : '',
  OPENKUMI_HOME: home,
  OPENKUMI_PORT: String(port),
  // Brings the scripted model, which the bot that comes with OpenKumi then runs on.
  OPENKUMI_MOCK: '1',
})
// Nothing may point the server at an engine: it has to find them.
for (const name of ['ELECTRON_RUN_AS_NODE', 'OPENKUMI_DEV_URL', 'OPENKUMI_CLAUDE_BIN', 'OPENKUMI_CODEX_BIN', 'OPENKUMI_GROK_BIN', 'OPENKUMI_TAILSCALE_BIN']) delete env[name]

// ---- what is tried

let app
let win
const api = async (method, url, body) => {
  const token = JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).accessToken
  const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  const text = await res.text()
  assert.ok(res.ok, `${method} ${url} gave ${res.status}: ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}
const until = async (what, check, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const got = await check()
    if (got) return got
    if (Date.now() > deadline) throw new Error(`Waited ${timeoutMs / 1000} s for ${what}, and it did not come.`)
    await sleep(250)
  }
}
/** Says something to a bot and gives what it answered. */
const say = async (botId, text) => {
  const thread = await api('POST', `/api/bots/${botId}/messages`, { text })
  return until(`an answer to “${text.slice(0, 40)}”`, async () => {
    const got = await api('GET', `/api/threads/${thread.id}`)
    const mine = got.items.findLastIndex((item) => item.data.type === 'message' && item.data.role === 'user')
    const answer = got.items.slice(mine + 1).findLast((item) => item.data.type === 'message' && item.data.role === 'assistant')
    if (got.thread.status === 'running' || mine < 0) return null
    // A turn that failed leaves its reason where the answer would be.
    return answer?.data.text ?? `(no answer: ${JSON.stringify(got.items.at(-1)?.data).slice(0, 400)})`
  })
}

const steps = [
  ['The app opens and welcomes', async () => {
    app = await _electron.launch({ executablePath: program, args: has('--no-sandbox') ? ['--no-sandbox'] : [], env, timeout: 60_000 })
    win = await app.firstWindow()
    await win.locator('.welcome-start', { hasText: 'Run them on this computer' }).waitFor({ timeout: 60_000 })
    // The window's page is the app's own, from the app's own files.
    assert.equal(win.url(), 'openkumi://app/')
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true, 'this is a packaged app')
  }],
  ['It starts its own server, in the version it came with', async () => {
    await win.locator('.welcome-start', { hasText: 'Run them on this computer' }).click()
    await win.locator('.sidebar .item', { hasText: 'Kumi' }).first().waitFor({ timeout: 90_000 })
    const hello = await (await fetch(`http://127.0.0.1:${port}/api/hello`)).json()
    assert.equal(hello.version, version)
    const state = await api('GET', '/api/state')
    assert.deepEqual(state.bots.map((bot) => bot.name), ['Kumi'])
  }],
  ['The bot that comes with it answers in the window', async () => {
    await win.locator('.composer textarea').fill('Is anybody there?')
    await win.keyboard.press('Control+Enter')
    await win.locator('.msg.assistant[data-item]', { hasText: 'Echo: Is anybody there?' }).waitFor({ timeout: 60_000 })
  }],
  ['It finds Claude Code, Codex and Grok where they are installed', async () => {
    const engines = ['claude-code', 'codex', 'grok']
    const found = await until('the engines to be looked for', async () => {
      const { providers } = await api('GET', '/api/state')
      const mine = providers.filter((p) => engines.includes(p.id))
      return mine.every((p) => p.detail !== 'Checking…') && mine
    })
    for (const engine of found) assert.ok(engine.connected, `${engine.name} was not found: ${engine.detail}`)
    console.log(found.map((p) => `      ${p.name}: ${p.detail}`).join('\n'))
  }],
  ...['claude-code', 'codex', 'grok'].map((engine) => [`A bot on ${engine} answers, and was given its instructions whole`, async () => {
    const bot = await api('POST', '/api/bots', { name: `On ${engine}`, provider: engine, headless: has('--hidden') })
    assert.equal(await say(bot.id, 'Is anybody there?'), 'Echo (turn 1): Is anybody there?')
    // The stand-in says back what it was told to be. That is many lines, with quotes and
    // percent signs in them: all of it has to reach a program started on any system.
    const { text } = await api('GET', `/api/bots/${bot.id}/instructions`)
    const told = await say(bot.id, '!system')
    assert.ok(text.includes('\n') && text.length > 2000, 'a bot’s instructions are long')
    assert.equal(told.length, text.length, `the bot was told ${told.length} characters of the ${text.length} it should have been`)
  }]),
  ['What a bot changes in its own files is kept in its history', async () => {
    // Kept with git, which every computer the release is made on has.
    for (const bot of (await api('GET', '/api/state')).bots) {
      const history = await api('GET', `/api/bots/${bot.id}/history`)
      assert.ok(history.available && !history.problem && history.entries.length, `${bot.name} has no history: ${JSON.stringify(history).slice(0, 300)}`)
    }
  }],
  ['A bot opens a page in its browser', async () => {
    const { bots } = await api('GET', '/api/state')
    const bot = bots.find((b) => b.provider === 'claude-code')
    // A page of this script's own: a bot's browser opens web addresses only.
    const site = http.createServer((_, res) => res.setHeader('Content-Type', 'text/html').end('<title>From the check</title><h1>It works</h1>'))
    await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve))
    const answer = await say(bot.id, `!tool browser_navigate ${JSON.stringify({ url: `http://127.0.0.1:${site.address().port}/` })}`).finally(() => site.close())
    if (/Could not start a browser/.test(answer) && !has('--browser')) return console.log('      Left out: there is no browser on this computer for the bots.')
    assert.match(answer, /^Tool result: (?!Error)/, answer)
    assert.match(answer, /From the check|It works/, answer)
  }],
  ['It quits, and its server with it', async () => {
    if (!has('--hidden')) await win.screenshot({ path: path.join(out, 'window.png') }).catch((e) => console.log(`      (no picture of the window: ${e.message.split('\n')[0]})`))
    await app.close()
    app = null
    await until('the server to stop', async () => !(await fetch(`http://127.0.0.1:${port}/api/hello`).then((r) => r.ok, () => false)), 20_000)
  }],
]

let failed = false
console.log(`Trying ${program}\n`)
for (const [name, step] of steps) {
  const began = Date.now()
  try {
    await step()
    console.log(`  ✓ ${name} (${((Date.now() - began) / 1000).toFixed(1)} s)`)
  } catch (e) {
    failed = true
    console.log(`  ✗ ${name}\n\n${String(e?.stack ?? e).replace(/^/gm, '      ')}\n`)
    break
  }
}

if (failed) {
  await win?.screenshot({ path: path.join(out, 'window.png'), timeout: 5000 }).catch(() => {})
  await app?.close().catch(() => {})
}
// What the server printed is what says why, when something went wrong.
const log = path.join(tmp, 'app', 'server.log')
if (fs.existsSync(log)) {
  fs.copyFileSync(log, path.join(out, 'server.log'))
  if (failed) console.log(`The server's log ends with:\n${fs.readFileSync(log, 'utf8').split('\n').slice(-40).join('\n')}`)
}
// The app may still be writing its last files as it quits.
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
console.log(failed ? `\nIt does not work as installed. What was kept is in ${out}` : '\nIt works as installed.')
process.exit(failed ? 1 : 0)
