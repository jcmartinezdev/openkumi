// Drives the real desktop app (Electron), with its window kept off the screen. Everything the app
// touches is temporary: its own data, and the data of the servers it runs or talks to.
//   OPENBOT_DESKTOP_APP   the program inside a packaged app, to test that instead of the source
//   OPENBOT_TEST_SHOW=1   show the window while the tests run
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { _electron } from 'playwright-core'
import { startOAuthServer } from '../../server/test/fixtures/mcp-oauth.mjs'

const LOCAL_PORT = 4950 + Math.floor(Math.random() * 20)
const REMOTE_PORT = LOCAL_PORT + 25
const SERVER = path.resolve(import.meta.dirname, '../../server/src/index.ts')
const packaged = process.env.OPENBOT_DESKTOP_APP
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openbot-desktop-'))
// A copy of the superpowers that ship, so a test can point their services somewhere that is not the real one.
fs.cpSync(path.resolve(import.meta.dirname, '../../server/superpowers'), `${tmp}/superpowers`, { recursive: true })
// OPENBOT_DESKTOP_YES answers the app's own confirmation dialogs, which a test cannot click.
const env = {
  ...process.env,
  OPENBOT_DESKTOP_DATA: `${tmp}/app`,
  OPENBOT_DESKTOP_YES: '1',
  OPENBOT_DESKTOP_HIDDEN: process.env.OPENBOT_TEST_SHOW ? '' : '1',
  OPENBOT_HOME: `${tmp}/local-home`,
  OPENBOT_PORT: String(LOCAL_PORT),
  OPENBOT_MOCK: '1',
  OPENBOT_SUPERPOWERS: `${tmp}/superpowers`,
  // The app run from the source cannot be what the computer opens sign-ins with; the tests hand it them.
  OPENBOT_DESKTOP_CATCH_SIGN_INS: '1',
  // Scripted stand-ins for the Claude Code, Codex and Grok programs, so the tests do not depend on what is installed here.
  OPENBOT_CLAUDE_BIN: path.resolve(import.meta.dirname, '../../server/test/fixtures/fake-claude.mjs'),
  OPENBOT_CODEX_BIN: path.resolve(import.meta.dirname, '../../server/test/fixtures/fake-codex.mjs'),
  OPENBOT_GROK_BIN: path.resolve(import.meta.dirname, '../../server/test/fixtures/fake-grok.mjs'),
}
delete env.ELECTRON_RUN_AS_NODE
delete env.OPENBOT_DEV_URL

const up = (port) => fetch(`http://127.0.0.1:${port}/api/hello`).then((r) => r.ok, () => false)
const tokenOf = (home) => JSON.parse(fs.readFileSync(`${tmp}/${home}/auth.json`, 'utf8')).accessToken
const ask = async (port, home, method, url, body) =>
  (await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { Authorization: `Bearer ${tokenOf(home)}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })).json()

/** Pairs "this computer" with a server by hand, the way the app does, and returns the key it is given. */
async function pairWith(port, home, name = 'Test computer') {
  const { code } = await ask(port, home, 'POST', '/api/pairing')
  const sign = (who, ours, theirs) => crypto.createHmac('sha256', code.replaceAll('-', '')).update(`${who}:${ours}:${theirs}`).digest('hex')
  const post = async (url, body) => (await fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  const nonce = crypto.randomBytes(16).toString('hex')
  const begun = await post('/api/pair/begin', { nonce })
  return post('/api/pair/finish', { nonce, serverNonce: begun.nonce, proof: sign('computer', nonce, begun.nonce), name })
}

async function until(check, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Condition was not met in time')
    await new Promise((r) => setTimeout(r, 200))
  }
}

let electron
let app
const launch = async () => {
  app = await _electron.launch({ executablePath: electron, args: packaged ? [] : ['.'], env })
  return app.firstWindow()
}
/** Waits until the window shows an environment that has a bot with this name. */
const showsBot = (win, name) => win.locator('.sidebar .item', { hasText: name }).first().waitFor({ timeout: 60_000 })
const settings = async (win) => {
  await win.evaluate(() => (location.hash = '/settings/environments'))
  await win.waitForSelector('#local-environment .switch')
}
const menu = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'Environment').submenu.items.map((i) => `${i.checked ? '*' : ''}${i.label}`))
const processes = () => app.evaluate(({ app }) => app.getAppMetrics().map((m) => m.name || m.type))

before(async () => {
  electron = packaged ?? (await import('electron')).default
})

after(async () => {
  await app?.close().catch(() => {})
  // The app may still be writing its last files as it quits.
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('the local environment can be turned on and off, and remote environments added and opened, without the window reloading', async () => {
  // "Another computer": a second server with its own data, reached by this machine's network address.
  fs.mkdirSync(`${tmp}/remote-home`, { recursive: true })
  fs.writeFileSync(`${tmp}/remote-home/settings.json`, '{"lan": true}')
  const remote = spawn(process.execPath, [SERVER], { env: { ...process.env, OPENBOT_HOME: `${tmp}/remote-home`, OPENBOT_PORT: String(REMOTE_PORT), OPENBOT_MOCK: '1' }, stdio: 'ignore' })
  const remoteRow = (win) => win.locator('.set-row', { has: win.locator('h3:has-text("Other Mac")') })

  try {
    await until(() => up(REMOTE_PORT))
    const access = await ask(REMOTE_PORT, 'remote-home', 'GET', '/api/access')
    await ask(REMOTE_PORT, 'remote-home', 'POST', '/api/bots', { name: 'Far Helper', provider: 'mock' })
    const [address] = access.addresses
    assert.ok(address, 'this test needs the computer to be on a network')
    const origin = `http://${address}:${REMOTE_PORT}`

    // The first time, nothing is turned on and the app asks where the bots should run.
    let win = await launch()
    await win.waitForSelector('.gate #local-environment')
    // The window's page is the app's own, not one a server hands out.
    assert.equal(win.url(), 'openbot://app/')
    assert.deepEqual(await win.locator('h2').allInnerTexts(), ['This app', 'Environments'])
    assert.equal(await win.locator('.gate-head p').innerText(), 'Where should your bots run? On this computer, on another one, or both.')
    assert.match(await win.locator('#local-environment').innerText(), /Turned off\. Bots only run in remote environments\./)
    assert.equal(await up(LOCAL_PORT), false, 'with the local environment off, no server runs here')
    assert.ok(!(await processes()).includes('Open Bot Server'))
    // From here on the window must stay the same page: changing environments does not reload it.
    await win.evaluate(() => (window.sameWindow = true))

    // Turning the local environment on starts the server on this computer, in a process of its own, and shows it.
    await win.click('#local-environment .switch')
    await showsBot(win, 'Assistant')
    assert.equal(await up(LOCAL_PORT), true)
    assert.ok((await processes()).includes('Open Bot Server'), 'the server is a process of its own inside the app')
    // The server has no pages; the interface is the app's.
    assert.match(await (await fetch(`http://127.0.0.1:${LOCAL_PORT}/`)).text(), /no page of its own/)
    // The connection to the environment is on a worker thread, not the window's own.
    assert.ok(win.workers().some((w) => /connection\.worker/.test(w.url())), 'the connection runs on a worker thread')
    // Scripts only ever come from the app's own files: one written into the page does not run.
    const ran = await win.evaluate(() => {
      const script = document.createElement('script')
      script.textContent = 'window.inlineScriptRan = true'
      document.head.append(script)
      return window.inlineScriptRan === true
    })
    assert.equal(ran, false)

    // Settings > Environments: pair with a remote one. A wrong code is explained; the right one is accepted.
    await settings(win)
    assert.match(await win.locator('#local-environment').innerText(), /Local environment\s*Showing now\s*Open Bot runs on this computer\./)
    await win.click('.set-section-head button:has-text("Add environment")')
    const { code } = await ask(REMOTE_PORT, 'remote-home', 'POST', '/api/pairing')
    await win.fill('input[aria-label="Address of the other computer"]', `${address}:${REMOTE_PORT}`)
    await win.fill('input[aria-label="Pairing code"]', 'AAAA-BBBB-CCCC')
    await win.click('button:has-text("Pair and add")')
    await win.waitForSelector('.notice.error:has-text("not the one that computer is showing")')
    // Typed in lower case and without the dashes, as people do.
    await win.fill('input[aria-label="Pairing code"]', code.replaceAll('-', '').toLowerCase())
    await win.fill('input[aria-label="Name"]', 'Other Mac')
    await win.click('button:has-text("Pair and add")')
    await remoteRow(win).waitFor()
    await remoteRow(win).locator('p:has-text("via LAN · Connected")').waitFor()
    assert.deepEqual(await menu().then((m) => m.slice(0, 2)), ['*This computer', 'Other Mac'], 'adding an environment does not leave the one that is showing')

    // The key this computer was given is kept in a file only the owner can read. It is a key of
    // its own: the other server's access code never left that computer, and the code is used up.
    const saved = JSON.parse(fs.readFileSync(`${tmp}/app/desktop.json`, 'utf8'))
    assert.deepEqual([saved.local, saved.environments.map((e) => [e.name, e.url, e.enabled])], [{ enabled: true }, [['Other Mac', origin, true]]])
    assert.ok(saved.environments[0].token && saved.environments[0].token !== tokenOf('remote-home'))
    assert.equal(fs.statSync(`${tmp}/app/desktop.json`).mode & 0o777, 0o600)
    // The other computer lists this one by its name.
    assert.equal((await ask(REMOTE_PORT, 'remote-home', 'GET', '/api/access')).computers.length, 1)

    // Open the remote environment; both are then offered in the sidebar and in the menu.
    await remoteRow(win).locator('button:has-text("Open")').click()
    await win.evaluate(() => (location.hash = '/'))
    await showsBot(win, 'Far Helper')
    assert.deepEqual(await win.locator('select.environment option').allInnerTexts(), ['This computer', 'Other Mac'])
    assert.deepEqual(await menu().then((m) => m.slice(0, 2)), ['This computer', '*Other Mac'])

    // Turning the local environment off stops the server on this computer; the remote one keeps showing.
    await settings(win)
    await win.click('#local-environment .switch')
    await until(async () => !(await up(LOCAL_PORT)), 15_000)
    await win.waitForSelector('#local-environment:has-text("Turned off. Bots only run in remote environments.")')
    assert.ok(!(await processes()).includes('Open Bot Server'))
    // ...and turning it on again starts it, without leaving the environment that is showing.
    await win.click('#local-environment .switch')
    await until(() => up(LOCAL_PORT))
    assert.deepEqual(await menu().then((m) => m.slice(0, 2)), ['This computer', '*Other Mac'])

    // Turning off the environment that is showing moves the window to one that is still on.
    await remoteRow(win).locator('.switch').click()
    await win.evaluate(() => (location.hash = '/'))
    await showsBot(win, 'Assistant')
    assert.equal(await win.locator('.sidebar .item', { hasText: 'Far Helper' }).count(), 0)
    await settings(win)
    await remoteRow(win).locator('p:has-text("via LAN · Turned off")').waitFor()
    // Removing an environment forgets it.
    await remoteRow(win).locator('summary').click()
    await remoteRow(win).locator('button:has-text("Remove")').click()
    await win.waitForSelector('#remote-environments:has-text("No remote environments")')

    // With nothing turned on, the app asks again where the bots should run, and no server runs here.
    await win.click('#local-environment .switch')
    await win.waitForSelector('.gate #local-environment')
    await until(async () => !(await up(LOCAL_PORT)), 15_000)
    assert.equal(await win.evaluate(() => window.sameWindow), true, 'the window was never reloaded along the way')

    // Quitting stops the server the app started; the next start brings back what was on.
    await win.click('#local-environment .switch')
    await showsBot(win, 'Assistant')
    await app.close()
    await until(async () => !(await up(LOCAL_PORT)), 15_000)
    assert.equal(await up(REMOTE_PORT), true, 'another environment is never touched')
    win = await launch()
    await showsBot(win, 'Assistant')
    await app.close()
    await until(async () => !(await up(LOCAL_PORT)), 15_000)

    // A server that is already running here is used as it is, and left running.
    const already = spawn(process.execPath, [SERVER], { env, stdio: 'ignore' })
    try {
      await until(() => up(LOCAL_PORT))
      win = await launch()
      await showsBot(win, 'Assistant')
      assert.ok(!(await processes()).includes('Open Bot Server'), 'the app does not start a second one')
      await settings(win)
      assert.match(await win.locator('#local-environment').innerText(), /started outside this app/)
      await app.close()
      await new Promise((r) => setTimeout(r, 1500))
      assert.equal(await up(LOCAL_PORT), true)
    } finally {
      already.kill()
      await until(async () => !(await up(LOCAL_PORT)), 15_000)
    }
  } finally {
    await app?.close().catch(() => {})
    remote.kill()
  }
})

test('a reply is drawn as it is written, and a bot’s browser is drawn and driven through the worker', async () => {
  const win = await launch()
  await showsBot(win, 'Assistant')
  const state = () => ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')
  const bot = (await state()).bots[0]

  // A reply that is still being written is drawn in pieces, so only its end is redone as text arrives.
  const paragraphs = Array.from({ length: 24 }, (_, i) => `## Part ${i + 1}\n\nThe quick brown fox jumps over the lazy dog, again and again and again, until part ${i + 1} is done.`)
  // The scripted model answers with what it was sent, after a word of its own.
  await win.locator('.composer textarea').fill(`Here it is:\n\n${paragraphs.join('\n\n')}`)
  await win.keyboard.press('Meta+Enter')
  await win.waitForFunction(() => document.querySelectorAll('.msg.assistant .md-piece').length > 6)
  // Once it is finished it is drawn from what was kept, exactly as it will be the next time the chat is opened.
  await win.waitForFunction(() => document.querySelectorAll('.msg.assistant[data-item] h2').length === 24, null, { timeout: 30_000 })
  assert.match(await win.locator('.msg.assistant').last().innerText(), /^Echo:[\s\S]*until part 24 is done\.$/)

  // The bot's browser: its pictures go from the server to the worker and onto the canvas.
  await win.getByRole('button', { name: 'Toggle browser' }).click()
  await win.waitForFunction(() => getComputedStyle(document.querySelector('.pane .view canvas')).visibility === 'visible', null, { timeout: 60_000 })
  // It is only watched until the owner takes control of it.
  assert.equal(await win.locator('.address').getAttribute('readonly'), '')
  assert.match(await win.locator('.control-bar').innerText(), /Assistant has control\.\s+Take control/)
  await win.getByRole('button', { name: 'Take control' }).click()
  await win.locator('.control-bar.you').waitFor()
  // A page that is one big red link.
  const page = `data:text/html,<body style="margin:0"><a href="about:blank" style="display:block;height:100vh;background:rgb(210,40,60)"></a>`
  await win.locator('.address').fill(page)
  await win.keyboard.press('Enter')
  const middle = () =>
    win.evaluate(async () => {
      const bitmap = await createImageBitmap(document.querySelector('.pane .view canvas'))
      const copy = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')
      copy.drawImage(bitmap, 0, 0)
      return [...copy.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data.slice(0, 3)]
    })
  const near = ([r, g, b]) => Math.abs(r - 210) < 12 && Math.abs(g - 40) < 12 && Math.abs(b - 60) < 12
  await until(async () => near(await middle()), 20_000)

  // And what is done to the canvas reaches the page.
  await win.locator('.pane .view canvas').click()
  await until(async () => (await state()).browsers[bot.id]?.tabs.every((t) => t.url === 'about:blank'), 15_000)
  // Handing back gives the window to the bot again.
  await win.getByRole('button', { name: 'Hand back' }).click()
  await until(async () => (await state()).browsers[bot.id].windows.every((w) => !w.controller), 10_000)
  await win.locator('.address[readonly]').waitFor()

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('a window the bot starts browsing in floats over the chat, docks beside it or fills the window, and is where the bot asks for help', async () => {
  const win = await launch()
  await showsBot(win, 'Assistant')
  const state = () => ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')
  const surfer = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Surfer', provider: 'mock' })
  await win.locator('.sidebar .row.bot', { hasText: 'Surfer' }).click()
  await win.locator('.empty h1', { hasText: 'Surfer' }).waitFor()
  const say = async (text) => {
    await win.locator('.composer textarea').fill(text)
    await win.keyboard.press('Meta+Enter')
  }
  const page = (title) => `data:text/html,<title>${title}</title><body style='background:rgb(40,120,210)'>`

  // The bot starts browsing: its window floats over the chat, small, and can only be watched there.
  await say(`!tool browser_navigate {"url":"${page('Hello')}"}`)
  await win.locator('.pip').waitFor({ timeout: 60_000 })
  await until(async () => /^Conversation · Hello$/.test(await win.locator('.pip-title').innerText()), 10_000)
  assert.equal(await win.locator('.pane').count(), 0)

  // Beside the chat, then filling the window, then back to floating.
  await win.getByRole('button', { name: 'Dock beside the chat' }).click()
  await win.locator('.chat.with-pane .pane').waitFor()
  // The page is drawn there at once, though it is not changing (Chrome only sends a picture when it does).
  await win.waitForFunction(() => getComputedStyle(document.querySelector('.pane .view canvas')).visibility === 'visible', null, { timeout: 15_000 })
  assert.equal(await win.locator('.pip').count(), 0)
  await win.locator('.pane').getByRole('button', { name: 'Full screen' }).click()
  await win.locator('.pane.full').waitFor()
  assert.equal(await win.locator('.chat.with-pane').count(), 0, 'the chat has the room to itself underneath')
  await win.keyboard.press('Escape')
  await win.locator('.chat.with-pane .pane:not(.full)').waitFor()
  await win.getByRole('button', { name: 'Picture in picture' }).click()
  await win.locator('.pip').waitFor()
  assert.equal(await win.locator('.pane').count(), 0)
  // Closed, it stays closed while the bot goes on browsing there.
  await win.getByRole('button', { name: 'Close picture in picture' }).click()
  await say(`!tool browser_navigate {"url":"${page('Again')}"}`)
  await win.locator('.msg.assistant', { hasText: 'Page: Again' }).waitFor({ timeout: 20_000 })
  assert.equal(await win.locator('.pip').count(), 0)

  // But when the bot asks for help there, it comes back with the request; taking control docks it.
  await say('!tool browser_ask_user {"request":"Sign in to Example"}')
  await win.locator('.pip-ask', { hasText: 'Surfer needs you: Sign in to Example' }).waitFor({ timeout: 20_000 })
  await win.locator('.pip-ask').getByRole('button', { name: 'Take control' }).click()
  await win.locator('.pane .control-bar.you', { hasText: 'Sign in to Example, then hand back to Surfer.' }).waitFor()
  assert.equal(await win.locator('.address').getAttribute('readonly'), null)
  await win.getByRole('button', { name: 'Hand back' }).click()
  await win.locator('.msg.assistant', { hasText: 'Tool result: The user handed the browser back.' }).waitFor({ timeout: 20_000 })

  // A subagent browses in a window of its own, which floats while the conversation's is docked.
  await say(`!tool spawn_subagent {"name":"Peeker","task":"!tool browser_navigate {\\"url\\":\\"${page('Theirs')}\\"}"}`)
  await win.locator('.pip-title', { hasText: 'Peeker' }).waitFor({ timeout: 30_000 })
  const windows = (await state()).browsers[surfer.id].windows
  assert.equal(new Set(windows.map((w) => w.threadId)).size, 2, 'a window each')
  await win.locator('.pip').getByRole('button', { name: 'Full screen' }).click()
  await win.locator('.pane.full .pane-session', { hasText: 'Peeker' }).waitFor()

  // The tests after this one expect the bots they began with.
  await ask(LOCAL_PORT, 'local-home', 'DELETE', `/api/bots/${surfer.id}`)
  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('replies are drawn with code in colour, diagrams, formulas and tables, and a page a bot shows runs in a frame that cannot reach the app', async () => {
  const win = await launch()
  await showsBot(win, 'Assistant')
  // Links the app opens are noted instead of going to the computer's browser.
  await app.evaluate(({ shell }) => {
    globalThis.opened = []
    shell.openExternal = async (url) => void globalThis.opened.push(url)
  })
  const send = async (text) => {
    await win.locator('.composer textarea').fill(text)
    await win.keyboard.press('Meta+Enter')
  }

  // The scripted model answers with what it was sent.
  await send(['Look:', '```ts\nconst answer: number = 42\n```', '```mermaid\ngraph TD\n  A[Ask] --> B[Answer]\n```', 'So $E = mc^2$, and it costs $5 or $10.', '$$\n\\int_0^1 x\\,dx\n$$', '| Name | Value |\n|---|---|\n| a | 1 |'].join('\n\n'))
  const reply = win.locator('.msg.assistant[data-item]').last()
  await reply.locator('.diagram-body svg').waitFor({ timeout: 30_000 })
  assert.equal(await reply.locator('.code-block .hljs-keyword').first().innerText(), 'const')
  assert.equal(await reply.locator('.code-lang').first().innerText(), 'TypeScript')
  assert.match(await reply.locator('.diagram-body svg').innerHTML(), /Answer/)
  assert.equal(await reply.locator('.katex').count(), 2, 'one formula in the text, one on its own')
  assert.equal(await reply.locator('.katex-display').count(), 1)
  assert.match(await reply.innerText(), /it costs \$5 or \$10\./, 'prices are not formulas')
  assert.equal(await reply.locator('.table-wrap td').first().innerText(), 'a')
  await reply.getByRole('button', { name: 'Copy code' }).first().click()
  await until(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())) === 'const answer: number = 42', 5000)

  // A link to a page the bot saved opens it full size, in the same kind of frame; a link to any other of its files opens it in Files.
  await send('!tool write_file ' + JSON.stringify({ path: 'files/board.html', content: '<p id="saved">Saved page</p>' }))
  await send('See [the board](files/board.html) and [the notes](memory/notes.md).')
  const links = win.locator('.msg.assistant[data-item]').last()
  await links.getByRole('link', { name: 'the board' }).click()
  await win.frameLocator('.dialog.full iframe').locator('#saved').waitFor({ timeout: 10_000 })
  assert.equal(await win.locator('.dialog.full .dialog-head h2').innerText(), 'board.html')
  await win.keyboard.press('Escape')
  await links.getByRole('link', { name: 'the notes' }).click()
  await until(async () => /\/settings\/bots\/[^/]+\/files\/memory\/notes\.md$/.test(decodeURIComponent(await win.evaluate(() => location.hash))), 5000)
  await win.evaluate(() => history.back())
  await win.locator('.composer textarea').waitFor()

  // A long run of steps is folded into one line once it is over.
  await send('!steps 5')
  const folded = win.locator('.activity details.steps').last()
  await folded.waitFor({ timeout: 30_000 })
  assert.match(await folded.locator(':scope > summary').innerText(), /^5 steps/)
  assert.equal(await folded.locator('.steps-body .step').count(), 5)

  // A page: it takes the app's colours, is fitted to its height, and its links open in the browser.
  const html = `<div id="c" style="height:180px"></div><a id="out" href="https://example.com/more">More</a><script>
    c.textContent = getComputedStyle(document.documentElement).getPropertyValue('--chart-1').trim()
    fetch('https://example.com/data').then(() => (document.title = 'sent'), () => (document.title = 'refused'))</script>`
  await send(`!tool show_page ${JSON.stringify({ title: 'Sales', html, height: 100 })}`)
  const frame = win.locator('.page iframe')
  await frame.waitFor({ timeout: 30_000 })
  assert.match(await frame.getAttribute('src'), /^openbot:\/\/page\/[0-9a-f]{32}#theme=(light|dark)$/)
  const inside = win.frameLocator('.page iframe')
  assert.match(await inside.locator('#c').innerText(), /^#(3987e5|2a78d6)$/)
  await until(async () => (await win.locator('.page-frame').evaluate((el) => el.offsetHeight)) > 200, 10_000)
  // The page stands for the call that showed it, which is not listed as a step.
  assert.equal(await win.locator('.activity', { hasText: 'show_page' }).count(), 0)
  // The reply after it is written out first, so the page has stopped moving.
  await win.locator('.msg.assistant[data-item]', { hasText: 'Tool result: Shown “Sales”' }).waitFor()
  await inside.locator('#out').click()
  await until(async () => (await app.evaluate(() => globalThis.opened)).includes('https://example.com/more'), 5000)

  // It is a site of its own: it cannot reach the app, what the app is given, or the network.
  const page = win.frames().find((f) => f.url().startsWith('openbot://page/'))
  assert.equal(await page.evaluate(() => { try { return String(!!parent.document) } catch { return 'blocked' } }), 'blocked')
  assert.equal(await page.evaluate(() => typeof window.openbotDesktop), 'undefined')
  await until(async () => (await page.title()) === 'refused', 5000)
  // Nor can it open anything without a click in it, or go to another site in its frame.
  await win.locator('.composer textarea').focus()
  await page.evaluate(() => setTimeout(() => parent.postMessage({ openbot: 'open', url: 'https://example.com/unasked' }, '*'), 50))
  await page.evaluate(() => void (location.href = 'https://example.com/elsewhere'))
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.deepEqual(await app.evaluate(() => globalThis.opened), ['https://example.com/more'])
  assert.doesNotMatch(page.url(), /example\.com/)

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('files go up and come down, and another computer is paired and removed from the settings', async () => {
  const win = await launch()
  await showsBot(win, 'Assistant')
  win.on('dialog', (dialog) => dialog.accept())
  const bot = (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).bots[0]

  // A file is sent up to the bot's folder...
  await win.evaluate((id) => (location.hash = `/settings/bots/${id}/files`), bot.id)
  await win.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('kept on the other side') })
  await win.locator('.file-row', { hasText: 'notes.txt' }).click()
  assert.equal(fs.readFileSync(`${tmp}/local-home/bots/${bot.id}/workspace/files/notes.txt`, 'utf8'), 'kept on the other side')
  // ...and saved back onto this computer. (The test answers the "save as" question by choosing the place beforehand.)
  await app.evaluate(({ session }, to) => session.defaultSession.once('will-download', (_event, item) => item.setSavePath(to)), `${tmp}/saved.txt`)
  await win.getByRole('button', { name: 'Download' }).click()
  await until(() => fs.existsSync(`${tmp}/saved.txt`) && fs.readFileSync(`${tmp}/saved.txt`, 'utf8') === 'kept on the other side', 15_000)

  // Letting another computer in: a code is shown here, with this computer's address...
  await settings(win)
  await win.locator('#lan .switch').click()
  await win.getByRole('button', { name: 'Pair a computer' }).click()
  const code = await win.locator('.pair-code').innerText()
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  // ...and when the other computer has used it, it is listed, and the code is put away.
  const sign = (who, ours, theirs) => crypto.createHmac('sha256', code.replaceAll('-', '')).update(`${who}:${ours}:${theirs}`).digest('hex')
  const post = async (url, body) => (await fetch(`http://127.0.0.1:${LOCAL_PORT}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  const nonce = crypto.randomBytes(16).toString('hex')
  const begun = await post('/api/pair/begin', { nonce })
  const { key } = await post('/api/pair/finish', { nonce, serverNonce: begun.nonce, proof: sign('computer', nonce, begun.nonce), name: 'Laptop' })
  const row = win.locator('.set-row', { hasText: 'Laptop' })
  await row.waitFor({ timeout: 15_000 })
  await win.locator('.pair-code').waitFor({ state: 'detached' })
  // Removing it shuts it out.
  await row.getByRole('button', { name: 'Remove' }).click()
  await win.waitForSelector('#paired-computers:has-text("No computers are paired")')
  assert.equal((await ask(LOCAL_PORT, 'local-home', 'GET', '/api/access')).computers.length, 0)
  assert.ok(key)

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('the app recovers when the server it relies on goes away or shuts it out, and keeps its code from an impostor', async () => {
  const configure = (config) => fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify(config))
  const localOnly = { local: { enabled: true }, environments: [], current: 'local' }

  // Something else has the usual port and says it is Open Bot. It cannot show that it knows the
  // access code, so the app does not send it the code, and runs its own server beside it.
  const heard = []
  const impostor = http.createServer((req, res) => {
    heard.push(`${req.url} ${req.headers.authorization ?? ''}`)
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ app: 'open-bot', version: '0', authorized: true, home: `${tmp}/local-home`, proof: 'ff' }))
  })
  await new Promise((resolve) => impostor.listen(LOCAL_PORT, '127.0.0.1', resolve))
  configure(localOnly)
  let win = await launch()
  await showsBot(win, 'Assistant')
  assert.ok((await processes()).includes('Open Bot Server'))
  assert.ok(heard.length > 0 && !heard.some((line) => line.includes(tokenOf('local-home'))), 'the impostor was asked who it is, and never given the access code')
  await app.close()
  await new Promise((resolve) => impostor.close(resolve))

  // A server the app joined, rather than started, stops: the app starts its own and the window comes back.
  const joined = spawn(process.execPath, [SERVER], { env, stdio: 'ignore' })
  await until(() => up(LOCAL_PORT))
  win = await launch()
  await showsBot(win, 'Assistant')
  assert.ok(!(await processes()).includes('Open Bot Server'))
  joined.kill()
  await until(async () => (await processes()).includes('Open Bot Server'), 30_000)
  await showsBot(win, 'Assistant')
  await win.locator('.toast').waitFor({ state: 'detached', timeout: 15_000 })
  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)

  // Another computer stops letting this one in: the window says so, instead of trying for ever.
  fs.mkdirSync(`${tmp}/far-home`, { recursive: true })
  const far = spawn(process.execPath, [SERVER], { env: { ...process.env, OPENBOT_HOME: `${tmp}/far-home`, OPENBOT_PORT: String(REMOTE_PORT), OPENBOT_MOCK: '1' }, stdio: 'ignore' })
  try {
    await until(() => up(REMOTE_PORT))
    const given = await pairWith(REMOTE_PORT, 'far-home')
    configure({ local: { enabled: false }, environments: [{ id: 'remote-far', name: 'Far Mac', url: `http://127.0.0.1:${REMOTE_PORT}`, token: given.key, enabled: true }], current: 'remote-far' })
    win = await launch()
    await showsBot(win, 'Assistant')
    await ask(REMOTE_PORT, 'far-home', 'DELETE', `/api/computers/${given.id}`)
    await win.locator('.gate-head p', { hasText: 'Far Mac no longer lets this computer in.' }).waitFor({ timeout: 20_000 })
    // The list of environments is right there, to add it again with its new link.
    await win.locator('.gate .set-row', { hasText: 'Far Mac' }).waitFor()
    await app.close()
  } finally {
    far.kill()
  }
})

test('superpowers: browse them, open one, activate it for one bot here or in the bot\'s settings, and sign the bot in', async () => {
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  // Notion and Linear are reached at a stand-in that asks for a sign-in the way they do, and approves it at once.
  const service = await startOAuthServer()
  try {
    for (const id of ['notion', 'linear']) {
      const file = `${tmp}/superpowers/${id}/superpower.json`
      fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), mcp: { url: service.url } }))
    }
    const win = await launch()
    await showsBot(win, 'Assistant')
    win.on('dialog', (dialog) => dialog.accept())
    await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Second bot', provider: 'mock' })
    const powersOf = async () => Object.fromEntries((await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).bots.map((b) => [b.name, b.superpowers]))

    // The list: every superpower with what it is for, in the sidebar where skills, connections and plugins used to be.
    await win.evaluate(() => (location.hash = '/settings/superpowers'))
    await win.locator('.power-card').first().waitFor()
    assert.deepEqual(await win.locator('.power-card h3').allInnerTexts(), ['Linear', 'Notion'])
    const nav = await win.locator('.set-nav').innerText()
    assert.match(nav, /Superpowers/)
    assert.doesNotMatch(nav, /Skills|Connections|Plugins/)

    // Its own page says what it does and what it gives a bot, and each bot has a button to activate it.
    await win.locator('.power-card', { hasText: 'Notion' }).click()
    await win.locator('.power-head h1', { hasText: 'Notion' }).waitFor()
    assert.match(await win.locator('.power-about').innerText(), /Lets a bot work in your Notion workspace/)
    assert.deepEqual(await win.locator('.set-section h2').allInnerTexts(), ['What a bot can do with it', 'Your bots', 'What it gives a bot'])
    assert.match(await win.locator('.set-section', { hasText: 'What it gives a bot' }).innerText(), /Instructions[\s\S]*Tools from 127\.0\.0\.1/)
    const row = win.locator('.set-row', { hasText: 'Second bot' })
    assert.match(await row.innerText(), /Not active/)

    // Activating asks how the bot should sign in; it is active only once it has. With the browser on
    // this computer, the page opens there, and the service sends that browser back to the app.
    await app.evaluate(({ shell }) => {
      globalThis.opened = []
      shell.openExternal = async (url) => void globalThis.opened.push(url)
    })
    await win.getByRole('button', { name: 'Activate superpower: Notion for Second bot' }).click()
    const popup = win.locator('.dialog', { hasText: 'Activate Notion for Second bot' })
    await popup.getByRole('button', { name: /Sign in with your browser/ }).click()
    await popup.locator('p', { hasText: 'Finish signing in to Notion in your browser' }).waitFor()
    await until(() => app.evaluate(() => globalThis.opened.length > 0))
    const [page] = await app.evaluate(() => globalThis.opened)
    assert.deepEqual((await powersOf())['Second bot'], [], 'not active before the sign-in is done')
    const back = (await fetch(page, { redirect: 'manual' })).headers.get('location')
    await app.evaluate(({ app }, url) => app.emit('open-url', { preventDefault() {} }, url), back)
    await popup.locator('p', { hasText: 'Notion is active for Second bot.' }).waitFor()
    await popup.getByRole('button', { name: 'Done' }).click()
    await row.locator('p', { hasText: 'Signed in · 1 tool' }).waitFor({ timeout: 30_000 })
    assert.deepEqual(await powersOf(), { Assistant: [], 'Second bot': ['notion'] }, 'only that bot gets it')

    // The bot's own settings have the same buttons. Signing in inside the bot's browser shows that
    // browser in the popup; the stand-in approves at once.
    const second = (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).bots.find((b) => b.name === 'Second bot')
    await win.evaluate((id) => (location.hash = `/settings/bots/${id}/superpowers`), second.id)
    await win.locator('.tabbar a[aria-selected="true"]', { hasText: 'Superpowers' }).waitFor()
    assert.equal(await win.locator('.tabbar a', { hasText: 'Superpowers' }).locator('.count').innerText(), '1')
    await win.getByRole('button', { name: 'Activate superpower: Linear for Second bot' }).click()
    const again = win.locator('.dialog', { hasText: 'Activate Linear for Second bot' })
    await again.getByRole('button', { name: /Sign in inside Second bot’s browser/ }).click()
    await again.locator('p', { hasText: 'Linear is active for Second bot.' }).waitFor({ timeout: 30_000 })
    await again.getByRole('button', { name: 'Done' }).click()
    assert.deepEqual((await powersOf())['Second bot'], ['linear', 'notion'])
    // Notion is signed in, so deactivating it asks first (the test answers yes) and forgets the sign-in.
    await win.getByRole('button', { name: 'Deactivate superpower: Notion for Second bot' }).click()
    await until(async () => (await powersOf())['Second bot'].join() === 'linear')

    // The list shows where each one is active.
    await win.evaluate(() => (location.hash = '/settings/superpowers'))
    await win.locator('.power-card', { hasText: 'Linear' }).locator('.pill', { hasText: 'Active for 1 bot' }).waitFor()
    await win.locator('.power-card', { hasText: 'Notion' }).locator('.pill').waitFor({ state: 'detached' })
  } finally {
    await app?.close().catch(() => {})
    await service.close()
  }
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('a bot has one conversation: starting fresh sets it aside, and earlier ones are searched, read and continued', async () => {
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Assistant')
  const solo = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Solo', provider: 'mock' })
  const here = () => win.evaluate(() => location.hash)
  const say = async (text) => {
    await win.locator('.composer textarea').fill(text)
    await win.keyboard.press('Meta+Enter')
    await win.locator('.msg.assistant', { hasText: `Echo: ${text}` }).waitFor({ timeout: 20_000 })
  }

  // The sidebar is the bots, one row each; a bot's address is its conversation.
  await win.locator('.sidebar .row.bot', { hasText: 'Solo' }).click()
  await win.locator('.empty h1', { hasText: 'Solo' }).waitFor()
  await say('The code word is heron.')
  await say('And the bird is a crane.')
  assert.equal(await here(), `#/${solo.id}`)
  assert.equal(await win.locator('.sidebar .row.thread').count(), 0)
  assert.equal(await win.locator('.heading').innerText(), 'Solo')

  // Starting fresh empties the view; what was said is kept among the earlier conversations.
  await win.getByRole('button', { name: 'Start fresh' }).click()
  await win.locator('.empty h1', { hasText: 'Solo' }).waitFor()
  assert.equal(await win.locator('.msg').count(), 0)
  assert.equal(await win.getByRole('button', { name: 'Start fresh' }).isDisabled(), true, 'an empty conversation is already a fresh one')
  await say('A new beginning.')
  await win.getByRole('button', { name: 'Earlier conversations' }).first().click()
  assert.deepEqual(await win.locator('.earlier-row .earlier-title').allInnerTexts(), ['The code word is heron.'])

  // Searching goes through everything that was said, in the current conversation and the earlier ones.
  await win.getByLabel('Search conversations').fill('crane bird')
  await win.locator('.earlier-row mark').first().waitFor()
  assert.deepEqual(await win.locator('.earlier-row .earlier-meta strong').allInnerTexts(), ['Solo', 'You'])
  assert.deepEqual(await win.locator('.earlier-row').last().locator('mark').allInnerTexts(), ['bird', 'crane'])
  // A match opens the conversation it is in, with the message in view. An earlier conversation is only read.
  await win.locator('.earlier-row').last().click()
  await win.locator('.msg.user.found', { hasText: 'And the bird is a crane.' }).waitFor()
  assert.match(await here(), new RegExp(`^#/${solo.id}/t_[\\w-]+/\\d+$`))
  assert.match(await win.locator('.heading').innerText(), /^The code word is heron\.\s+Earlier conversation · /)
  assert.equal(await win.locator('.composer').count(), 0)

  // Continuing it puts it in place of the current one, which is set aside in turn.
  await win.getByRole('button', { name: 'Continue this one' }).click()
  await win.locator('.composer textarea').waitFor()
  await until(async () => (await here()) === `#/${solo.id}`, 10_000)
  await win.locator('.msg.user', { hasText: 'The code word is heron.' }).waitFor()
  await win.getByRole('button', { name: 'Earlier conversations' }).first().click()
  assert.deepEqual(await win.locator('.earlier-row .earlier-title').allInnerTexts(), ['A new beginning.'])
  await win.keyboard.press('Escape')
  await win.locator('.earlier-pop').waitFor({ state: 'detached' })

  // A subagent at work is shown under its bot and above the composer, and leads back to the conversation.
  await win.locator('.composer textarea').fill('!tool spawn_subagent {"name":"Scout","task":"!slow look around"}')
  await win.keyboard.press('Meta+Enter')
  await win.locator('.subagents .chip', { hasText: 'Scout' }).waitFor({ timeout: 20_000 })
  await win.locator('.sidebar .row.sub', { hasText: 'Scout' }).click()
  await win.locator('.msg.task', { hasText: '!slow look around' }).waitFor()
  assert.equal(await win.locator('.heading').innerText(), 'Scout\nSolo')
  await win.getByRole('button', { name: 'Back to the conversation' }).click()
  await until(async () => (await here()) === `#/${solo.id}`, 10_000)
  // Its report arrives in the conversation when it is done.
  await win.locator('.activity', { hasText: 'Subagent “Scout” completed' }).waitFor({ timeout: 20_000 })

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('scheduled tasks: made on their page, run, and each run opened from beneath its task', async () => {
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Assistant')
  win.on('dialog', (dialog) => dialog.accept())
  const helper = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Helper', provider: 'mock' })
  const here = () => win.evaluate(() => location.hash)
  const shot = (name) => process.env.OPENBOT_TEST_SHOTS && win.screenshot({ path: path.join(process.env.OPENBOT_TEST_SHOTS, `${name}.png`) })

  // They have a place of their own in the sidebar, which says who may do what.
  await win.locator('.sidebar .tasks-link').click()
  await win.locator('.heading', { hasText: 'Scheduled tasks' }).waitFor()
  assert.match(await win.locator('.set-intro').first().innerText(), /🤖 Assistant, your first bot, is the main assistant/)
  await win.locator('.set-row', { hasText: 'No scheduled tasks yet' }).waitFor()

  // A new task: a bot, a prompt, and a time on chosen days.
  await win.getByRole('button', { name: 'New task' }).click()
  await win.getByLabel('Bot', { exact: true }).selectOption(helper.id)
  await win.getByLabel('Name', { exact: true }).fill('Morning brief')
  await win.getByLabel('Prompt', { exact: true }).fill('Say good morning')
  await win.getByLabel('Time', { exact: true }).fill('07:30')
  for (const day of ['Monday', 'Wednesday', 'Friday']) await win.getByRole('button', { name: day, exact: true }).click()
  await shot('task-new')
  await win.getByRole('button', { name: 'Create task' }).click()
  const card = win.locator('.task-card', { hasText: 'Morning brief' })
  await card.waitFor()
  assert.match(await card.locator('.task-head').innerText(), /Mon, Wed, Fri at 07:30 · Helper · made by you\s+Next /)
  const [task] = await ask(LOCAL_PORT, 'local-home', 'GET', '/api/tasks')
  assert.deepEqual([task.botId, task.createdBy, task.schedule], [helper.id, 'user', { type: 'daily', time: '07:30', days: [1, 3, 5] }])

  // Run now: the run is listed beneath its task, and opens as a thread that leads back to the task.
  await card.getByRole('button', { name: 'Run Morning brief now' }).click()
  const run = card.locator('.task-run').first()
  await until(async () => /Done/.test(await run.innerText().catch(() => '')), 20_000)
  await shot('task-list')
  await run.click()
  await win.locator('.msg.task', { hasText: 'Say good morning' }).waitFor()
  await win.locator('.msg.assistant', { hasText: 'Echo: Say good morning' }).waitFor()
  assert.match(await win.locator('.heading').innerText(), /^Morning brief\nScheduled run · .+ · Helper$/)
  // Its bot shows it too, as it does a subagent.
  await win.locator('.sidebar .row.sub', { hasText: 'Morning brief' }).waitFor()
  await shot('task-run')
  await win.getByRole('button', { name: 'Back to the scheduled task' }).click()
  await until(async () => (await here()) === `#/tasks/${task.id}`, 10_000)
  await win.locator('.set-section', { hasText: 'Runs' }).locator('.task-run', { hasText: 'Done' }).waitFor()
  await shot('task-page')

  // What came of it reached Helper's conversation, where it opens the run.
  await win.locator('.sidebar .row.bot', { hasText: 'Helper' }).click()
  const report = win.locator('.activity', { hasText: 'Scheduled task “Morning brief” ran' })
  await report.waitFor({ timeout: 20_000 })
  await shot('task-report')
  await report.getByRole('button', { name: 'Open' }).click()
  await win.locator('.msg.task', { hasText: 'Say good morning' }).waitFor()

  // Renaming it keeps its next run; switching it off from the list pauses it.
  await win.evaluate((id) => (location.hash = `/tasks/${id}`), task.id)
  await win.getByLabel('Name', { exact: true }).fill('Morning hello')
  await win.getByRole('button', { name: 'Save', exact: true }).click()
  await win.getByRole('button', { name: 'Saved', exact: true }).waitFor()
  const [renamed] = await ask(LOCAL_PORT, 'local-home', 'GET', '/api/tasks')
  assert.deepEqual([renamed.title, renamed.nextRunAt], ['Morning hello', task.nextRunAt])
  await win.getByRole('button', { name: 'All scheduled tasks' }).click()
  await win.getByRole('switch', { name: 'Morning hello is on' }).click()
  await win.locator('.task-card', { hasText: 'Paused' }).waitFor()

  // Deleting it leaves its runs where they are.
  await win.locator('.task-open', { hasText: 'Morning hello' }).click()
  await win.getByRole('button', { name: 'Delete', exact: true }).click()
  await win.locator('.set-row', { hasText: 'No scheduled tasks yet' }).waitFor()
  assert.equal((await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).threads.filter((t) => t.taskId === task.id).length, 1)

  // The main assistant is marked among the bots.
  await win.evaluate(() => (location.hash = '/settings/bots'))
  await win.locator('.set-link', { hasText: 'Assistant' }).locator('.pill', { hasText: 'Main assistant' }).waitFor()

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('the model picker offers every provider and its models, and picking one moves the bot to it', async () => {
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Assistant')
  const assistant = async () => (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).bots.find((b) => b.name === 'Assistant')
  const open = async () => {
    await win.getByRole('button', { name: 'Model', exact: true }).click()
    await win.locator('.model-pop').waitFor()
  }
  const rows = () => win.locator('.model-row .model-name').allInnerTexts()

  // Every provider the environment has is down the side, connected or not.
  await open()
  const tabs = await win.locator('.model-rail [role=tab]').evaluateAll((all) => all.map((tab) => tab.getAttribute('aria-label')))
  assert.deepEqual(tabs, ['Favorites', 'Codex', 'Claude Code', 'Grok', 'Local models', 'OpenAI-compatible API', 'Mock (offline testing)'])

  // Each one shows the models it reports itself, by name. Picking one of another provider moves the bot there.
  await win.getByRole('tab', { name: 'Grok' }).click()
  await win.locator('.model-row', { hasText: 'grok-test-fast' }).waitFor()
  assert.deepEqual(await rows(), ['grok-test', 'grok-test-fast'])
  // The model a provider uses by itself leads its list and says so.
  assert.equal(await win.locator('.model-row', { has: win.locator('.model-tag', { hasText: 'Default' }) }).locator('.model-name').innerText(), 'grok-test')
  await win.locator('.model-row', { hasText: 'grok-test-fast' }).click()
  await until(async () => (await assistant()).provider === 'grok', 10_000)
  assert.equal((await assistant()).model, 'grok-test-fast')
  await win.locator('.model-button', { hasText: 'grok-test-fast' }).waitFor()
  // A click leaves the picker open, with the reasoning levels of the model just picked under it.
  await win.locator('.model-row[aria-selected=true]', { hasText: 'grok-test-fast' }).locator('+ .model-reasoning').waitFor()
  await win.keyboard.press('Escape')
  await win.locator('.model-pop').waitFor({ state: 'detached' })

  // Typing searches the models of every provider at once, earlier ones too; Enter takes the one that is lit.
  await open()
  await win.getByLabel('Search models').fill('sonn')
  await win.locator('.model-row').first().waitFor()
  assert.deepEqual([await rows(), await win.locator('.model-row .model-of').allInnerTexts()], [['Claude Sonnet 9', 'Claude Sonnet 8'], ['Claude Code', 'Claude Code']])
  await win.keyboard.press('Enter')
  await until(async () => (await assistant()).provider === 'claude-code', 10_000)
  assert.equal((await assistant()).model, 'sonnet')
  await win.locator('.model-button', { hasText: 'Claude Sonnet 9' }).waitFor()
  // ...and the bot really runs there now, in the same conversation, which the new engine is told about.
  await win.locator('.composer textarea').fill('hello')
  await win.keyboard.press('Meta+Enter')
  await win.locator('.msg.assistant', { hasText: /Echo \(turn 1\): This conversation was already under way\.[\s\S]*The newest message:\s+hello/ }).waitFor({ timeout: 20_000 })

  // Under the bot's model are the reasoning levels it takes. Picking one is kept, and shown on the button.
  await open()
  assert.deepEqual(await win.locator('.model-row[aria-selected=true] + .model-reasoning [role=radio]').allInnerTexts(), ['Auto', 'Low', 'Medium', 'High', 'Extra High', 'Max'])
  await win.getByRole('radio', { name: 'Extra High' }).click()
  await until(async () => (await assistant()).effort === 'xhigh', 10_000)
  await win.locator('.model-button', { hasText: 'Extra High' }).waitFor()
  // Earlier models are folded away until asked for.
  assert.deepEqual(await rows(), ['Claude Opus 9', 'Claude Sonnet 9', 'Claude Haiku 9'])
  await win.getByRole('button', { name: 'Show more' }).click()
  assert.deepEqual(await rows(), ['Claude Opus 9', 'Claude Sonnet 9', 'Claude Haiku 9', 'Claude Sonnet 8'])
  // A model that does not take the level the bot has is given the choice back.
  await win.locator('.model-row', { hasText: 'Claude Sonnet 8' }).click()
  await until(async () => (await assistant()).model === 'claude-sonnet-8', 10_000)
  assert.equal((await assistant()).effort, '')
  await win.keyboard.press('Escape')
  // Command with a number takes the model in that place: the first is the provider's default.
  await open()
  await win.keyboard.press('Meta+1')
  await until(async () => (await assistant()).model === '', 10_000)
  await win.locator('.model-button', { hasText: 'Claude Opus 9' }).waitFor()

  // A model can be starred to keep it at hand.
  await open()
  await win.getByRole('tab', { name: 'Grok' }).click()
  await win.locator('.model-row', { hasText: 'grok-test-fast' }).hover()
  await win.getByRole('button', { name: 'Add grok-test-fast to favorites' }).click()
  await win.getByRole('tab', { name: 'Favorites' }).click()
  assert.deepEqual([await rows(), await win.locator('.model-row .model-of').allInnerTexts()], [['grok-test-fast'], ['Grok']])

  // A provider that is not connected says what to do about it.
  await win.getByRole('tab', { name: 'Local models' }).click()
  assert.match(await win.locator('.model-empty').innerText(), /Install Ollama/)
  await win.getByRole('button', { name: 'Open provider settings' }).click()
  await win.locator('#provider-local').waitFor()

  // The providers page: all of them down the left with their version and how they stand...
  await win.locator('.prov-item .prov-version').first().waitFor()
  const listed = (await win.locator('.prov-item-text').allInnerTexts()).map((text) => text.replace(/\s*\n\s*/g, ' | '))
  assert.deepEqual(listed.slice(0, 4), ['Codex | v0.9.0 | Signed in · ChatGPT', 'Claude Code | v2.0.0 | Signed in · test@example.com · Pro plan', 'Grok | v1.2.3 | Signed in · grok.com', 'Local models | Not running'])
  // ...and the one that is picked beside the list, with the models it reports and the bots on it.
  await win.locator('.prov-item a', { hasText: 'Claude Code' }).click()
  await win.locator('.prov-head h3', { hasText: 'Claude Code' }).waitFor()
  await win.locator('.prov-models li').first().waitFor()
  assert.deepEqual((await win.locator('.prov-models li').allInnerTexts()).map((text) => text.split('\n')[0]), ['Claude Opus 9', 'Claude Sonnet 9', 'Claude Haiku 9', 'Claude Sonnet 8'])
  assert.deepEqual((await win.locator('.prov-bots a').allInnerTexts()).map((text) => text.split('\n').pop()), ['Assistant'])
  assert.match(await win.locator('.prov-detail .set-row').innerText(), /Program path[\s\S]*Using .*fake-claude\.mjs/)
  // The switch in the list takes a provider away from the bots altogether.
  await win.getByRole('switch', { name: 'Use Grok for bots' }).click()
  await until(async () => (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).settings.disabledProviders.includes('grok'), 10_000)
  await win.locator('#provider-grok .prov-standing', { hasText: 'Switched off' }).waitFor()

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('principles: written once for every bot, each bot’s line set beside them, and all a bot is told read from there', async () => {
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Assistant')
  win.on('dialog', (dialog) => dialog.accept())
  const shot = (name) => process.env.OPENBOT_TEST_SHOTS && win.screenshot({ path: path.join(process.env.OPENBOT_TEST_SHOTS, `${name}.png`) })
  const state = () => ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')

  // Found from the search, and showing the ones Open Bot comes with.
  await win.evaluate(() => (location.hash = '/settings/general'))
  await win.getByLabel('Search settings').fill('master prompt')
  await win.locator('.set-results button', { hasText: 'Principles for every bot' }).click()
  const box = win.getByLabel('Principles for every bot')
  await box.waitFor()
  assert.match(await box.inputValue(), /\*\*Work as a team\.\*\*/)
  await shot('principles')

  // Changed when the box is left; then the owner's own, until the default is put back.
  await box.fill('Always answer in French.')
  await box.blur()
  await win.getByRole('button', { name: 'Restore default' }).waitFor()
  assert.deepEqual([(await state()).principles.text, fs.readFileSync(`${tmp}/local-home/principles.md`, 'utf8')], ['Always answer in French.', 'Always answer in French.\n'])

  // What each bot is for, which the others are told.
  const line = win.getByLabel('What Assistant is for')
  assert.match(await line.inputValue(), /^Everyday questions and tasks/)
  await line.fill('Runs the household.')
  await line.blur()
  await until(async () => (await state()).bots[0].description === 'Runs the household.', 10_000)

  // Everything a bot is told, to read while tuning them.
  await win.getByRole('button', { name: 'Show', exact: true }).click()
  const told = win.locator('.prompt-text')
  await told.waitFor()
  assert.match(await told.innerText(), /^You are Assistant,[\s\S]*# Principles[\s\S]*Always answer in French\./)
  await shot('principles-told')
  await win.keyboard.press('Escape')

  await win.getByRole('button', { name: 'Restore default' }).click()
  await win.getByRole('button', { name: 'Restore default' }).waitFor({ state: 'detached' })
  assert.match(await box.inputValue(), /\*\*Work as a team\.\*\*/)
  assert.ok(!fs.existsSync(`${tmp}/local-home/principles.md`))

  // A bot's own page has its line too.
  await win.evaluate(() => (location.hash = '/settings/bots/assistant'))
  assert.equal(await win.getByLabel('What it is for', { exact: true }).inputValue(), 'Runs the household.')

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})
