// Drives the real desktop app (Electron), with its window kept off the screen. Everything the app
// touches is temporary: its own data, and the data of the servers it runs or talks to.
//   OPENKUMI_DESKTOP_APP   the program inside a packaged app, to test that instead of the source
//   OPENKUMI_TEST_SHOW=1   show the window while the tests run
//   OPENKUMI_TEST_NO_DICTATION=1   leave out dictation, on a Mac whose system could take it but has no speech models
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { after, before, test } from 'node:test'
import { _electron } from 'playwright-core'
import { startOAuthServer } from '../../server/test/fixtures/mcp-oauth.mjs'

const LOCAL_PORT = 4950 + Math.floor(Math.random() * 20)
const REMOTE_PORT = LOCAL_PORT + 25
const SERVER = path.resolve(import.meta.dirname, '../../server/src/index.ts')
const packaged = process.env.OPENKUMI_DESKTOP_APP
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-desktop-'))
// A copy of the superpowers that ship, so a test can point their services somewhere that is not the real one.
fs.cpSync(path.resolve(import.meta.dirname, '../../server/superpowers'), `${tmp}/superpowers`, { recursive: true })
// OPENKUMI_DESKTOP_YES answers the app's own confirmation dialogs, which a test cannot click.
const env = {
  ...process.env,
  OPENKUMI_DESKTOP_DATA: `${tmp}/app`,
  OPENKUMI_DESKTOP_YES: '1',
  OPENKUMI_DESKTOP_HIDDEN: process.env.OPENKUMI_TEST_SHOW ? '' : '1',
  OPENKUMI_HOME: `${tmp}/local-home`,
  OPENKUMI_PORT: String(LOCAL_PORT),
  OPENKUMI_MOCK: '1',
  OPENKUMI_SUPERPOWERS: `${tmp}/superpowers`,
  // The servers these tests start tell OpenKumi's makers nothing, and have no question to ask. The test of that says otherwise for itself.
  OPENKUMI_TELEMETRY: '0',
  // The app run from the source cannot be what the computer opens sign-ins with; the tests hand it them.
  OPENKUMI_DESKTOP_CATCH_SIGN_INS: '1',
  // Scripted stand-ins for the Claude Code, Codex and Grok programs, so the tests do not depend on what is installed here.
  OPENKUMI_CLAUDE_BIN: path.resolve(import.meta.dirname, '../../server/test/fixtures/fake-claude.mjs'),
  OPENKUMI_CODEX_BIN: path.resolve(import.meta.dirname, '../../server/test/fixtures/fake-codex.mjs'),
  OPENKUMI_GROK_BIN: path.resolve(import.meta.dirname, '../../server/test/fixtures/fake-grok.mjs'),
  // And for Tailscale's, which says the computer is on a tailnet.
  OPENKUMI_TAILSCALE_BIN: path.resolve(import.meta.dirname, '../../server/test/fixtures/fake-tailscale.mjs'),
}
delete env.ELECTRON_RUN_AS_NODE
delete env.OPENKUMI_DEV_URL

const up = (port) => fetch(`http://127.0.0.1:${port}/api/hello`).then((r) => r.ok, () => false)
/** A server keeps its data in the folder of the person it runs for: the first one in its list of people. */
const dataOf = (home) => `${tmp}/${home}/people/${JSON.parse(fs.readFileSync(`${tmp}/${home}/people.json`, 'utf8'))[0].name}`
const tokenOf = (home) => JSON.parse(fs.readFileSync(`${dataOf(home)}/auth.json`, 'utf8')).accessToken
/** A data folder whose one person has let other computers connect, as a server that ran before leaves it. */
function reachable(home) {
  fs.mkdirSync(`${tmp}/${home}/people/someone`, { recursive: true })
  fs.writeFileSync(`${tmp}/${home}/people.json`, JSON.stringify([{ name: 'someone', port: 4317 }]))
  fs.writeFileSync(`${dataOf(home)}/settings.json`, '{"lan": true}')
}
/**
 * Asks a server, with its own access code. A server that is just moving to another address (the
 * network setting was switched) drops what is connected to it: the question is then asked again.
 */
const ask = async (port, home, method, url, body) => {
  for (let tries = 0; ; tries++) {
    try {
      return await (await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { Authorization: `Bearer ${tokenOf(home)}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })).json()
    } catch (e) {
      if (tries >= 10 || !['ECONNRESET', 'ECONNREFUSED', 'UND_ERR_SOCKET'].includes(e?.cause?.code)) throw e
      await new Promise((r) => setTimeout(r, 200))
    }
  }
}

/** Pairs "this computer" with a server by hand, the way the app does, and returns the key it is given. */
async function pairWith(port, home, name = 'Test computer') {
  const { code } = await ask(port, home, 'POST', '/api/pairing')
  const sign = (who, ours, theirs) => crypto.createHmac('sha256', code.replaceAll('-', '')).update(`${who}:${ours}:${theirs}`).digest('hex')
  const post = async (url, body) => (await fetch(`http://127.0.0.1:${port}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  const nonce = crypto.randomBytes(16).toString('hex')
  const begun = await post('/api/pair/begin', { nonce })
  return post('/api/pair/finish', { nonce, serverNonce: begun.nonce, proof: sign('computer', nonce, begun.nonce), name })
}

/**
 * Waits until an element is in the same place in the window twice in a row, a moment apart. A click
 * goes where the element was when the click was worked out, so one that is still moving is missed.
 */
async function holdsStill(locator) {
  let last = null
  await until(async () => {
    const box = JSON.stringify(await locator.boundingBox())
    const still = box === last
    last = box
    return still
  }, 10_000)
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
/** What a test starts the app with, besides the usual. */
let switches = []
const launch = async () => {
  // A test that failed left its app open, and a second one would not start beside it: the tests after it would fail for that alone.
  await app?.close().catch(() => {})
  app = await _electron.launch({ executablePath: electron, args: [...(packaged ? [] : ['.']), ...switches], env })
  return app.firstWindow()
}
/** Waits until the window shows an environment that has a bot with this name. */
const showsBot = (win, name) => win.locator('.sidebar .item', { hasText: name }).first().waitFor({ timeout: 60_000 })
const settings = async (win) => {
  await win.evaluate(() => (location.hash = '/settings/environments'))
  await win.waitForSelector('#local-environment .switch')
}
/** Whose bots the window can show, as the app's menu lists them: everyone on this computer, then the other computers. */
const menu = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'People').submenu.items.filter((i) => i.type !== 'separator').map((i) => `${i.checked ? '*' : ''}${i.label}`))
/** What the switcher at the top of the sidebar (or of the settings) offers, the one showing marked with a star. Opened and closed again. */
async function switcher(win, where = '.sidebar') {
  await win.locator(`${where} .switcher-current`).click()
  const items = await win.locator(`${where} .switcher-item`).evaluateAll((all) => all.map((item) => `${item.getAttribute('aria-checked') === 'true' ? '*' : ''}${item.querySelector('.grow').textContent}`))
  await win.locator(`${where} .switcher-current`).click()
  return items
}
/** Picks, by its whole name, whose bots to show (or what else to do) in the switcher at the top of the sidebar (or of the settings). */
async function pick(win, name, where = '.sidebar') {
  await win.locator(`${where} .switcher-current`).click()
  await win.locator(`${where} .switcher-item`).filter({ has: win.locator('.grow').getByText(name, { exact: true }) }).click()
}
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
  reachable('remote-home')
  const remote = spawn(process.execPath, [SERVER], { env: { ...process.env, OPENKUMI_HOME: `${tmp}/remote-home`, OPENKUMI_PORT: String(REMOTE_PORT), OPENKUMI_MOCK: '1' }, stdio: 'ignore' })
  const remoteRow = (win) => win.locator('.set-row', { has: win.locator('h3:has-text("Other Mac")') })

  try {
    await until(() => up(REMOTE_PORT))
    const access = await ask(REMOTE_PORT, 'remote-home', 'GET', '/api/access')
    await ask(REMOTE_PORT, 'remote-home', 'POST', '/api/bots', { name: 'Far Helper', provider: 'mock' })
    const [address] = access.addresses
    assert.ok(address, 'this test needs the computer to be on a network')
    const origin = `http://${address}:${REMOTE_PORT}`

    // The first time, nothing is turned on and the app welcomes, with the ways to start.
    let win = await launch()
    const start = (title) => win.locator('.welcome-start', { hasText: title })
    await start('Run them on this computer').waitFor()
    // The window's page is the app's own, not one a server hands out.
    assert.equal(win.url(), 'openkumi://app/')
    assert.deepEqual(await win.locator('.welcome-start strong').allInnerTexts(), ['Run them on this computer', 'Connect to another computer'])
    // A bot jumps into other clothes when clicked (picked at random, so they may come out the same).
    const bear = win.locator('.hopper.front')
    const dressed = await bear.getAttribute('aria-label')
    for (let tries = 0; (await bear.getAttribute('aria-label')) === dressed; tries++) {
      assert.ok(tries < 5, 'the bot changes clothes')
      await bear.click()
      await new Promise((r) => setTimeout(r, 1000))
    }
    // Connecting to another computer opens the pairing form, which goes back to the welcome.
    await start('Connect to another computer').click()
    await win.waitForSelector('input[aria-label="Address of the other computer"]')
    await win.click('.welcome-back')
    await start('Connect to another computer').waitFor()
    assert.equal(await up(LOCAL_PORT), false, 'with the local environment off, no server runs here')
    assert.ok(!(await processes()).includes('OpenKumi Server'))
    // From here on the window must stay the same page: changing environments does not reload it.
    await win.evaluate(() => (window.sameWindow = true))

    // Bots belong to a person, and nobody has bots on this computer yet: whoever runs them here
    // first says what they are called, and is offered the name of their account on the computer.
    await start('Run them on this computer').click()
    const named = win.locator('input[aria-label="Your name here"]')
    await named.waitFor()
    assert.match(await named.inputValue(), /^[a-z0-9][a-z0-9-]*$/)
    assert.equal(await up(LOCAL_PORT), false, 'nothing starts before they have answered')
    // Typed as people write a name, it becomes one a folder can have.
    await named.fill('Juan Cruz')
    assert.equal(await named.inputValue(), 'juan-cruz')
    // (The screen fades in: a picture of it is taken once it has.)
    if (process.env.OPENKUMI_TEST_SHOTS) await new Promise((r) => setTimeout(r, 800)).then(() => win.screenshot({ path: path.join(process.env.OPENKUMI_TEST_SHOTS, 'welcome-name.png') }))
    // Then the server starts on this computer, in a process of its own, for that person, and is shown.
    await win.getByRole('button', { name: 'Start OpenKumi here' }).click()
    await showsBot(win, 'Kumi')
    assert.equal(await up(LOCAL_PORT), true)
    // Written down with the usual port: the one a server run from the repository has, unless this is the packaged app.
    assert.deepEqual(JSON.parse(fs.readFileSync(`${tmp}/local-home/people.json`, 'utf8')), [{ name: 'juan-cruz', port: packaged ? 4317 : 4417 }])
    assert.ok(fs.existsSync(`${tmp}/local-home/people/juan-cruz/auth.json`))
    assert.ok((await processes()).includes('OpenKumi Server'), 'the server is a process of its own inside the app')
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
    assert.match(await win.locator('#local-environment').innerText(), /Local environment\s*Showing now\s*OpenKumi runs on this computer\./)
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
    await remoteRow(win).locator(`p:has-text("Connected · via Home network · ${address}:${REMOTE_PORT}")`).waitFor()
    assert.deepEqual(await menu().then((m) => m.slice(0, 2)), ['*Juan Cruz', 'Other Mac'], 'adding an environment does not leave the one that is showing')

    // The key this computer was given is kept in a file only the owner can read. It is a key of
    // its own: the other server's access code never left that computer, and the code is used up.
    const saved = JSON.parse(fs.readFileSync(`${tmp}/app/desktop.json`, 'utf8'))
    assert.deepEqual([saved.local, saved.environments.map((e) => [e.name, e.addresses, e.enabled])], [{ enabled: true }, [['Other Mac', [{ url: origin }], true]]])
    assert.ok(saved.environments[0].token && saved.environments[0].token !== tokenOf('remote-home'))
    // ...with the other server's own id, to tell it from another one at any of its addresses.
    assert.match(saved.environments[0].serverId, /^s_/)
    assert.equal(fs.statSync(`${tmp}/app/desktop.json`).mode & 0o777, 0o600)
    // The other computer lists this one by its name.
    assert.equal((await ask(REMOTE_PORT, 'remote-home', 'GET', '/api/access')).computers.length, 1)

    // Open the remote environment; both are then offered in the sidebar's switcher and in the menu.
    await remoteRow(win).locator('button:has-text("Open")').click()
    await win.evaluate(() => (location.hash = '/'))
    await showsBot(win, 'Far Helper')
    assert.deepEqual(await switcher(win), ['Juan Cruz', 'Add a person', '*Other Mac', 'Connect to another computer'])
    assert.deepEqual(await menu().then((m) => m.slice(0, 2)), ['Juan Cruz', '*Other Mac'])
    // The switcher says whose bots these are, by the name their server gives, and where they are.
    assert.match(await win.locator('.sidebar .switcher-text').innerText(), /^Someone\s+Other Mac$/)

    // Turning the local environment off stops the server on this computer; the remote one keeps showing.
    await settings(win)
    await win.click('#local-environment .switch')
    await until(async () => !(await up(LOCAL_PORT)), 15_000)
    await win.waitForSelector('#local-environment:has-text("Turned off. Bots only run in remote environments.")')
    assert.ok(!(await processes()).includes('OpenKumi Server'))
    // ...and turning it on again starts it, without leaving the environment that is showing.
    await win.click('#local-environment .switch')
    await until(() => up(LOCAL_PORT))
    await until(async () => (await menu())[0] === 'Juan Cruz')
    assert.deepEqual(await menu().then((m) => m.slice(0, 2)), ['Juan Cruz', '*Other Mac'])

    // Turning off the environment that is showing moves the window to one that is still on.
    await remoteRow(win).locator('.switch').click()
    await win.evaluate(() => (location.hash = '/'))
    await showsBot(win, 'Kumi')
    assert.equal(await win.locator('.sidebar .item', { hasText: 'Far Helper' }).count(), 0)
    await settings(win)
    await remoteRow(win).locator('p:has-text("Turned off")').waitFor()
    // Removing an environment forgets it.
    await remoteRow(win).locator('summary').click()
    await remoteRow(win).locator('button:has-text("Remove")').click()
    await win.waitForSelector('#remote-environments:has-text("No remote environments")')

    // With no environment left, the app welcomes again, and no server runs here.
    await win.click('#local-environment .switch')
    await start('Run them on this computer').waitFor()
    await until(async () => !(await up(LOCAL_PORT)), 15_000)
    assert.equal(await win.evaluate(() => window.sameWindow), true, 'the window was never reloaded along the way')

    // Quitting stops the server the app started; the next start brings back what was on.
    await start('Run them on this computer').click()
    await showsBot(win, 'Kumi')
    await app.close()
    await until(async () => !(await up(LOCAL_PORT)), 15_000)
    assert.equal(await up(REMOTE_PORT), true, 'another environment is never touched')
    win = await launch()
    await showsBot(win, 'Kumi')
    await app.close()
    await until(async () => !(await up(LOCAL_PORT)), 15_000)

    // A server that is already running here is used as it is, and left running.
    const already = spawn(process.execPath, [SERVER], { env, stdio: 'ignore' })
    try {
      await until(() => up(LOCAL_PORT))
      win = await launch()
      await showsBot(win, 'Kumi')
      assert.ok(!(await processes()).includes('OpenKumi Server'), 'the app does not start a second one')
      await settings(win)
      assert.match(await win.locator('#local-environment').innerText(), /started outside this app/)
      // The people here are offered, but this app does not run their servers, so it is not where they are added, renamed or removed.
      assert.deepEqual(await switcher(win, '.set-nav'), ['*Juan Cruz', 'Connect to another computer'])
      await win.evaluate(() => (location.hash = '/settings/profile'))
      assert.match(await win.locator('#person').innerText(), /people are added, renamed and removed there: “openkumi people” in a terminal/)
      assert.equal(await win.getByRole('button', { name: 'Rename' }).count(), 0)
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
  await showsBot(win, 'Kumi')
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
  assert.match(await win.locator('.control-bar').innerText(), /Kumi has control\.\s+Take control/)
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
  // A key held down on the page is let go of there when the keyboard leaves it still down: ⌘K opens
  // the window's search, and the page is not left holding ⌘. The page turns green while ⌘ is down
  // on it, and blue once it is let go.
  const colour = (want) => until(async () => (([r, g, b]) => Math.abs(r - want[0]) < 12 && Math.abs(g - want[1]) < 12 && Math.abs(b - want[2]) < 12)(await middle()), 15_000)
  const paint = (rgb) => `document.body.style.background='rgb(${rgb})'`
  await win.locator('.address').fill(`data:text/html,<body style="margin:0;height:100vh;background:rgb(200,200,200)"><script>onkeydown=(e)=>{e.key==='Meta'&&(${paint('40,160,60')});e.key==='1'&&e.ctrlKey&&(${paint('230,140,20')})};onkeyup=(e)=>e.key==='Meta'&&(${paint('40,60,200')})</script>`)
  await win.keyboard.press('Enter')
  await colour([200, 200, 200])
  await win.locator('.pane .view').focus()
  await win.keyboard.down('Meta')
  await colour([40, 160, 60])
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['meta'] }))
  await win.locator('.palette').waitFor()
  await colour([40, 60, 200])
  await win.keyboard.up('Meta')
  await win.keyboard.press('Escape')
  await win.locator('.palette').waitFor({ state: 'detached' })
  // Only ⌘ and a number opens a bot; Ctrl and a number is the page's.
  await win.locator('.pane .view').focus()
  await win.keyboard.press('Control+1')
  await colour([230, 140, 20])
  // Handing back gives the window to the bot again.
  await win.getByRole('button', { name: 'Hand back' }).click()
  await until(async () => (await state()).browsers[bot.id].windows.every((w) => !w.controller), 10_000)
  await win.locator('.address[readonly]').waitFor()

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('a window the bot starts browsing in floats over the chat, docks beside it or fills the window, and is where the bot asks for help', async () => {
  const win = await launch()
  await showsBot(win, 'Kumi')
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
  await showsBot(win, 'Kumi')
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

  // A link to a page the bot saved opens it full size, in the same kind of frame; a link to any other of its files opens it in its workspace.
  await send('!tool write_file ' + JSON.stringify({ path: 'files/board.html', content: '<p id="saved">Saved page</p>' }))
  await send('See [the board](files/board.html) and [the notes](memory/notes.md).')
  const links = win.locator('.msg.assistant[data-item]').last()
  await links.getByRole('link', { name: 'the board' }).click()
  await win.frameLocator('.dialog.full iframe').locator('#saved').waitFor({ timeout: 10_000 })
  assert.equal(await win.locator('.dialog.full .dialog-head h2').innerText(), 'board.html')
  await win.keyboard.press('Escape')
  await links.getByRole('link', { name: 'the notes' }).click()
  await until(async () => /\/settings\/bots\/[^/]+\/workspace\/memory\/notes\.md$/.test(decodeURIComponent(await win.evaluate(() => location.hash))), 5000)
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
  assert.match(await frame.getAttribute('src'), /^openkumi:\/\/page\/[0-9a-f]{32}#theme=(light|dark)$/)
  const inside = win.frameLocator('.page iframe')
  assert.match(await inside.locator('#c').innerText(), /^#(3987e5|2a78d6)$/)
  await until(async () => (await win.locator('.page-frame').evaluate((el) => el.offsetHeight)) > 200, 10_000)
  // The page stands for the call that showed it, which is not listed as a step.
  assert.equal(await win.locator('.activity', { hasText: 'show_page' }).count(), 0)
  // The reply after it is written out first, so the page has stopped moving; and the turn is over,
  // so nothing below it comes or goes (the "Working" line) and moves it while its link is clicked.
  await win.locator('.msg.assistant[data-item]', { hasText: 'Tool result: Shown “Sales”' }).waitFor()
  await win.getByRole('button', { name: 'Stop', exact: true }).waitFor({ state: 'detached' })
  await holdsStill(inside.locator('#out'))
  // What the app saw when the page said its link was clicked, to tell a missed click from a refused one.
  await win.evaluate(() => {
    window.pageSaid = []
    addEventListener('message', (e) => e.data?.openkumi === 'open' && window.pageSaid.push({ focused: document.activeElement?.tagName, clicked: navigator.userActivation?.isActive }))
  })
  await inside.locator('#out').click()
  await until(async () => (await app.evaluate(() => globalThis.opened)).includes('https://example.com/more'), 5000).catch(async () => {
    throw new Error(`The page's link was not opened. What the app was told: ${JSON.stringify(await win.evaluate(() => window.pageSaid))}`)
  })

  // It is a site of its own: it cannot reach the app, what the app is given, or the network.
  const page = win.frames().find((f) => f.url().startsWith('openkumi://page/'))
  assert.equal(await page.evaluate(() => { try { return String(!!parent.document) } catch { return 'blocked' } }), 'blocked')
  assert.equal(await page.evaluate(() => typeof window.openkumiDesktop), 'undefined')
  await until(async () => (await page.title()) === 'refused', 5000)
  // Nor can it open anything without a click in it, or go to another site in its frame.
  await win.locator('.composer textarea').focus()
  await page.evaluate(() => setTimeout(() => parent.postMessage({ openkumi: 'open', url: 'https://example.com/unasked' }, '*'), 50))
  await page.evaluate(() => void (location.href = 'https://example.com/elsewhere'))
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.deepEqual(await app.evaluate(() => globalThis.opened), ['https://example.com/more'])
  assert.doesNotMatch(page.url(), /example\.com/)

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('files go up and come down, and another computer is paired and removed from the settings', async () => {
  const win = await launch()
  await showsBot(win, 'Kumi')
  win.on('dialog', (dialog) => dialog.accept())
  const bot = (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).bots[0]

  // The workspace opens on the bot's own instructions, drawn as Markdown, beside a tree that says what each part is for.
  await win.evaluate((id) => (location.hash = `/settings/bots/${id}/workspace`), bot.id)
  await win.locator('.file-read .md h1').first().waitFor()
  assert.equal(await win.locator('.file-row', { hasText: 'AGENTS.md' }).locator('.hint').innerText(), 'Its instructions')
  // A file is sent up to the bot's folder, among its working files...
  await win.locator('.files-tab input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('kept on the other side') })
  await win.locator('.file-row', { hasText: 'notes.txt' }).click()
  assert.equal(fs.readFileSync(`${dataOf('local-home')}/bots/${bot.id}/workspace/files/notes.txt`, 'utf8'), 'kept on the other side')
  await win.locator('.file-meta', { hasText: 'Working file' }).waitFor()
  assert.match(await win.locator('.file-meta').innerText(), /Changes to working files are not recorded\.$/)
  // ...and found again by its name.
  await win.getByRole('textbox', { name: 'Find a file' }).fill('note')
  assert.deepEqual(await win.locator('.file-tree .file-row .title').allInnerTexts(), ['notes.txt'])
  await win.getByRole('textbox', { name: 'Find a file' }).fill('')
  // What was recorded is under Changes, by day, each with what it changed.
  await win.getByRole('button', { name: 'Changes', exact: true }).click()
  await win.locator('.change-head', { hasText: 'Create workspace' }).click()
  await win.locator('.change-body .diff', { hasText: 'AGENTS.md' }).waitFor()
  await win.getByRole('button', { name: 'Files', exact: true }).click()
  // ...and saved back onto this computer. (The test answers the "save as" question by choosing the place beforehand.)
  await app.evaluate(({ session }, to) => session.defaultSession.once('will-download', (_event, item) => item.setSavePath(to)), `${tmp}/saved.txt`)
  await win.getByRole('button', { name: 'Download' }).click()
  await until(() => fs.existsSync(`${tmp}/saved.txt`) && fs.readFileSync(`${tmp}/saved.txt`, 'utf8') === 'kept on the other side', 15_000)

  // Letting another computer in, on the profile of whoever's bots are shown: a code is shown there, with this computer's address...
  await win.evaluate(() => (location.hash = '/settings/profile'))
  await win.locator('#lan .switch').click()
  await win.getByRole('button', { name: 'Pair a device' }).click()
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
  await win.waitForSelector('#paired-computers:has-text("No devices are paired")')
  assert.equal((await ask(LOCAL_PORT, 'local-home', 'GET', '/api/access')).computers.length, 0)
  assert.ok(key)

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('people: someone else gets bots of their own on this computer, picked at the top to show them, with a code for their own devices on their profile, and a server nobody else’s bots are on', async () => {
  let win = await launch()
  await showsBot(win, 'Kumi')
  const shot = (name) => process.env.OPENKUMI_TEST_SHOTS && win.screenshot({ path: path.join(process.env.OPENKUMI_TEST_SHOTS, `${name}.png`), fullPage: true })
  const listed = () => JSON.parse(fs.readFileSync(`${tmp}/local-home/people.json`, 'utf8'))
  /** The profile of whoever's bots are shown, once it is theirs. */
  const profile = async (name) => {
    await win.evaluate(() => (location.hash = '/settings/profile'))
    await win.locator('#person', { hasText: name }).waitFor({ timeout: 60_000 })
  }
  const showing = () => win.locator('.sidebar .switcher-text').innerText()
  const mine = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Mine Only', provider: 'mock' })

  // ---- the first person is whoever answered the welcome, and the local environment is theirs; the switcher says so
  await showsBot(win, 'Mine Only')
  assert.match(await showing(), /^Juan Cruz\s+This computer$/)
  await profile('Juan Cruz')
  assert.match(await win.locator('#person').innerText(), new RegExp(`Juan Cruz\\s*juan-cruz · bots on this computer · port ${LOCAL_PORT}`))
  assert.equal(await win.locator('#remove-person').count(), 0, 'nobody removes the first person from here')
  // The settings are grouped by whose they are: the person picked, then this app.
  assert.deepEqual(await win.locator('.set-nav-group h3').allInnerTexts(), ['Juan Cruz', 'This app'])

  // ---- someone else: a name is all it takes. Their server starts beside the first person's, and the app shows their bots, on their profile.
  await pick(win, 'Add a person', '.set-nav')
  const name = win.locator('input[aria-label="Name of the person to add"]')
  await name.fill('Juan Cruz')
  await win.getByRole('button', { name: 'Add', exact: true }).click()
  await win.locator('.dialog .notice.error', { hasText: 'juan-cruz has bots here already' }).waitFor()
  await name.fill('Ana')
  await win.getByRole('button', { name: 'Add', exact: true }).click()
  await profile('Ana')
  const ana = listed()[1]
  assert.deepEqual([listed().length, ana.name], [2, 'ana'])
  assert.ok(ana.port !== LOCAL_PORT && (await up(ana.port)), 'their server runs on a port of its own')
  assert.ok((await processes()).includes('OpenKumi Server (ana)'), 'in a process of its own inside the app, like the first person’s')
  assert.match(await win.locator('#person').innerText(), new RegExp(`ana · bots on this computer · port ${ana.port}`))
  assert.deepEqual(await win.locator('.set-nav-group h3').allInnerTexts(), ['Ana', 'This app'])
  assert.deepEqual(await menu().then((m) => m.slice(0, 2)), ['Juan Cruz', '*Ana'])
  // Their server has a first bot of its own, and none of the first person's.
  await win.evaluate(() => (location.hash = '/'))
  await showsBot(win, 'Kumi')
  assert.equal(await win.locator('.sidebar .item', { hasText: 'Mine Only' }).count(), 0)
  assert.match(await showing(), /^Ana\s+This computer$/)

  // ---- a code for one of their own devices, made by their server, on their profile
  await profile('Ana')
  await win.getByRole('button', { name: 'Pair a device' }).click()
  const code = await win.locator('.pair-code').innerText()
  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  const [address] = (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/access')).addresses
  assert.ok(address, 'this test needs the computer to be on a network')
  // The address shown is their server's, and so is what the picture for a phone carries.
  await win.locator('#pair .set-link-row', { hasText: `${address}:${ana.port}` }).waitFor()
  await win.locator('#pair svg.qr').waitFor()
  assert.match(await win.locator('#pair').innerText(), /Whatever is paired with it sees Ana’s bots, and nobody else’s/)
  await shot('people')

  // ---- the code lets a device into their server and no other: this app pairs with it as their own computer would
  const begin = (port) => fetch(`http://127.0.0.1:${port}/api/pair/begin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nonce: 'ab'.repeat(16) }) }).then((r) => r.status)
  assert.deepEqual([await begin(ana.port), await begin(LOCAL_PORT)], [200, 403], 'the first person’s server made no code')
  await pick(win, 'Connect to another computer', '.set-nav')
  await win.fill('input[aria-label="Address of the other computer"]', `${address}:${ana.port}`)
  await win.fill('input[aria-label="Pairing code"]', code)
  await win.click('button:has-text("Pair and add")')
  // Given no name, it is called what the server says it is: whose, and on which computer.
  const theirs = () => win.locator('.set-row', { has: win.locator('h3:has-text("Ana on ")') })
  await theirs().waitFor()
  const elsewhere = (await theirs().locator('h3').innerText()).replace(/\s*Showing now$/, '').trim()
  // Her profile lists it among her devices, and the code is put away.
  await profile('Ana')
  await win.locator('#paired-computers:not(:has-text("No devices are paired"))').waitFor({ timeout: 15_000 })
  await win.locator('.pair-code').waitFor({ state: 'detached' })
  // Picked in the switcher, her bots are reached over the network, as from her own computer.
  await pick(win, elsewhere, '.set-nav')
  await win.evaluate(() => (location.hash = '/'))
  await showsBot(win, 'Kumi')
  // Whose they are is said once: under her name, the computer they are on, as it calls itself.
  const computer = os.hostname().split('.')[0]
  // Kept to the 60 letters of a name, which cuts a long host name short (as GitHub's computers have).
  assert.equal(elsewhere, `Ana on ${computer}`.slice(0, 60))
  await until(async () => (await showing()) === `Ana\n${computer}`)
  assert.equal(await win.locator('.sidebar .item', { hasText: 'Mine Only' }).count(), 0)
  // Her profile, seen from a device of hers: no renaming or removing her, and her network switch only shown, as a device cannot let others in.
  await profile('Ana')
  assert.match(await win.locator('#person').innerText(), new RegExp(`Bots on ${computer}, which this app is paired with`))
  assert.equal(await win.locator('#lan .switch').count(), 0)
  assert.match(await win.locator('#lan').innerText(), /On\s*$/)
  assert.equal(await win.getByRole('button', { name: 'Rename' }).count() + (await win.locator('#remove-person').count()) + (await win.getByRole('button', { name: 'Pair a device' }).count()), 0)
  // Another computer's mark is drawn from whose bots it holds, as hers are everywhere else.
  await win.locator('.set-nav .switcher-current').click()
  const marks = () => win.locator('.set-nav .switcher-item .avatar').evaluateAll((all) => all.map((mark) => getComputedStyle(mark).backgroundColor))
  await until(async () => {
    const [, here, there] = await marks()
    return here && here === there
  }, 10_000)
  await win.locator('.set-nav .switcher-current').click()
  await win.evaluate(() => (location.hash = '/'))
  // People are looked after at the computer that runs the bots: everyone here is offered whichever shows.
  assert.deepEqual(await switcher(win), ['Juan Cruz', 'Ana', 'Add a person', `*${elsewhere}`, 'Connect to another computer'])
  await pick(win, 'Juan Cruz')
  await showsBot(win, 'Mine Only')
  await pick(win, 'Ana')
  await until(async () => (await showing()) === 'Ana\nThis computer')
  await showsBot(win, 'Kumi')

  // ---- everyone's servers stop with the app, and start with it; whoever was picked is shown again
  await app.close()
  await until(async () => !(await up(LOCAL_PORT)) && !(await up(ana.port)), 15_000)
  win = await launch()
  await until(() => up(ana.port))
  await until(async () => (await showing().catch(() => '')) === 'Ana\nThis computer', 60_000)
  await showsBot(win, 'Kumi')
  assert.equal(await win.locator('.sidebar .item', { hasText: 'Mine Only' }).count(), 0)

  // ---- another name, on their profile: their server is stopped for it, their folder is renamed with them, the app goes on showing them, and what was paired stays paired
  await profile('Ana')
  await win.getByRole('button', { name: 'Rename' }).click()
  await win.fill('input[aria-label="Name of ana"]', 'Anna')
  await win.keyboard.press('Enter')
  await profile('Anna')
  assert.deepEqual([listed().map((p) => p.name), fs.readdirSync(`${tmp}/local-home/people`).sort()], [['juan-cruz', 'anna'], ['anna', 'juan-cruz']])
  assert.ok((await processes()).includes('OpenKumi Server (anna)') && !(await processes()).includes('OpenKumi Server (ana)'))
  assert.match(await showing(), /^Anna\s+This computer$/)
  await settings(win)
  await theirs().locator('p:has-text("Connected")').waitFor({ timeout: 30_000 })

  // ---- the first person's own name: the local environment is stopped for it and comes back as theirs
  await pick(win, 'Juan Cruz', '.set-nav')
  await profile('Juan Cruz')
  await win.getByRole('button', { name: 'Rename' }).click()
  await win.fill('input[aria-label="Name of juan-cruz"]', 'juan')
  await win.keyboard.press('Enter')
  await until(async () => listed()[0].name === 'juan' && (await up(LOCAL_PORT)), 60_000)
  await profile('Juan')
  await win.evaluate(() => (location.hash = '/'))
  await showsBot(win, 'Mine Only')
  assert.ok(fs.existsSync(`${tmp}/local-home/people/juan/bots/${mine.id}/bot.md`) && !fs.existsSync(`${tmp}/local-home/people/juan-cruz`))

  // ---- removed from their profile: their server stops, they are off the list, what it held is kept, and the app goes back to the first person's bots
  await pick(win, 'Anna')
  await profile('Anna')
  await win.locator('#remove-person').getByRole('button', { name: 'Remove' }).click()
  await until(() => listed().length === 1, 30_000)
  await until(async () => !(await up(ana.port)), 15_000)
  assert.deepEqual(listed().map((p) => p.name), ['juan'])
  assert.ok(fs.existsSync(`${tmp}/local-home/people/anna/auth.json`), 'nothing of theirs was deleted')
  await profile('Juan')
  assert.match(await showing(), /^Juan\s+This computer$/)
  // The environment that was paired with it is this app's own business, and is taken away here.
  await settings(win)
  await theirs().locator('summary').click()
  await theirs().locator('button:has-text("Remove")').click()
  await theirs().waitFor({ state: 'detached' })
  await ask(LOCAL_PORT, 'local-home', 'DELETE', `/api/bots/${mine.id}`)

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('files go with a message: picked or taken out in the composer, pictures made smaller, kept by the conversation and copied to the bot\'s inbox', async () => {
  const win = await launch()
  await showsBot(win, 'Kumi')
  const bot = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Looker', provider: 'mock' })
  const files = `${dataOf('local-home')}/bots/${bot.id}/workspace/files`
  /** The names of the files waiting to go with a message, out of the bot's sight. */
  const waiting = () => {
    const dir = `${dataOf('local-home')}/bots/${bot.id}/private/attachments/waiting`
    return fs.existsSync(dir) ? fs.readdirSync(dir).flatMap((id) => fs.readdirSync(`${dir}/${id}`)).sort() : []
  }
  await win.evaluate((id) => (location.hash = `/${id}`), bot.id)
  await win.locator('.composer textarea').waitFor()

  // A picture larger than models see, and a PDF. The attach button is on the left, the model on the right.
  const boxes = await Promise.all(['.composer .attach', '.composer .model-picker'].map((s) => win.locator(s).boundingBox()))
  assert.ok(boxes[0].x < boxes[1].x)
  const wide = (width, height) => {
    const chunk = (type, data) => {
      const body = Buffer.concat([Buffer.from(type), data])
      const crc = Buffer.alloc(4)
      crc.writeUInt32BE(zlib.crc32(body))
      const size = Buffer.alloc(4)
      size.writeUInt32BE(data.length)
      return Buffer.concat([size, body, crc])
    }
    const head = Buffer.alloc(13)
    head.writeUInt32BE(width, 0)
    head.writeUInt32BE(height, 4)
    head.set([8, 2, 0, 0, 0], 8)
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x55)])
    return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(height).fill(row)))), chunk('IEND', Buffer.alloc(0))])
  }
  await win.locator('.composer input[type=file]').setInputFiles([
    { name: 'wide.png', mimeType: 'image/png', buffer: wide(3000, 1500) },
    { name: 'doc.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') },
    { name: 'not this.txt', mimeType: 'text/plain', buffer: Buffer.from('changed my mind') },
  ])
  await win.locator('.tray-item').nth(2).waitFor()
  await until(async () => !(await win.locator('.tray-wait').count()) && waiting().length === 3, 15_000)
  // Each goes up as soon as it is picked, and waits where the bot cannot see it; one taken out is thrown away.
  assert.ok(!fs.existsSync(`${files}/inbox`))
  await win.locator('.tray-item', { hasText: 'not this.txt' }).hover()
  await win.getByRole('button', { name: 'Remove not this.txt' }).click()
  await until(() => waiting().join() === 'doc.pdf,wide.png', 10_000)

  // Sent with words, the bot is shown the picture and told of both.
  await win.locator('.composer textarea').fill('look')
  await win.getByRole('button', { name: 'Send' }).click()
  await win.locator('.msg.assistant', { hasText: 'Echo: look [files/inbox/wide.png, files/inbox/doc.pdf; 1 shown]' }).waitFor()
  assert.equal(await win.locator('.tray-item').count(), 0)
  // The bot has its copies in its inbox; the picture went up no larger than models see.
  assert.deepEqual(fs.readdirSync(`${files}/inbox`).sort(), ['doc.pdf', 'wide.png'])
  assert.deepEqual([fs.readFileSync(`${files}/inbox/wide.png`).readUInt32BE(16), fs.readFileSync(`${files}/inbox/wide.png`).readUInt32BE(20)], [2048, 1024])
  // The conversation keeps its own: the bot deleting its copy changes nothing in it.
  fs.rmSync(`${files}/inbox`, { recursive: true })
  // In the conversation the picture is shown, and opens full size; the PDF is a card.
  await win.locator('.said .sent-picture img').waitFor()
  await win.locator('.said .sent-file', { hasText: 'doc.pdf' }).waitFor()
  await win.locator('.said .sent-picture').click()
  await win.locator('.picture-full img').waitFor()
  await win.keyboard.press('Escape')
  await win.locator('.picture-full').waitFor({ state: 'detached' })
  // The tests after this one know only the bots they made.
  await ask(LOCAL_PORT, 'local-home', 'DELETE', `/api/bots/${bot.id}`)

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('the app recovers when the server it relies on goes away or shuts it out, and keeps its code from an impostor', async () => {
  const configure = (config) => fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify(config))
  const localOnly = { local: { enabled: true }, environments: [], current: 'local' }

  // Something else has the usual port and says it is OpenKumi. It cannot show that it knows the
  // access code, so the app does not send it the code, and runs its own server beside it.
  const heard = []
  const impostor = http.createServer((req, res) => {
    heard.push(`${req.url} ${req.headers.authorization ?? ''}`)
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ app: 'openkumi', version: '0', authorized: true, home: dataOf('local-home'), proof: 'ff' }))
  })
  await new Promise((resolve) => impostor.listen(LOCAL_PORT, '127.0.0.1', resolve))
  configure(localOnly)
  let win = await launch()
  await showsBot(win, 'Kumi')
  assert.ok((await processes()).includes('OpenKumi Server'))
  assert.ok(heard.length > 0 && !heard.some((line) => line.includes(tokenOf('local-home'))), 'the impostor was asked who it is, and never given the access code')
  await app.close()
  await new Promise((resolve) => impostor.close(resolve))

  // A server the app joined, rather than started, stops: the app starts its own and the window comes back.
  const joined = spawn(process.execPath, [SERVER], { env, stdio: 'ignore' })
  await until(() => up(LOCAL_PORT))
  win = await launch()
  await showsBot(win, 'Kumi')
  assert.ok(!(await processes()).includes('OpenKumi Server'))
  joined.kill()
  await until(async () => (await processes()).includes('OpenKumi Server'), 30_000)
  await showsBot(win, 'Kumi')
  await win.locator('.toast').waitFor({ state: 'detached', timeout: 15_000 })
  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)

  // Another computer stops letting this one in: the window says so, instead of trying for ever.
  fs.mkdirSync(`${tmp}/far-home`, { recursive: true })
  const far = spawn(process.execPath, [SERVER], { env: { ...process.env, OPENKUMI_HOME: `${tmp}/far-home`, OPENKUMI_PORT: String(REMOTE_PORT), OPENKUMI_MOCK: '1' }, stdio: 'ignore' })
  try {
    await until(() => up(REMOTE_PORT))
    const given = await pairWith(REMOTE_PORT, 'far-home')
    configure({ local: { enabled: false }, environments: [{ id: 'remote-far', name: 'Far Mac', url: `http://127.0.0.1:${REMOTE_PORT}`, token: given.key, enabled: true }], current: 'remote-far' })
    win = await launch()
    await showsBot(win, 'Kumi')
    await ask(REMOTE_PORT, 'far-home', 'DELETE', `/api/computers/${given.id}`)
    await win.locator('.gate-head p', { hasText: 'Far Mac no longer lets this computer in.' }).waitFor({ timeout: 20_000 })
    // The list of environments is right there, to add it again with its new link.
    await win.locator('.gate .set-row', { hasText: 'Far Mac' }).waitFor()
    await app.close()
  } finally {
    far.kill()
  }
})

test('an environment has several addresses: one where something else answers is never sent the key, the next is used, and the app moves back when the first returns', async () => {
  reachable('many-home')
  const far = spawn(process.execPath, [SERVER], { env: { ...process.env, OPENKUMI_HOME: `${tmp}/many-home`, OPENKUMI_PORT: String(REMOTE_PORT), OPENKUMI_MOCK: '1', OPENKUMI_TAILSCALE_BIN: env.OPENKUMI_TAILSCALE_BIN }, stdio: 'ignore' })
  /** Listens on a port of its own on this computer; `handle` answers what arrives there. */
  const listen = async (server, port = 0) => (await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve)), `http://127.0.0.1:${server.address().port}`)
  // What anything that is not the server was sent: none of it may be the key.
  const heard = []
  const answering = (says) => http.createServer((req, res) => (heard.push(`${req.url} ${JSON.stringify(req.headers)}`), res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(says))))
  // A way to the server that can be cut and put back: a relay on a port of its own.
  const ways = new Set()
  const relay = () =>
    net.createServer((socket) => {
      const onward = net.connect(REMOTE_PORT, '127.0.0.1')
      ways.add(socket).add(onward)
      socket.pipe(onward).pipe(socket)
      socket.on('error', () => onward.destroy())
      onward.on('error', () => socket.destroy())
    })
  const servers = []
  try {
    await until(() => up(REMOTE_PORT))
    await ask(REMOTE_PORT, 'many-home', 'POST', '/api/bots', { name: 'Many Helper', provider: 'mock' })
    const given = await pairWith(REMOTE_PORT, 'many-home')
    // Something that says it is that server, and that it knows this computer, but cannot show it.
    const pretender = answering({ app: 'openkumi', version: '0.1.0', id: given.server, device: { known: true, proof: 'ab'.repeat(32) } })
    // Another OpenKumi server, which has never heard of this computer.
    const another = answering({ app: 'openkumi', version: '0.1.0', id: 's_another', device: { known: false } })
    let through = relay()
    servers.push(pretender, another)
    const [pretending, elsewhere, relayed] = [await listen(pretender), await listen(another), await listen(through)]
    const direct = `http://127.0.0.1:${REMOTE_PORT}`
    fs.writeFileSync(
      `${tmp}/app/desktop.json`,
      JSON.stringify({ local: { enabled: false }, environments: [{ id: 'remote-many', name: 'Many Mac', addresses: [{ url: pretending }, { url: relayed }, { url: direct }], token: given.key, enabled: true, serverId: given.server }], current: 'remote-many' }),
    )

    const win = await launch()
    await showsBot(win, 'Many Helper')
    await settings(win)
    const row = win.locator('.set-row', { has: win.locator('h3:has-text("Many Mac")') })
    const address = (url) => row.locator('.set-link-row', { has: win.locator(`code:text-is("${url.replace('http://', '')}")`) })
    await row.locator('button', { hasText: /\d+ addresses/ }).click()
    // The first address answered, but could not show it was the server: the second one is used.
    await address(relayed).locator('text=In use').waitFor()
    await address(pretending).locator('text=Something else answers').waitFor()
    assert.ok(heard.length > 0 && !heard.some((line) => line.includes(given.key)), 'what answered at the first address was asked who it is, and never given the key')

    // Connected, it learns the server's other addresses on the local network, and keeps them. Never
    // Tailscale ones, though the server is on a tailnet: away from home only https is used.
    const saved = () => JSON.parse(fs.readFileSync(`${tmp}/app/desktop.json`, 'utf8')).environments[0].addresses
    const homeIp = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i?.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))?.address
    if (homeIp) {
      await until(() => saved().some((a) => a.url === `http://${homeIp}:${REMOTE_PORT}` && a.found))
      await address(`http://${homeIp}:${REMOTE_PORT}`).locator('text=reported by it').waitFor()
    } else await new Promise((resolve) => setTimeout(resolve, 2000))
    assert.ok(!saved().some((a) => /ts\.net|\/\/100\./.test(a.url)), saved().map((a) => a.url).join(' '))
    assert.deepEqual(saved().filter((a) => !a.found), [{ url: pretending }, { url: relayed }, { url: direct }], 'the ones put in by hand stay as they were')

    // The way in use is cut: the app goes on through the next address that shows it is the server.
    through.close()
    ways.forEach((socket) => socket.destroy())
    await address(direct).locator('text=In use').waitFor({ timeout: 20_000 })
    await showsBot(win, 'Many Helper')
    // It comes back: on the next look (here, the network coming back), the app moves back to it.
    through = relay()
    await listen(through, Number(new URL(relayed).port))
    await win.evaluate(() => dispatchEvent(new Event('online')))
    await address(relayed).locator('text=In use').waitFor({ timeout: 20_000 })

    // The menu also leads there: with the list closed, Add address… opens it with the cursor in the field.
    const typed = win.locator('input[aria-label="Another address for Many Mac"]')
    await row.locator('button', { hasText: /\d+ addresses/ }).click()
    await typed.waitFor({ state: 'detached' })
    await row.locator('summary[aria-label="More for Many Mac"]').click()
    await row.locator('.set-menu-items button', { hasText: 'Add address…' }).click()
    await until(() => typed.evaluate((input) => input === document.activeElement).catch(() => false))
    assert.equal(await row.locator('details.set-menu').getAttribute('open'), null, 'the menu closes')
    const addButton = row.locator('.set-addresses button', { hasText: 'Add address' })

    // Adding an address: another server answers there, so it is not added, and is not sent the key.
    await typed.fill(elsewhere.replace('http://', ''))
    await addButton.click()
    await win.waitForSelector(`.notice.error:has-text("Something else answers at ${elsewhere.replace('http://', '')}, not Many Mac")`)
    // Where nothing answers yet, it is added, and only ever sent the key once it shows it is the server.
    await typed.fill('127.0.0.1:1')
    await addButton.click()
    await row.locator('text=Added. Nothing answers there right now').waitFor()
    await address('http://127.0.0.1:1').waitFor()
    await address('http://127.0.0.1:1').locator('button:has-text("Remove")').click()
    await address('http://127.0.0.1:1').waitFor({ state: 'detached' })
    assert.ok(!saved().some((a) => a.url === 'http://127.0.0.1:1'))
    // Enter pressed again while the address is still being asked does not keep it twice. What
    // answers there holds the questions until two have come, then says it is not OpenKumi to both.
    const held = []
    let asked = 0
    const holding = http.createServer((req, res) => {
      held.push(res)
      if (++asked >= 2) held.splice(0).forEach((r) => r.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'))
    })
    servers.push(holding)
    const quiet = await listen(holding)
    await typed.fill(quiet.replace('http://', ''))
    await typed.press('Enter')
    await typed.press('Enter')
    await row.locator('text=Added. Nothing answers there right now').waitFor()
    // Both were answered at the same moment: the second is saved by now, if it was going to be.
    await until(() => saved().some((a) => a.url === quiet))
    await new Promise((resolve) => setTimeout(resolve, 500))
    assert.equal(saved().filter((a) => a.url === quiet).length, 1, 'kept once')
    await address(quiet).locator('button:has-text("Remove")').click()
    await address(quiet).waitFor({ state: 'detached' })
    assert.ok(!heard.some((line) => line.includes(given.key)), 'nothing but the server was ever sent the key')
    through.close()
    ways.forEach((socket) => socket.destroy())
    await app.close()
  } finally {
    servers.forEach((server) => server.close())
    far.kill()
  }
})

test('superpowers: browse them, open one, activate it for one bot here or in the bot\'s settings, and sign the bot in', async () => {
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  // Notion and Linear are reached at a stand-in that asks for a sign-in the way they do, and approves it at once.
  const service = await startOAuthServer()
  try {
    const pointAt = (id, url) => {
      const file = `${tmp}/superpowers/${id}/superpower.json`
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
      fs.writeFileSync(file, JSON.stringify({ ...manifest, mcp: { ...manifest.mcp, url } }))
    }
    for (const id of ['notion', 'linear']) pointAt(id, service.url)
    const win = await launch()
    await showsBot(win, 'Kumi')
    win.on('dialog', (dialog) => dialog.accept())
    await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Second bot', provider: 'mock' })
    const powersOf = async () => Object.fromEntries((await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).bots.map((b) => [b.name, b.superpowers]))

    // The catalog: every superpower with what it is for, in the sidebar where skills, connections and plugins used to be,
    // grouped by what it is for (the same one in each group it belongs to), and searched or narrowed to a group.
    await win.evaluate(() => (location.hash = '/settings/superpowers'))
    await win.locator('.power-card').first().waitFor()
    const cards = () => win.locator('.power-card h3').allInnerTexts()
    assert.deepEqual(await win.locator('.set-section h2').allInnerTexts(), ['Productivity', 'Work', 'Creative', 'Marketing', 'Travel', 'Everyday'])
    const group = (name) => win.locator('.set-section', { has: win.locator('h2', { hasText: name }) }).locator('.power-card h3').allInnerTexts()
    assert.deepEqual(await group('Work'), ['Atlassian', 'Attio', 'ClickUp', 'Competitors', 'Fathom', 'folk', 'Granola', 'Jotform', 'Linear', 'Miro', 'Notion', 'Otter.ai', 'PandaDoc', 'PostHog', 'Sentry', 'T3 Code', 'tl;dv'])
    assert.deepEqual(await group('Travel'), ['Exchange rates', 'Holidays', 'Weather'])
    assert.equal((await cards()).filter((name) => name === 'Notion').length, 2, 'in Productivity and in Work')
    const nav = await win.locator('.set-nav').innerText()
    assert.match(nav, /Superpowers/)
    assert.doesNotMatch(nav, /Skills|Connections|Plugins/)
    const search = win.getByRole('textbox', { name: 'Search superpowers' })
    await search.fill('rain')
    await until(async () => (await cards()).join() === 'Weather')
    await search.fill('notion')
    await until(async () => (await cards()).join() === 'Notion')
    await search.fill('')
    await win.locator('.catalog-chips button', { hasText: 'Marketing' }).click()
    await until(async () => (await win.locator('.set-section h2').allInnerTexts()).join() === 'Marketing')
    assert.ok((await cards()).includes('SEO & AI search'))
    await win.locator('.catalog-chips button', { hasText: 'All' }).click()
    await win.locator('.power-card', { hasText: 'Notion' }).first().waitFor()

    // Its own page says what it does and what it gives a bot, and each bot has a button to activate it.
    await win.locator('.power-card', { hasText: 'Notion' }).first().click()
    await win.locator('.power-head h1', { hasText: 'Notion' }).waitFor()
    assert.match(await win.locator('.power-about').innerText(), /Lets a bot work in your Notion workspace/)
    assert.deepEqual(await win.locator('.set-section h2').allInnerTexts(), ['What a bot can do with it', 'Your bots', 'What it gives a bot'])
    const gives = win.locator('.set-section', { hasText: 'What it gives a bot' })
    assert.match(await gives.innerText(), /Skill[\s\S]*1 file[\s\S]*Tools from Notion on this computer/)
    // What it teaches a bot can be read here, formatted or as written, and not changed.
    await gives.getByRole('button', { name: 'Read the files' }).click()
    assert.deepEqual(await gives.locator('.skill-files .file-row').allInnerTexts(), ['instructions.md'])
    await gives.locator('.skill-text', { hasText: 'Use the tools whose names start with' }).waitFor()
    await gives.getByRole('button', { name: 'Source' }).click()
    assert.match(await gives.locator('.skill-source').innerText(), /^# Notion\n/)
    assert.equal(await gives.locator('textarea, [contenteditable]').count(), 0)
    await gives.getByRole('button', { name: 'Hide files' }).click()
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
    assert.deepEqual(await powersOf(), { Kumi: [], 'Second bot': ['notion'] }, 'only that bot gets it')

    // The bot's own settings have the same catalog, where what it has stands out in its groups. A superpower opened from
    // there is about that bot alone: its buttons are by the name, and no other bot is asked about.
    // Signing in inside the bot's browser shows that browser in the popup; the stand-in approves at once.
    const second = (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).bots.find((b) => b.name === 'Second bot')
    await win.evaluate((id) => (location.hash = `/settings/bots/${id}/superpowers`), second.id)
    await win.locator('.tabbar a[aria-selected="true"]', { hasText: 'Superpowers' }).waitFor()
    assert.equal(await win.locator('.tabbar a', { hasText: 'Superpowers' }).locator('.count').innerText(), '1')
    const mine = win.locator('.power-card.on')
    assert.deepEqual(await mine.locator('h3').allInnerTexts(), ['Notion', 'Notion'], 'in each of its groups')
    await mine.first().locator('.pill', { hasText: 'Active' }).waitFor()
    assert.deepEqual(await win.locator('.set-section h2').allInnerTexts(), ['Productivity', 'Work', 'Creative', 'Marketing', 'Travel', 'Everyday'])
    await win.locator('.power-card', { hasText: 'Linear' }).click()
    await win.locator('.power-head h1', { hasText: 'Linear' }).waitFor()
    assert.equal(await win.evaluate(() => location.hash), `#/settings/bots/${second.id}/superpowers/linear`)
    assert.match(await win.locator('.crumbs').innerText(), /Bots[\s\S]*Second bot[\s\S]*Linear/)
    assert.deepEqual(await win.locator('.set-section h2').allInnerTexts(), ['What a bot can do with it', 'What it gives a bot'])
    await win.locator('.power-head .power-standing', { hasText: 'Not active for Second bot' }).waitFor()
    await win.locator('.power-head').getByRole('button', { name: 'Activate superpower: Linear for Second bot' }).click()
    const again = win.locator('.dialog', { hasText: 'Activate Linear for Second bot' })
    await again.getByRole('button', { name: /Sign in inside Second bot’s browser/ }).click()
    await again.locator('p', { hasText: 'Linear is active for Second bot.' }).waitFor({ timeout: 30_000 })
    await again.getByRole('button', { name: 'Done' }).click()
    assert.deepEqual((await powersOf())['Second bot'], ['linear', 'notion'])
    await win.locator('.power-head .power-standing', { hasText: 'Signed in' }).waitFor({ timeout: 30_000 })
    // Notion is signed in, so deactivating it asks first (the test answers yes) and forgets the sign-in.
    await win.locator('.crumbs a', { hasText: 'Second bot' }).click()
    await mine.filter({ hasText: 'Linear' }).waitFor()
    await mine.filter({ hasText: 'Notion' }).first().click()
    await win.locator('.power-head').getByRole('button', { name: 'Deactivate superpower: Notion for Second bot' }).click()
    await until(async () => (await powersOf())['Second bot'].join() === 'linear')

    // The list shows where each one is active.
    await win.evaluate(() => (location.hash = '/settings/superpowers'))
    await win.locator('.power-card.on', { hasText: 'Linear' }).locator('.pill', { hasText: 'Active for 1 of 2 bots' }).waitFor()
    await win.locator('.power-card', { hasText: 'Notion' }).locator('.pill').first().waitFor({ state: 'detached' })

  } finally {
    await app?.close().catch(() => {})
    await service.close()
  }
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('a bot has one conversation: starting fresh sets it aside, and earlier ones are searched, read and continued', async () => {
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Kumi')
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
  await win.locator('.msg.report', { hasText: '“Scout” completed' }).waitFor({ timeout: 20_000 })

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('the window’s search: ⌘K from anywhere finds bots, settings and what was said, Tab opens a bot up, and ⌘1–9 open bots, numbered while ⌘ is held', async () => {
  fs.mkdirSync(`${tmp}/app`, { recursive: true })
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Kumi')
  const kumi = (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).bots.find((b) => b.name === 'Kumi')
  const heron = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Heron', provider: 'mock', description: 'Watches the lake' })
  await showsBot(win, 'Heron')
  const told = await ask(LOCAL_PORT, 'local-home', 'POST', `/api/bots/${heron.id}/messages`, { text: 'The nest is by the north shore.' })
  await until(async () => (await ask(LOCAL_PORT, 'local-home', 'GET', `/api/threads/${told.id}`)).thread.status === 'idle', 20_000)
  const here = () => win.evaluate(() => location.hash)
  const palette = win.locator('.palette')
  const titles = (where = palette) => where.locator('.palette-title').allInnerTexts()
  const group = (name) => palette.locator(`[role=group][aria-label="${name}"]`)

  // ⌘K opens it while a message is being written: the bots first, with their numbers, then what can be done in the chat showing.
  await win.locator('.sidebar .row.bot', { hasText: 'Kumi' }).click()
  await win.locator('.composer textarea').fill('half a thought')
  await win.keyboard.press('Meta+K')
  await palette.waitFor()
  // In the sidebar's order, which has the bots the tests before this one made as well.
  const order = await win.locator('.sidebar a.row.bot').evaluateAll((rows) => rows.map((row) => [row.dataset.bot, row.querySelector('.name').textContent]))
  const numbers = order.slice(0, 9).map((_, i) => `⌘${i + 1}`)
  assert.deepEqual(await titles(group('Bots')), order.map(([, name]) => name))
  assert.deepEqual(await group('Bots').locator('kbd').allInnerTexts(), numbers)
  assert.ok((await titles(group('The chat you’re in'))).includes('Show the browser'))
  // ⌘K again closes it, and the message is where it was, with the keyboard.
  await win.keyboard.press('Meta+K')
  await palette.waitFor({ state: 'detached' })
  assert.equal(await win.evaluate(() => document.activeElement?.tagName), 'TEXTAREA')
  assert.equal(await win.locator('.composer textarea').inputValue(), 'half a thought')

  // Part of a name finds the bot; Enter opens its conversation. What it is for finds it too.
  await win.keyboard.press('Meta+K')
  await win.keyboard.type('her')
  assert.equal(await palette.locator('.palette-row.selected .palette-title').innerText(), 'Heron')
  await win.keyboard.press('Enter')
  await palette.waitFor({ state: 'detached' })
  await until(async () => (await here()) === `#/${heron.id}`, 10_000)
  await win.keyboard.press('Meta+K')
  await win.keyboard.type('lake')
  assert.equal(await palette.locator('.palette-row.selected .palette-detail').innerText(), 'Watches the lake')

  // Words that were said are found in every bot's conversations, after a moment, and open the conversation at that message.
  await win.locator('.palette-search input').fill('north shore')
  await group('In messages').locator('.palette-row').first().waitFor()
  assert.deepEqual(await titles(group('In messages')), ['Heron', 'You, to Heron'])
  await group('In messages').locator('.palette-row', { hasText: 'You, to Heron' }).click()
  await win.locator('.msg.user.found', { hasText: 'The nest is by the north shore.' }).waitFor()

  // A setting opens its page with the row lit; nothing is changed from the search.
  await win.keyboard.press('Meta+K')
  await win.keyboard.type('enter sends')
  await palette.locator('.palette-row.selected', { hasText: 'Enter sends the message' }).waitFor()
  await win.keyboard.press('Enter')
  await win.locator('#enter-sends.found').waitFor()
  assert.equal(await here(), '#/settings/chat')
  // Over the settings, Escape closes the search and leaves the settings open.
  await win.keyboard.press('Meta+K')
  await palette.waitFor()
  await win.keyboard.press('Escape')
  await palette.waitFor({ state: 'detached' })
  assert.equal(await here(), '#/settings/chat')

  // Tab opens a bot up: all that can be done with it, its settings and files. Backspace goes back out.
  await win.keyboard.press('Meta+K')
  await win.keyboard.type('heron')
  await win.keyboard.press('Tab')
  await palette.locator('.palette-level', { hasText: 'Heron' }).waitFor()
  assert.equal(await win.locator('.palette-search input').inputValue(), '')
  for (const title of ['Open the conversation', 'Start fresh', 'Bot settings', 'Superpowers', 'Files', 'New automation']) assert.ok((await titles()).includes(title), title)
  await win.keyboard.type('files')
  await win.keyboard.press('Enter')
  await until(async () => (await here()) === `#/settings/bots/${heron.id}/workspace`, 10_000)
  await win.keyboard.press('Meta+K')
  await win.keyboard.type('heron')
  await win.keyboard.press('Tab')
  await win.keyboard.press('Backspace')
  await palette.locator('.palette-level').waitFor({ state: 'detached' })
  // ">" first lists only what can be done: no bots, settings or messages.
  await win.keyboard.type('>')
  assert.equal(await group('Bots').count(), 0)
  assert.ok((await titles()).includes('New bot…'))
  await win.keyboard.press('Escape')
  await palette.waitFor({ state: 'detached' })

  // What only a conversation can do is asked of it, once it is showing: the model picker of a bot
  // whose conversation was not, and the files to send.
  await win.keyboard.press('Meta+K')
  await win.keyboard.type('kumi')
  await win.keyboard.press('Tab')
  await win.keyboard.type('model')
  await win.keyboard.press('Enter')
  await until(async () => (await here()) === `#/${kumi.id}`, 10_000)
  await win.locator('.model-pop').waitFor()
  await win.keyboard.press('Escape')
  await win.locator('.model-pop').waitFor({ state: 'detached' })
  const chooser = win.waitForEvent('filechooser')
  await win.keyboard.press('Meta+K')
  await win.keyboard.type('send files')
  await win.keyboard.press('Enter')
  assert.ok((await chooser).isMultiple())
  // For a bot whose conversation is not in view, it is opened first, and the files are chosen there.
  const elsewhere = win.waitForEvent('filechooser', { timeout: 10_000 })
  await win.keyboard.press('Meta+K')
  await win.keyboard.type('heron')
  await win.keyboard.press('Tab')
  await win.keyboard.type('send files')
  await win.keyboard.press('Enter')
  await elsewhere
  await until(async () => (await here()) === `#/${heron.id}`, 10_000)
  // Starting fresh sets the conversation aside; the earlier ones open from the bot, opened up.
  await win.keyboard.press('Meta+K')
  await win.keyboard.type('heron')
  await win.keyboard.press('Tab')
  await win.keyboard.type('start fresh')
  await win.keyboard.press('Enter')
  await until(async () => (await here()) === `#/${heron.id}`, 10_000)
  await win.locator('.msg', { hasText: 'north shore' }).first().waitFor({ state: 'detached' })
  await win.keyboard.press('Meta+K')
  await win.keyboard.type('heron')
  await win.keyboard.press('Tab')
  await win.keyboard.type('earlier')
  await win.keyboard.press('Enter')
  await palette.locator('.palette-level', { hasText: 'Earlier' }).waitFor()
  assert.deepEqual(await titles(), ['The nest is by the north shore.'])
  await win.keyboard.press('Enter')
  await palette.waitFor({ state: 'detached' })
  await until(async () => new RegExp(`^#/${heron.id}/t_[\\w-]+$`).test(await here()), 10_000).catch(async (e) => assert.fail(`${e.message}: the window is at ${await here()}`))
  await win.locator('.heading', { hasText: 'Earlier conversation' }).waitFor()
  assert.match(await win.locator('.heading').innerText(), /^The nest is by the north shore\.\s+Earlier conversation · /)

  // ⌘1–9 open the bots, in the sidebar's order, from anywhere, the settings included.
  await win.keyboard.press('Meta+1')
  await until(async () => (await here()) === `#/${order[0][0]}`, 10_000)
  // Holding ⌘ a moment shows each bot's number in place of its mark, on the row under the pointer
  // too; they go when it is let go.
  await win.locator('.sidebar .row.bot').first().hover()
  await win.keyboard.down('Meta')
  await win.locator('.sidebar kbd.bot-number').first().waitFor()
  assert.deepEqual(await win.locator('.sidebar kbd.bot-number').allInnerTexts(), numbers)
  assert.ok(await win.locator('.sidebar kbd.bot-number').first().isVisible())
  const heronAt = order.findIndex(([id]) => id === heron.id) + 1
  assert.ok(heronAt >= 1 && heronAt <= 9)
  await win.keyboard.press(String(heronAt))
  await until(async () => (await here()) === `#/${heron.id}`, 10_000)
  await win.keyboard.up('Meta')
  await win.locator('.sidebar kbd.bot-number').first().waitFor({ state: 'detached' })
  // A quick shortcut with ⌘ never shows them.
  await win.keyboard.press('Meta+C')
  await new Promise((r) => setTimeout(r, 600))
  assert.equal(await win.locator('.sidebar kbd.bot-number').count(), 0)

  // A conversation picked in the search comes out from under its bot's browser filling the window;
  // under it, it is not "the chat you're in".
  await win.keyboard.press('Meta+K')
  await win.keyboard.type('show the browser')
  await win.keyboard.press('Enter')
  await win.locator('.pane').getByRole('button', { name: 'Full screen' }).click()
  await win.locator('.pane.full').waitFor()
  await win.keyboard.press('Meta+K')
  await palette.waitFor()
  assert.equal(await group('The chat you’re in').count(), 0)
  await win.keyboard.type('heron')
  await win.keyboard.press('Enter')
  await win.locator('.pane.full').waitFor({ state: 'detached' })
  await win.locator('.pane').getByRole('button', { name: 'Full screen' }).waitFor()

  // The sidebar's Search opens it too, and so does Search… in the menu bar.
  await win.locator('.side-search').click()
  await palette.waitFor()
  await win.keyboard.press('Escape')
  await palette.waitFor({ state: 'detached' })
  await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.find((i) => i.label === 'View').submenu.items.find((i) => i.label === 'Search…').click())
  await palette.waitFor()
  // ⌘K from the computer's own keyboard is taken by the app before the window or the menu can see it:
  // once per press, wherever the keyboard is.
  const realCommandK = () =>
    app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents
      contents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['meta'] })
      contents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: ['meta'] })
    })
  await realCommandK()
  await palette.waitFor({ state: 'detached' })
  await realCommandK()
  await palette.waitFor()
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(await palette.count(), 1)
  // Held down, it opens once, however often the key repeats.
  await win.keyboard.press('Escape')
  await palette.waitFor({ state: 'detached' })
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['meta'] })
    for (let i = 0; i < 3; i++) contents.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['meta', 'isAutoRepeat'] })
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: ['meta'] })
  })
  await palette.waitFor()
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(await palette.count(), 1)

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('what is said to a busy bot waits in view, to be taken back, sent now or let go; a message between bots shows in both conversations', async () => {
  fs.mkdirSync(`${tmp}/app`, { recursive: true })
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Kumi')
  const busy = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Busy', provider: 'mock' })
  const other = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Other', provider: 'mock' })
  await ask(LOCAL_PORT, 'local-home', 'PATCH', '/api/settings', { maxSteps: 500 })
  const here = () => win.evaluate(() => location.hash)
  const send = async (text) => {
    await win.locator('.composer textarea').fill(text)
    await win.keyboard.press('Meta+Enter')
  }
  const waiting = (text) => win.locator('.waiting-card', { hasText: text })
  await win.locator('.sidebar .row.bot', { hasText: 'Busy' }).click()
  await win.locator('.empty h1', { hasText: 'Busy' }).waitFor()

  // What is said while the bot works waits under what it is doing, in the order it will be read.
  await send('!steps 400')
  await win.locator('.msg.user', { hasText: '!steps 400' }).waitFor()
  await send('never mind')
  await send('read this now')
  await waiting('read this now').waitFor()
  assert.deepEqual(await win.locator('.waiting-card .waiting-text').allInnerTexts(), ['never mind', 'read this now'])
  assert.match(await win.locator('.waiting-head').innerText(), /^waiting\s+Busy reads these, one at a time, when it is done with what it is doing\.$/i)
  // One is taken back, and never read; the other is sent now, and read as the bot works.
  await waiting('never mind').getByRole('button', { name: 'Take this message back' }).click()
  await waiting('never mind').waitFor({ state: 'detached' })
  await waiting('read this now').getByRole('button', { name: 'Send now' }).click()
  await win.locator('.msg.assistant', { hasText: 'Echo: read this now' }).waitFor({ timeout: 30_000 })
  await win.locator('.waiting').waitFor({ state: 'detached' })
  assert.equal(await win.locator('.msg.user', { hasText: 'never mind' }).count(), 0)
  const calls = (await ask(LOCAL_PORT, 'local-home', 'GET', `/api/threads/${(await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).threads.find((t) => t.botId === busy.id).id}`)).items.filter((i) => i.data.type === 'function_call').length
  assert.ok(calls > 0 && calls < 400, `the bot was told as it worked, after ${calls} steps`)

  // A bot that is stopped holds back what was waiting, until it is let go.
  await send('!slow')
  await win.locator('.msg.user', { hasText: '!slow' }).waitFor()
  await send('held one')
  await waiting('held one').waitFor()
  await win.getByRole('button', { name: 'Stop', exact: true }).click()
  await win.locator('.waiting-head', { hasText: /held back/i }).waitFor()
  assert.equal(await win.locator('.msg.assistant', { hasText: 'Echo: held one' }).count(), 0)
  await win.locator('.waiting-head').getByRole('button', { name: 'Resume' }).click()
  await win.locator('.msg.assistant', { hasText: 'Echo: held one' }).waitFor({ timeout: 20_000 })

  // A message to another bot is shown here as what was sent, and there as what came; each opens the other.
  // Files of the sender's that go with it are shown in both, from the copies the other conversation keeps.
  const shot = (name) => process.env.OPENKUMI_TEST_SHOTS && win.screenshot({ path: path.join(process.env.OPENKUMI_TEST_SHOTS, `${name}.png`) })
  const trip = `${dataOf('local-home')}/bots/${busy.id}/workspace/files/trip`
  fs.mkdirSync(trip, { recursive: true })
  fs.writeFileSync(`${trip}/plan.md`, 'Day 1: Alfama')
  fs.writeFileSync(`${trip}/map.png`, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'))
  await send(`!tool message_bot {"bot_id":"${other.id}","message":"plan a trip to Lisbon","reply_wanted":true,"files":["files/trip/plan.md","files/trip/map.png"]}`)
  const sent = win.locator('.msg.between.to', { hasText: 'plan a trip to Lisbon' })
  await sent.waitFor({ timeout: 20_000 })
  await sent.locator('.sent-file', { hasText: 'plan.md' }).waitFor()
  await sent.locator('.sent-picture img').waitFor()
  await shot('between-sent')
  assert.match(await sent.locator('.between-head').innerText(), /^to other\s*asked for a reply$/i)
  assert.equal(await win.locator('.step', { hasText: 'Write to' }).count(), 0, 'the card stands for the call that sent it')
  await sent.locator('.between-head').click()
  const came = win.locator('.msg.between.from.found', { hasText: 'plan a trip to Lisbon' })
  await came.waitFor({ timeout: 20_000 })
  assert.match(await here(), new RegExp(`^#/${other.id}/t_[\\w-]+/\\d+$`))
  assert.match(await came.locator('.between-head').innerText(), /^from busy\s*asks for a reply$/i)
  await came.locator('.sent-file', { hasText: 'plan.md' }).waitFor()
  await came.locator('.sent-picture img').waitFor()
  await shot('between-came')
  assert.equal(fs.readFileSync(`${dataOf('local-home')}/bots/${other.id}/workspace/files/inbox/plan.md`, 'utf8'), 'Day 1: Alfama')
  await came.locator('.between-head').click()
  await win.locator('.msg.between.to.found', { hasText: 'plan a trip to Lisbon' }).waitFor({ timeout: 20_000 })
  assert.match(await here(), new RegExp(`^#/${busy.id}/t_[\\w-]+/\\d+$`))

  // Messages between bots are switched off in the settings.
  await win.evaluate(() => (location.hash = '/settings/bots'))
  await win.locator('#bot-messages .switch').click()
  await until(async () => (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).settings.botMessages === false, 10_000)

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('what a bot has for its owner: a mark beside each bot, gone once its conversation is in front; what it waits for over the composer; a count and notifications outside the window', async () => {
  fs.mkdirSync(`${tmp}/app`, { recursive: true })
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Kumi')
  const local = (method, url, body) => ask(LOCAL_PORT, 'local-home', method, url, body)
  const [quiet, asker, planner] = await Promise.all(['Quiet', 'Asker', 'Planner'].map((name) => local('POST', '/api/bots', { name, provider: 'mock' })))
  await showsBot(win, 'Planner')
  const row = (name) => win.locator('.sidebar .row.bot', { hasText: name })
  const send = async (text) => {
    await win.locator('.composer textarea').fill(text)
    await win.keyboard.press('Meta+Enter')
  }
  const shot = (name) => process.env.OPENKUMI_TEST_SHOTS && win.screenshot({ path: path.join(process.env.OPENKUMI_TEST_SHOTS, `${name}.png`) })
  // What the app shows outside its window. With its window off the screen it only notes that, for this to read.
  const hidden = !process.env.OPENKUMI_TEST_SHOW
  const outside = () => app.evaluate(() => ({ count: globalThis.attention.count, shown: globalThis.attention.shown.map((notice) => `${notice.title} | ${notice.body}`) }))
  /** The notifications about the bots made here: the tests before left bots of their own, some with something for their owner. */
  const shown = async () => (await outside()).shown.filter((notice) => /^(Asker|Planner)\b/.test(notice))
  /** How many of those bots the icon counted before anything happened here, once the window had said. */
  let counted = 0
  if (hidden) {
    let last = -1
    await until(async () => {
      const was = last
      last = (await outside()).count
      return was === last
    }, 10_000)
    counted = last
  }
  // Tests keep the window off the screen, where nothing in it counts as looked at: from here on it says it is in front.
  const inFront = () =>
    win.evaluate(() => {
      document.hasFocus = () => true
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      dispatchEvent(new Event('focus'))
    })
  await win.locator('.sidebar .row.bot', { hasText: 'Kumi' }).first().click()

  // Things happen in other bots' conversations while the window shows Kumi's: each bot wears a mark for it.
  await local('POST', `/api/bots/${quiet.id}/messages`, { text: 'hello' })
  await row('Quiet').locator('.dot.new').waitFor({ timeout: 30_000 })
  assert.equal(await row('Quiet').locator('.time').count(), 1, 'when it happened stays beside the dot')
  await local('POST', `/api/bots/${asker.id}/messages`, { text: '!tool notify_user {"kind":"answer","reason":"Which flight to book"}' })
  await row('Asker').locator('.pill.mark.warn', { hasText: 'Needs you' }).waitFor({ timeout: 30_000 })
  assert.equal(await row('Asker').getAttribute('title'), 'Needs you: Which flight to book')
  await local('POST', `/api/bots/${planner.id}/messages`, { text: '!tool notify_user {"kind":"read","reason":"Design review moved to 3 pm"}' })
  await row('Planner').locator('.pill.mark.new', { hasText: 'Read this' }).waitFor({ timeout: 30_000 })
  assert.equal(await row('Planner').getAttribute('title'), 'Read this: Design review moved to 3 pm')
  await shot('attention-marks')

  // Outside the window: the app's icon counts the three, and the two that cannot wait are notified.
  if (hidden) {
    await until(async () => (await outside()).count === counted + 3, 10_000)
    assert.deepEqual(await shown(), ['Asker needs you | Which flight to book', 'Planner: read this | Design review moved to 3 pm'])
    // A notification that is clicked opens its bot.
    await app.evaluate((_, id) => globalThis.attention.click(id), planner.id)
    await until(async () => (await win.evaluate(() => location.hash)) === `#/${planner.id}`, 10_000)
  } else {
    await row('Planner').click()
  }

  // A conversation in front of its owner is read: what was to be read is no longer marked, here or on the icon.
  await win.locator('.msg.assistant').first().waitFor()
  await inFront()
  await row('Planner').locator('.pill').waitFor({ state: 'detached', timeout: 10_000 })
  await until(async () => (await local('GET', '/api/state')).threads.find((t) => t.botId === planner.id).flag === null, 10_000)
  if (hidden) await until(async () => (await outside()).count === counted + 2, 10_000)

  // What a bot waits for is said over the composer. Reading it is not answering it: it stays until it is cleared, or the owner writes.
  await row('Asker').click()
  const strip = win.locator('.needs-you')
  await strip.waitFor()
  assert.match(await strip.innerText(), /^Asker needs you: Which flight to book\s*Clear$/)
  await shot('attention-needs-you')
  await until(async () => { const t = (await local('GET', '/api/state')).threads.find((t) => t.botId === asker.id); return t.readTo === t.told }, 10_000)
  assert.equal(await row('Asker').locator('.pill.mark.warn').count(), 1)
  await strip.getByRole('button', { name: 'Clear' }).click()
  await strip.waitFor({ state: 'detached' })
  await row('Asker').locator('.pill').waitFor({ state: 'detached' })
  await send('!tool notify_user {"kind":"answer","reason":"Go ahead?"}')
  await strip.filter({ hasText: 'Go ahead?' }).waitFor({ timeout: 30_000 })
  await send('yes')
  await strip.waitFor({ state: 'detached' })
  await win.locator('.msg.assistant', { hasText: 'Echo: yes' }).waitFor({ timeout: 30_000 })
  // What it says while its owner looks at it is read as it comes.
  await until(async () => { const t = (await local('GET', '/api/state')).threads.find((t) => t.botId === asker.id); return t.status === 'idle' && t.readTo === t.told }, 10_000)
  assert.equal(await row('Asker').locator('.dot.new, .pill').count(), 0)

  // What a bot asks with ask_user is answered over the composer, in place of the line that only says it waits:
  // one question in front at a time, its options to press, and room for an answer of one's own.
  const asked = {
    questions: [
      { question: 'Which flight should I book?', header: 'Flight', options: [{ label: 'Lufthansa, 9:40', description: 'Direct, 212 €, lands 11:05' }, { label: 'Iberia, 11:15', description: 'One stop in Madrid, 168 €' }] },
      { question: 'Which extras do you want with it?', header: 'Extras', options: ['Checked bag', 'Seat by the window', 'Meal'], multiple: true },
      { question: 'Who travels with you?' },
    ],
  }
  await send(`!tool ask_user ${JSON.stringify(asked)}`)
  const card = win.locator('.questions')
  await card.waitFor({ timeout: 30_000 })
  assert.equal(await strip.count(), 0)
  await row('Asker').locator('.pill.mark.warn', { hasText: 'Needs you' }).waitFor()
  assert.equal(await row('Asker').getAttribute('title'), 'Needs you: Which flight should I book?')
  // Where it asked, the conversation keeps the questions, to read back later.
  assert.match(await win.locator('.msg.asked').innerText(), /^Asked you\s+Which flight should I book\?\s+Which extras do you want with it\?\s+Who travels with you\?$/i)
  assert.match(await card.locator('.questions-head').innerText(), /^Asker needs you · Flight\s+1 of 3$/i)
  const sendAnswers = card.getByRole('button', { name: 'Send answers' })
  await shot('questions-one-of-several')
  // One answer chosen goes on to the next question by itself; several are ticked, and another can be written.
  await card.getByRole('radio', { name: /Iberia/ }).click()
  await card.locator('.question-text', { hasText: 'Which extras' }).waitFor()
  await card.getByRole('checkbox', { name: 'Checked bag' }).click()
  await card.getByRole('checkbox', { name: 'Meal' }).click()
  await card.locator('.question-own').fill('A vegetarian one')
  await shot('questions-any-that-fit')
  // Enter in the field goes on, and leaves the keyboard in the next question's field.
  await card.locator('.question-own').press('Enter')
  // One with nothing to choose from is written, or left out: what was answered before is kept, and enough to send.
  await card.locator('.question-text', { hasText: 'Who travels with you?' }).waitFor()
  assert.equal(await card.locator('.question-option').count(), 0)
  assert.equal(await card.locator('.question-own').evaluate((field) => field === document.activeElement && field.value === ''), true)
  await card.getByRole('button', { name: 'Back' }).click()
  assert.equal(await card.getByRole('checkbox', { name: 'Meal' }).getAttribute('aria-checked'), 'true')
  assert.equal(await card.locator('.question-own').inputValue(), 'A vegetarian one')
  await card.getByRole('button', { name: 'Next' }).click()
  await card.locator('.question-text', { hasText: 'Who travels with you?' }).waitFor()
  await sendAnswers.click()
  // The answers are a message from the owner: the card and the mark go, and the bot goes on with them.
  await card.waitFor({ state: 'detached' })
  const answers = 'Which flight should I book?\n→ Iberia, 11:15\n\nWhich extras do you want with it?\n→ Checked bag\n→ Meal\n→ A vegetarian one\n\nWho travels with you?\n→ (no answer)'
  await win.locator('.msg.assistant', { hasText: 'Echo: Which flight should I book?' }).waitFor({ timeout: 30_000 })
  assert.equal(await win.locator('.msg.user').last().innerText(), answers)
  await row('Asker').locator('.pill').waitFor({ state: 'detached', timeout: 10_000 })
  await shot('questions-answered')
  // One question alone is sent from where it stands, and cleared like the line was.
  await send(`!tool ask_user ${JSON.stringify({ questions: [{ question: 'Book it now?', options: ['Yes, book it', 'Not yet'] }] })}`)
  await card.locator('.question-text', { hasText: 'Book it now?' }).waitFor({ timeout: 30_000 })
  const sendAnswer = card.getByRole('button', { name: 'Send answer', exact: true })
  assert.equal(await sendAnswer.isDisabled(), true, 'nothing to send until something is answered')
  await shot('questions-one')
  await card.getByRole('button', { name: 'Clear this without answering' }).click()
  await card.waitFor({ state: 'detached' })
  await row('Asker').locator('.pill').waitFor({ state: 'detached' })
  await send(`!tool ask_user ${JSON.stringify({ questions: [{ question: 'Book it now?', options: ['Yes, book it', 'Not yet'] }] })}`)
  await card.locator('.question-text', { hasText: 'Book it now?' }).waitFor({ timeout: 30_000 })
  await card.getByRole('radio', { name: 'Yes, book it' }).click()
  await sendAnswer.click()
  await win.locator('.msg.assistant', { hasText: 'Echo: Book it now?' }).waitFor({ timeout: 30_000 })
  assert.equal(await win.locator('.msg.user').last().innerText(), 'Book it now?\n→ Yes, book it')
  await until(async () => { const t = (await local('GET', '/api/state')).threads.find((t) => t.botId === asker.id); return t.status === 'idle' && t.readTo === t.told }, 10_000)

  // Opening the last of them leaves nothing on the icon.
  await row('Quiet').click()
  await row('Quiet').locator('.dot.new').waitFor({ state: 'detached', timeout: 10_000 })
  if (hidden) await until(async () => (await outside()).count === counted, 10_000)

  // Notifications are switched off in the settings, for this device: the icon still counts.
  await win.evaluate(() => (location.hash = '/settings/general'))
  await win.locator('#notifications .switch').click()
  const before = hidden ? (await shown()).length : 0
  await local('POST', `/api/bots/${planner.id}/messages`, { text: '!tool notify_user {"kind":"read","reason":"Rain at five"}' })
  await until(async () => (await local('GET', '/api/state')).threads.find((t) => t.botId === planner.id).flag?.reason === 'Rain at five', 30_000)
  if (hidden) {
    await until(async () => (await outside()).count === counted + 1, 10_000)
    assert.equal((await shown()).length, before, 'nothing more was shown')
  }
  await win.locator('#notifications .switch').click()

  // On a Mac the app stays in the Dock when its window is closed, with the bots at work: the window is only put
  // away, so the icon goes on counting and what cannot wait is still notified. It closes when the app quits.
  if (hidden && process.platform === 'darwin') {
    const windows = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await local('POST', `/api/bots/${asker.id}/messages`, { text: '!tool notify_user {"kind":"answer","reason":"Still there?"}' })
    await until(async () => (await shown()).includes('Asker needs you | Still there?'), 30_000)
    assert.equal(await windows(), 1)
    assert.equal((await outside()).count, counted + 2)
  }

  for (const made of [quiet, asker, planner]) await local('DELETE', `/api/bots/${made.id}`)
  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('automations: made on their page, run, and each run opened from beneath its automation', async () => {
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Kumi')
  win.on('dialog', (dialog) => dialog.accept())
  const helper = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Helper', provider: 'mock' })
  const here = () => win.evaluate(() => location.hash)
  const shot = (name) => process.env.OPENKUMI_TEST_SHOTS && win.screenshot({ path: path.join(process.env.OPENKUMI_TEST_SHOTS, `${name}.png`) })

  // They have a place of their own in the sidebar, which says who may do what.
  await win.locator('.sidebar .automations-link').click()
  await win.locator('.heading', { hasText: 'Automations' }).waitFor()
  assert.match(await win.locator('.set-intro').first().innerText(), /🤖 Kumi, your first bot, is the main assistant/)
  await win.locator('.set-row', { hasText: 'No automations yet' }).waitFor()

  // A new one: a bot, a prompt, and a time on chosen days.
  await win.getByRole('button', { name: 'New automation' }).click()
  await win.getByLabel('Bot', { exact: true }).selectOption(helper.id)
  await win.getByLabel('Name', { exact: true }).fill('Morning brief')
  await win.getByLabel('Prompt', { exact: true }).fill('Say good morning')
  await win.getByLabel('Time', { exact: true }).fill('07:30')
  for (const day of ['Monday', 'Wednesday', 'Friday']) await win.getByRole('button', { name: day, exact: true }).click()
  await shot('automation-new')
  await win.getByRole('button', { name: 'Create automation' }).click()
  const card = win.locator('.automation-card', { hasText: 'Morning brief' })
  await card.waitFor()
  assert.match(await card.locator('.automation-head').innerText(), /Mon, Wed, Fri at 07:30 · Helper · made by you\s+Next /)
  const [automation] = await ask(LOCAL_PORT, 'local-home', 'GET', '/api/automations')
  assert.deepEqual([automation.botId, automation.createdBy, automation.trigger], [helper.id, 'user', { kind: 'time', schedule: { type: 'daily', time: '07:30', days: [1, 3, 5] } }])

  // Run now: the run is listed beneath its automation, and opens as a thread that leads back to it.
  await card.getByRole('button', { name: 'Run Morning brief now' }).click()
  const run = card.locator('.automation-run').first()
  await until(async () => /Done/.test(await run.innerText().catch(() => '')), 20_000)
  await shot('automation-list')
  await run.click()
  await win.locator('.msg.task', { hasText: 'Say good morning' }).waitFor()
  await win.locator('.msg.assistant', { hasText: 'Echo: Say good morning' }).waitFor()
  assert.match(await win.locator('.heading').innerText(), /^Morning brief\nRun of an automation · .+ · Helper$/)
  // Its bot shows it too, as it does a subagent.
  await win.locator('.sidebar .row.sub', { hasText: 'Morning brief' }).waitFor()
  await shot('automation-run')
  await win.getByRole('button', { name: 'Back to the automation' }).click()
  await until(async () => (await here()) === `#/automations/${automation.id}`, 10_000)
  await win.locator('.set-section', { hasText: 'Runs' }).locator('.automation-run', { hasText: 'Done' }).waitFor()
  await shot('automation-page')

  // What came of it reached Helper's conversation, where it opens the run.
  await win.locator('.sidebar .row.bot', { hasText: 'Helper' }).click()
  const report = win.locator('.msg.report', { hasText: '“Morning brief” ran' })
  await report.waitFor({ timeout: 20_000 })
  await shot('automation-report')
  await report.getByRole('button', { name: 'Open' }).click()
  await win.locator('.msg.task', { hasText: 'Say good morning' }).waitFor()

  // Renaming it keeps its next run; switching it off from the list pauses it.
  await win.evaluate((id) => (location.hash = `/automations/${id}`), automation.id)
  await win.getByLabel('Name', { exact: true }).fill('Morning hello')
  await win.getByRole('button', { name: 'Save', exact: true }).click()
  await win.getByRole('button', { name: 'Saved', exact: true }).waitFor()
  const [renamed] = await ask(LOCAL_PORT, 'local-home', 'GET', '/api/automations')
  assert.deepEqual([renamed.title, renamed.nextRunAt], ['Morning hello', automation.nextRunAt])

  // It runs on what its bot runs on until it is given a model of its own, which its place in the list then names.
  assert.equal(renamed.runsOn, null)
  const model = win.getByRole('button', { name: 'Model', exact: true })
  assert.equal(await model.innerText(), 'Same as Helper')
  // It is chosen with the picker the conversation has, whose first choice here is the bot's own model.
  await model.click()
  const pop = win.getByRole('dialog', { name: 'Choose a model' })
  assert.equal(await pop.getByRole('option', { name: /^Same as Helper/ }).getAttribute('aria-selected'), 'true')
  await shot('automation-model-same')
  await pop.getByRole('option', { name: /^Mock 1/ }).click()
  await pop.getByRole('radio', { name: 'Low' }).click()
  await shot('automation-model')
  await win.keyboard.press('Escape')
  assert.match(await model.innerText(), /^Mock 1\s*Low$/)
  await win.getByRole('button', { name: 'Save', exact: true }).click()
  await win.getByRole('button', { name: 'Saved', exact: true }).waitFor()
  assert.deepEqual((await ask(LOCAL_PORT, 'local-home', 'GET', '/api/automations'))[0].runsOn, { provider: 'mock', model: '', effort: 'low' })
  assert.equal((await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).bots.find((b) => b.id === helper.id).effort, '', 'nothing about the bot changed')
  await win.getByRole('button', { name: 'All automations' }).click()
  assert.match(await win.locator('.automation-card', { hasText: 'Morning hello' }).locator('.automation-head').innerText(), /Mon, Wed, Fri at 07:30 · Helper on Mock 1 · Low · made by you/)
  // A bot that named its provider's first model keeps it by its id: the picker shows that one as picked, with its reasoning.
  await ask(LOCAL_PORT, 'local-home', 'PATCH', `/api/automations/${automation.id}`, { runsOn: { provider: 'mock', model: 'mock-1', effort: '' } })
  await win.locator('.automation-head', { hasText: 'Helper on Mock 1 · made by you' }).waitFor()
  // Back to its bot's.
  await win.locator('.automation-open', { hasText: 'Morning hello' }).click()
  await win.getByRole('button', { name: 'Model', exact: true }).click()
  assert.equal(await win.getByRole('option', { name: /^Mock 1/ }).getAttribute('aria-selected'), 'true')
  await win.getByRole('radiogroup', { name: 'Reasoning' }).waitFor()
  await win.getByRole('option', { name: /^Same as Helper/ }).click()
  await win.keyboard.press('Escape')
  await win.getByRole('button', { name: 'Save', exact: true }).click()
  await win.getByRole('button', { name: 'Saved', exact: true }).waitFor()
  assert.equal((await ask(LOCAL_PORT, 'local-home', 'GET', '/api/automations'))[0].runsOn, null)
  await win.getByRole('button', { name: 'All automations' }).click()
  await win.getByRole('switch', { name: 'Morning hello is on' }).click()
  await win.locator('.automation-card', { hasText: 'Paused' }).waitFor()

  // Deleting it leaves its runs where they are.
  await win.locator('.automation-open', { hasText: 'Morning hello' }).click()
  await win.getByRole('button', { name: 'Delete', exact: true }).click()
  await win.locator('.set-row', { hasText: 'No automations yet' }).waitFor()
  assert.equal((await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).threads.filter((t) => t.automationId === automation.id).length, 1)

  // One that watches an app, as a bot sets it up: it says what it watches, and "Look now" runs it when that changed.
  const shelf = `${tmp}/shelf.json`
  const put = (items) => fs.writeFileSync(shelf, JSON.stringify({ items }))
  put([{ id: 1, title: 'Bread' }])
  fs.mkdirSync(`${tmp}/superpowers/shelf`)
  fs.writeFileSync(`${tmp}/superpowers/shelf/superpower.json`, JSON.stringify({ name: 'Shelf', categories: ['Tests'], tagline: 'For tests.', summary: 'Shelf for tests.', can: [], mcp: { command: process.execPath, args: [path.resolve(import.meta.dirname, '../../server/test/fixtures/mcp-watch.mjs'), shelf] } }))
  await ask(LOCAL_PORT, 'local-home', 'PUT', `/api/bots/${helper.id}/superpowers/shelf`, { on: true })
  const watch = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/automations', { botId: helper.id, title: 'New on the shelf', prompt: 'Say what is new', trigger: { kind: 'watch', watch: { on: 'tool', tool: 'mcp__shelf__list_items', arguments: { shelf: 'top' }, track: ['id'], every: 30 } } })
  const watching = win.locator('.automation-card', { hasText: 'New on the shelf' })
  assert.match(await watching.locator('.automation-head').innerText(), /When Shelf changes · Helper · made by you\s+Looks /)
  await watching.locator('.automation-open').click()
  await win.locator('.set-row', { hasText: 'Last look' }).locator('p', { hasText: /^First look, .*1 item now/ }).waitFor()
  assert.match(await win.locator('.set-row', { hasText: 'Watches' }).innerText(), /Shelf: list items, with \{"shelf":"top"\}\. OpenKumi makes this call itself/)
  assert.equal(await win.getByLabel('Starts', { exact: true }).inputValue(), 'app')
  assert.equal(await win.getByLabel('Tracked fields', { exact: true }).inputValue(), 'id')
  await shot('automation-watch')
  await win.getByRole('button', { name: 'Look now' }).click()
  await win.locator('.set-row', { hasText: 'Last look' }).locator('p', { hasText: /^No change, / }).waitFor()
  put([{ id: 1, title: 'Bread' }, { id: 2, title: 'Milk' }])
  await win.getByRole('button', { name: 'Look now' }).click()
  await win.locator('.set-row', { hasText: 'Last look' }).locator('p', { hasText: /^Changed, .*New: Milk \(2\)/ }).waitFor()
  await win.locator('.set-section', { hasText: 'Runs' }).locator('.automation-run', { hasText: 'Done' }).click()
  // The run shows the prompt, and apart from it what OpenKumi told it had changed.
  assert.match(await win.locator('.msg.task .watch-change').innerText(), /What changed\s+This run was started because what this automation watches changed: Shelf \(mcp__shelf__list_items\)\.\s+What changed since the last look:\s+New: Milk \(2\)/i)
  await shot('automation-watch-run')
  // Looking every 20 minutes instead keeps what it watches, and what it last saw.
  await win.getByRole('button', { name: 'Back to the automation' }).click()
  await win.getByLabel('Looks every', { exact: true }).fill('20')
  await win.getByRole('button', { name: 'Save', exact: true }).click()
  await win.getByRole('button', { name: 'Saved', exact: true }).waitFor()
  const changed = (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/automations')).find((a) => a.id === watch.id)
  assert.deepEqual([changed.trigger, changed.lastCheck.outcome], [{ kind: 'watch', watch: { every: 20, track: ['id'], on: 'tool', tool: 'mcp__shelf__list_items', arguments: { shelf: 'top' }, app: 'Shelf' } }, 'changed'])
  await ask(LOCAL_PORT, 'local-home', 'DELETE', `/api/automations/${watch.id}`)


  // The main assistant is marked among the bots.
  await win.evaluate(() => (location.hash = '/settings/bots'))
  await win.locator('.set-link', { hasText: 'Kumi' }).locator('.pill', { hasText: 'Main assistant' }).waitFor()

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('a webhook is set up on its app’s page, and an automation chosen in the form starts on its call', async () => {
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  // An app that calls: its superpower says how its calls are signed and what they are about.
  fs.mkdirSync(`${tmp}/superpowers/desk`, { recursive: true })
  fs.writeFileSync(
    `${tmp}/superpowers/desk/superpower.json`,
    JSON.stringify({
      name: 'Desk', categories: ['Tests'], tagline: 'For tests.', summary: 'Desk for tests.', can: [],
      mcp: { command: process.execPath, args: [path.resolve(import.meta.dirname, '../../server/test/fixtures/mcp-stdio.mjs')] },
      hooks: {
        setup: ['In Desk, add a webhook with this address: {address}', 'Copy its secret and give it below.'],
        signature: { header: 'X-Desk-Signature' },
        events: [{ id: 'ticket.opened', name: 'A ticket is opened', when: { type: 'Ticket', action: 'create' } }, { id: 'ticket.closed', name: 'A ticket is closed', when: { type: 'Ticket', action: 'close' } }],
        pass: ['data.id', 'data.title'],
      },
    }),
  )
  const win = await launch()
  await showsBot(win, 'Kumi')
  win.on('dialog', (dialog) => dialog.accept())
  const shot = (name) => process.env.OPENKUMI_TEST_SHOTS && win.screenshot({ path: path.join(process.env.OPENKUMI_TEST_SHOTS, `${name}.png`), fullPage: true })
  const helper = (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).bots.find((b) => b.name === 'Helper') ?? (await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Helper', provider: 'mock' }))
  await ask(LOCAL_PORT, 'local-home', 'PUT', `/api/bots/${helper.id}/superpowers/desk`, { on: true })

  // On the app's page, for this bot: the address the internet reaches webhooks by, then the webhook itself.
  await win.evaluate((id) => (location.hash = `/settings/bots/${id}/superpowers/desk`), helper.id)
  const section = win.locator('.set-section', { hasText: 'Webhook' })
  await section.locator('.set-row', { hasText: 'No webhook.' }).waitFor()
  assert.match(await section.locator('#hook-address').innerText(), new RegExp(`Where the internet reaches port ${LOCAL_PORT + 1} of the computer running OpenKumi\\.`))
  await win.getByLabel('Public address for webhooks').fill('http://mac.example.ts.net')
  await win.getByLabel('Public address for webhooks').press('Enter')
  await section.locator('small.err', { hasText: 'An https address' }).waitFor()
  await win.getByLabel('Public address for webhooks').fill('https://mac.example.ts.net/')
  await win.getByLabel('Public address for webhooks').press('Enter')
  await until(async () => (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).settings.hookAddress === 'https://mac.example.ts.net', 10_000)
  await win.getByRole('button', { name: 'Set up webhook: Desk for Helper' }).click()
  // The steps are the app's own, with the address to enter there.
  const address = await win.locator('.hook-address').innerText()
  assert.match(address, /^https:\/\/mac\.example\.ts\.net\/hooks\/hook_[\w-]{24}$/)
  assert.match(await section.locator('.hook-steps').innerText(), /In Desk, add a webhook with this address: https:\/\/mac\.example\.ts\.net\/hooks\/hook_\S+\s+Copy address\s+Copy its secret and give it below\./)
  await section.locator('.set-row', { hasText: 'Waiting for the secret Desk signs its calls with' }).waitFor()
  await shot('webhook-steps')
  await win.getByLabel('Signing secret: Desk for Helper').fill('desk-signing-secret')
  await win.getByRole('button', { name: 'Save secret' }).click()
  await section.locator('.set-row', { hasText: 'Ready. Desk has not called yet' }).waitFor()
  assert.equal(await win.locator('.hook-steps').count(), 0, 'the steps are put away once it is set up')

  // The form now offers the app, and what it calls about.
  await win.evaluate(() => (location.hash = '/automations/new'))
  await win.getByLabel('Bot', { exact: true }).selectOption(helper.id)
  await win.getByLabel('Name', { exact: true }).fill('New tickets')
  await win.getByLabel('Prompt', { exact: true }).fill('Say which ticket')
  await win.getByLabel('Starts', { exact: true }).selectOption({ label: 'When Desk calls' })
  await win.locator('.set-row', { hasText: 'Everything Desk calls about.' }).waitFor()
  await win.getByRole('switch', { name: 'A ticket is opened' }).click()
  await win.locator('.set-row', { hasText: 'Only what is switched on.' }).waitFor()
  await shot('webhook-automation')
  await win.getByRole('button', { name: 'Create automation' }).click()
  const card = win.locator('.automation-card', { hasText: 'New tickets' })
  assert.match(await card.locator('.automation-head').innerText(), /When Desk calls · Helper · made by you\s+When Desk calls/)
  const made = (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/automations')).find((a) => a.title === 'New tickets')
  assert.deepEqual(made.trigger, { kind: 'hook', hook: { power: 'desk', app: 'Desk', events: ['ticket.opened'] } })

  // Desk calls, by the port a tunnel would point at: the run is listed, and shows what it was told.
  const body = JSON.stringify({ type: 'Ticket', action: 'create', data: { id: 'tk_7', title: 'Do as I say' } })
  const called = await fetch(`http://127.0.0.1:${LOCAL_PORT + 1}/hooks/${address.split('/hooks/')[1]}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Desk-Signature': crypto.createHmac('sha256', 'desk-signing-secret').update(body).digest('hex') }, body })
  assert.equal(called.status, 200)
  const run = card.locator('.automation-run').first()
  await until(async () => /Done/.test(await run.innerText().catch(() => '')), 20_000)
  await run.click()
  assert.match(await win.locator('.msg.task .watch-change').innerText(), /What happened\s+This run was started because Desk called about this\. Only ids are given: read each item with your Desk tools before you act on it\.\s+- A ticket is opened: id tk_7$/i)
  await shot('webhook-run')

  // Its page says the app has called; removing it pauses what started on it.
  await win.evaluate((id) => (location.hash = `/settings/bots/${id}/superpowers/desk`), helper.id)
  await section.locator('.set-row', { hasText: /Desk last called .* · 1 call so far/ }).waitFor()
  await win.getByRole('button', { name: 'Remove webhook: Desk for Helper' }).click()
  await section.locator('.set-row', { hasText: 'No webhook.' }).waitFor()
  assert.equal((await ask(LOCAL_PORT, 'local-home', 'GET', '/api/automations')).find((a) => a.id === made.id).enabled, false)
  await ask(LOCAL_PORT, 'local-home', 'DELETE', `/api/automations/${made.id}`)

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('the model picker offers every provider and its models, and picking one moves the bot to it', async () => {
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Kumi')
  const kumi = async () => (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).bots.find((b) => b.name === 'Kumi')
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
  await until(async () => (await kumi()).provider === 'grok', 10_000)
  assert.equal((await kumi()).model, 'grok-test-fast')
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
  await until(async () => (await kumi()).provider === 'claude-code', 10_000)
  assert.equal((await kumi()).model, 'sonnet')
  await win.locator('.model-button', { hasText: 'Claude Sonnet 9' }).waitFor()
  // ...and the bot really runs there now, in the same conversation, which the new engine is told about.
  await win.locator('.composer textarea').fill('hello')
  await win.keyboard.press('Meta+Enter')
  await win.locator('.msg.assistant', { hasText: /Echo \(turn 1\): This conversation was already under way\.[\s\S]*The newest message:\s+hello/ }).waitFor({ timeout: 20_000 })

  // Under the bot's model are the reasoning levels it takes. Picking one is kept, and shown on the button.
  await open()
  assert.deepEqual(await win.locator('.model-row[aria-selected=true] + .model-reasoning [role=radio]').allInnerTexts(), ['Auto', 'Low', 'Medium', 'High', 'Extra High', 'Max'])
  await win.getByRole('radio', { name: 'Extra High' }).click()
  await until(async () => (await kumi()).effort === 'xhigh', 10_000)
  await win.locator('.model-button', { hasText: 'Extra High' }).waitFor()
  // Earlier models are folded away until asked for.
  assert.deepEqual(await rows(), ['Claude Opus 9', 'Claude Sonnet 9', 'Claude Haiku 9'])
  await win.getByRole('button', { name: 'Show more' }).click()
  assert.deepEqual(await rows(), ['Claude Opus 9', 'Claude Sonnet 9', 'Claude Haiku 9', 'Claude Sonnet 8'])
  // A model that does not take the level the bot has is given the choice back.
  await win.locator('.model-row', { hasText: 'Claude Sonnet 8' }).click()
  await until(async () => (await kumi()).model === 'claude-sonnet-8', 10_000)
  assert.equal((await kumi()).effort, '')
  await win.keyboard.press('Escape')
  // Command with a number takes the model in that place: the first is the provider's default.
  await open()
  await win.keyboard.press('Meta+1')
  await until(async () => (await kumi()).model === '', 10_000)
  await win.locator('.model-button', { hasText: 'Claude Opus 9' }).waitFor()

  // A new bot runs as Kumi, the main assistant, does, until Settings names an engine for new bots.
  await ask(LOCAL_PORT, 'local-home', 'PATCH', `/api/bots/${(await kumi()).id}`, { effort: 'high' })
  await win.evaluate(() => (location.hash = '/settings/general'))
  const runsOn = win.getByLabel('New bots run on')
  await runsOn.waitFor()
  assert.equal(await runsOn.locator('option:checked').innerText(), 'Same as Kumi')
  assert.match(await win.locator('#default-provider').innerText(), /Same as Kumi gives it Kumi’s model and reasoning effort too\./)
  if (process.env.OPENKUMI_TEST_SHOTS) await win.locator('#default-provider').screenshot({ path: path.join(process.env.OPENKUMI_TEST_SHOTS, 'new-bots-run-on.png') })
  await win.evaluate(() => (location.hash = '/kumi'))
  await win.getByRole('button', { name: 'New bot' }).click()
  await win.getByPlaceholder('Name').fill('Like Kumi')
  await win.getByRole('button', { name: 'Create', exact: true }).click()
  const made = async () => (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).bots.find((b) => b.name === 'Like Kumi')
  await until(made, 10_000)
  const like = await made()
  assert.deepEqual([like.provider, like.model, like.effort], ['claude-code', '', 'high'])
  await ask(LOCAL_PORT, 'local-home', 'DELETE', `/api/bots/${like.id}`)
  await ask(LOCAL_PORT, 'local-home', 'PATCH', `/api/bots/${(await kumi()).id}`, { effort: '' })
  await win.evaluate(() => (location.hash = '/kumi'))
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
  assert.deepEqual((await win.locator('.prov-bots a').allInnerTexts()).map((text) => text.split('\n').pop()), ['Kumi'])
  assert.match(await win.locator('.prov-detail .set-row').innerText(), /Program path[\s\S]*Using .*fake-claude\.mjs/)
  // The switch in the list takes a provider away from the bots altogether.
  await win.getByRole('switch', { name: 'Use Grok for bots' }).click()
  await until(async () => (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).settings.disabledProviders.includes('grok'), 10_000)
  await win.locator('#provider-grok .prov-standing', { hasText: 'Switched off' }).waitFor()

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('the order of the bots: as they were made, the one last talked with first, or the owner’s own, dragged or moved from the keyboard', async () => {
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Kumi')
  const shot = (name) => process.env.OPENKUMI_TEST_SHOTS && win.screenshot({ path: path.join(process.env.OPENKUMI_TEST_SHOTS, `${name}.png`) })
  const settings = async () => (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).settings
  const alder = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Alder', provider: 'mock', look: { creature: 'cat' } })
  const birch = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Birch', provider: 'mock', look: { creature: 'bear' } })
  await showsBot(win, 'Birch')
  /** The bots as the sidebar lists them. */
  const listed = () => win.locator('.sidebar .row.bot .name').allInnerTexts()
  const row = (name) => win.locator('.sidebar .row.bot', { hasText: name })
  const order = async (name) => {
    await win.getByRole('button', { name: 'Order of the bots' }).click()
    await win.getByRole('menuitemradio', { name }).click()
  }

  // As they were made: the newest last. Nothing is dragged in this order.
  assert.deepEqual((await listed()).slice(-2), ['Alder', 'Birch'])
  assert.equal((await listed())[0], 'Kumi')
  assert.equal(await row('Alder').locator('xpath=..').getAttribute('draggable'), 'false')

  // The one last talked with first; a bot nothing was said to yet goes by when it was made.
  await order('Last message')
  await until(async () => (await listed()).slice(0, 2).join() === 'Birch,Alder', 10_000)
  await row('Alder').click()
  await win.locator('.empty h1', { hasText: 'Alder' }).waitFor()
  await win.locator('.composer textarea').fill('Which tree are you?')
  await win.keyboard.press('Meta+Enter')
  await win.locator('.msg.assistant', { hasText: 'Echo: Which tree are you?' }).waitFor({ timeout: 20_000 })
  await until(async () => (await listed()).slice(0, 2).join() === 'Alder,Birch', 10_000)
  await win.getByRole('button', { name: 'Order of the bots' }).click()
  assert.equal(await win.getByRole('menuitemradio', { name: 'Last message' }).getAttribute('aria-checked'), 'true')
  await shot('bot-order-menu')
  await win.keyboard.press('Escape')

  // Their own order starts as what is showing, and is kept on the server, for the phone to list them the same.
  const before = await listed()
  await order('My own order')
  await until(async () => (await settings()).botSort === 'manual', 10_000)
  assert.deepEqual(await listed(), before)
  assert.deepEqual((await settings()).botOrder.slice(0, 2), [alder.id, birch.id])

  // A bot is dragged to its place: onto the upper half of another puts it before that one.
  await row('Birch').dragTo(row('Alder'), { targetPosition: { x: 40, y: 4 } })
  await until(async () => (await listed()).slice(0, 2).join() === 'Birch,Alder', 10_000)
  await until(async () => (await settings()).botOrder.slice(0, 2).join() === `${birch.id},${alder.id}`, 10_000)
  // And below the last one, to the end.
  const last = (await listed()).at(-1)
  await row('Birch').dragTo(row(last), { targetPosition: { x: 40, y: 28 } })
  await until(async () => (await listed()).at(-1) === 'Birch', 10_000)
  await shot('bot-order-own')

  // From the keyboard, a place at a time, the row keeping the keyboard.
  await row('Birch').focus()
  await win.keyboard.press('Alt+ArrowUp')
  await until(async () => (await listed()).at(-2) === 'Birch', 10_000)
  await until(() => win.evaluate(() => document.activeElement?.textContent?.includes('Birch')), 10_000)
  // Moves made one right after another each start from the one before: down to the end, then up two places.
  await win.keyboard.press('Alt+ArrowDown')
  await win.keyboard.press('Alt+ArrowUp')
  await win.keyboard.press('Alt+ArrowUp')
  await until(async () => (await listed()).at(-3) === 'Birch' && (await settings()).botOrder.at(-3) === birch.id, 10_000)

  // The settings have the choice too, found by searching, and put it back.
  await win.evaluate(() => (location.hash = '/settings/general'))
  await win.getByLabel('Search settings').fill('order of the bots')
  await win.locator('.set-results button', { hasText: 'Order of the bots' }).click()
  const choice = win.getByRole('combobox', { name: 'Order of the bots' })
  assert.equal(await choice.inputValue(), 'manual')
  await choice.selectOption('recent')
  await until(async () => (await settings()).botSort === 'recent', 10_000)
  // The page's "Restore defaults" puts the order back with the rest, and keeps the owner's own for another time.
  await win.getByRole('button', { name: 'Restore defaults' }).click()
  await until(async () => (await settings()).botSort === 'created', 10_000)
  assert.ok((await settings()).botOrder.includes(birch.id))
  await win.keyboard.press('Escape')
  await win.keyboard.press('Escape')
  await showsBot(win, 'Kumi')
  assert.deepEqual((await listed()).slice(-2), ['Alder', 'Birch'])
  // The owner's order is kept for when it is chosen again, without the bots that are gone.
  await ask(LOCAL_PORT, 'local-home', 'DELETE', `/api/bots/${alder.id}`)
  await ask(LOCAL_PORT, 'local-home', 'DELETE', `/api/bots/${birch.id}`)
  const kept = (await settings()).botOrder
  assert.ok(kept.length && !kept.includes(alder.id) && !kept.includes(birch.id))
  await ask(LOCAL_PORT, 'local-home', 'PATCH', '/api/settings', { botOrder: [] })

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('master prompt: each bot’s line set from one page, and all a bot is told read there, with nothing to change it', async () => {
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Kumi')
  const shot = (name) => process.env.OPENKUMI_TEST_SHOTS && win.screenshot({ path: path.join(process.env.OPENKUMI_TEST_SHOTS, `${name}.png`) })
  const state = () => ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')

  // Found from the search; the master prompt itself is only there to read.
  await win.evaluate(() => (location.hash = '/settings/general'))
  await win.getByLabel('Search settings').fill('master prompt')
  await win.locator('.set-results button', { hasText: 'What a bot is told' }).click()
  await win.getByRole('button', { name: 'Show', exact: true }).waitFor()
  assert.equal(await win.locator('.set-body textarea').count(), 0, 'there is no box to write the master prompt in')
  await shot('master-prompt')

  // What each bot is for, which the others are told.
  const line = win.getByLabel('What Kumi is for')
  assert.match(await line.inputValue(), /^Everyday questions and tasks/)
  await line.fill('Runs the household.')
  await line.blur()
  await until(async () => (await state()).bots[0].description === 'Runs the household.', 10_000)

  // Everything a bot is told, to read.
  await win.getByRole('button', { name: 'Show', exact: true }).click()
  const told = win.locator('.prompt-text')
  await told.waitFor()
  assert.match(await told.innerText(), /^You are Kumi,[\s\S]*# Principles[\s\S]*\*\*Work as a team\.\*\*[\s\S]*# Working in OpenKumi/)
  await shot('master-prompt-told')
  await win.keyboard.press('Escape')

  // A bot's own page has its line too.
  await win.evaluate(() => (location.hash = '/settings/bots/kumi'))
  assert.equal(await win.getByLabel('What it is for', { exact: true }).inputValue(), 'Runs the household.')

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('usage: what the bots’ models used by provider, model and bot, what it would cost as API calls, and how much of each plan is used', async (t) => {
  // The list of prices is a stand-in: nothing is fetched from outside.
  const list = http.createServer((_, res) => res.end(JSON.stringify({ 'fake-model': { input_cost_per_token: 0.000001, cache_read_input_token_cost: 0.0000001, output_cost_per_token: 0.00001, mode: 'chat' } })))
  await new Promise((resolve) => list.listen(0, '127.0.0.1', resolve))
  env.OPENKUMI_PRICES_URL = `http://127.0.0.1:${list.address().port}/prices.json`
  t.after(() => (list.close(), delete env.OPENKUMI_PRICES_URL))
  fs.mkdirSync(`${tmp}/app`, { recursive: true })
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Kumi')
  const shot = (name) => process.env.OPENKUMI_TEST_SHOTS && win.screenshot({ path: path.join(process.env.OPENKUMI_TEST_SHOTS, `${name}.png`), fullPage: true })
  const api = (method, url, body) => ask(LOCAL_PORT, 'local-home', method, url, body)

  // A bot on each engine, each asked one thing. The stand-in engines say what a turn used: Claude Code
  // 100 tokens sent and 10 written, for a quarter of a dollar; Codex 200 and 20, with no price of its own.
  for (const [name, provider] of [['Counter Claude', 'claude-code'], ['Counter Codex', 'codex']]) {
    const bot = await api('POST', '/api/bots', { name, provider, look: { creature: 'cat', color: 'sky', hat: 'none', extra: 'none', clothes: 'navy' } })
    const thread = await api('POST', `/api/bots/${bot.id}/messages`, { text: 'count this' })
    await until(async () => (await api('GET', `/api/threads/${thread.id}`)).thread.status === 'idle')
  }

  await win.locator('.sidebar a', { hasText: 'Usage' }).click()
  const row = (name) => win.locator('.usage-list-row', { hasText: name })
  await row('Counter Codex').waitFor()
  assert.equal(await win.locator('.sidebar a[aria-current="page"]').innerText(), 'Usage')
  // By bot: its tokens, and what they would cost. Claude Code's cost is its own; Codex's is from the list of prices.
  assert.match(await row('Counter Claude').innerText(), /100 sent, 60% from cache · 10 written[\s\S]*110[\s\S]*\$0\.25/)
  assert.match(await row('Counter Codex').innerText(), /200 sent, 25% from cache · 20 written[\s\S]*220[\s\S]*<\$0\.01/)
  // By model, under the name its maker gives it, and by provider.
  assert.match(await row('claude-test-1').innerText(), /Claude Code/)
  assert.match(await row('fake-model').innerText(), /Codex/)
  assert.ok((await win.locator('.usage-tile-value').first().innerText()).length > 0)

  // How much of each plan is used, as the engines' own programs say.
  const plan = (name) => win.locator('.usage-limit', { hasText: name })
  await plan('Claude Code').locator('.usage-meter').first().waitFor({ timeout: 30_000 })
  assert.match(await plan('Claude Code').innerText(), /Pro plan[\s\S]*Week\s+25% used[\s\S]*Starts over[\s\S]*Week, Opus only\s+81% used[\s\S]*Nearly used up/)
  assert.match(await plan('Codex').innerText(), /Plus plan[\s\S]*Week\s+3% used/)
  assert.equal(await plan('Claude Code').locator('.usage-meter.high').count(), 1)

  // The chart: pointing at today's column says what is in it, and the same numbers are there as a table.
  await win.locator('.usage-legend', { hasText: 'Claude Code' }).waitFor()
  const plot = await win.locator('.usage-plot').boundingBox()
  await win.mouse.move(plot.x + plot.width - 3, plot.y + plot.height / 2)
  assert.match(await win.locator('.usage-tip').innerText(), /Codex[\s\S]*Claude Code[\s\S]*Total/)
  await shot('usage')
  // With the pointer still resting on that column, a shorter time is picked from the keyboard: the
  // column pointed at is not in the chart that arrives, which is drawn without it.
  await win.getByRole('button', { name: '7 days' }).focus()
  await win.keyboard.press('Enter')
  await until(async () => (await win.locator('.usage-column').count()) === 7, 10_000)
  assert.equal(await win.locator('.usage-tip').count(), 0)
  await win.getByRole('button', { name: '30 days' }).focus()
  await win.keyboard.press('Enter')
  await until(async () => (await win.locator('.usage-column').count()) === 30, 10_000)
  await win.mouse.move(5, 5)
  await win.getByRole('button', { name: 'Show as a table' }).click()
  assert.match(await win.locator('.usage-table').innerText(), /Day[\s\S]*Codex[\s\S]*Claude Code[\s\S]*Total/)
  assert.ok((await win.locator('.usage-table tbody tr').count()) >= 1)
  // By cost, and by the hour for the last day.
  await win.getByRole('button', { name: 'Cost', exact: true }).click()
  assert.match(await win.locator('.usage-table tbody tr').first().innerText(), /\$0\.\d\d/)
  await win.getByRole('button', { name: '24 hours' }).click()
  await win.locator('.usage h2', { hasText: 'By the hour' }).waitFor()
  await win.locator('.usage-table th', { hasText: 'Hour' }).waitFor()
  await shot('usage-table')

  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('dictation: what is said goes into the message where the cursor was, and only the words are sent', async (t) => {
  // It is written down on the Mac itself, so it needs macOS 26 and the program built beside the app.
  const program = path.resolve(import.meta.dirname, '../dist/dictation')
  const check = process.platform === 'darwin' && fs.existsSync(program) ? await new Promise((resolve) => spawn(program, ['--check']).stdout.on('data', (d) => resolve(String(d)))) : ''
  if (!check.includes('"available":true')) return t.skip('dictation needs a Mac with macOS 26 or later')
  // A Mac that is only rented for the checks has the system but not its speech models, nor anyone to allow listening.
  if (process.env.OPENKUMI_TEST_NO_DICTATION) return t.skip('this Mac cannot take dictation')
  // A recording stands in for the microphone, heard all at once and then nothing until it is stopped.
  const recording = `${tmp}/said.aiff`
  await new Promise((resolve, reject) => spawn('say', ['-o', recording, 'Could you check my calendar for tomorrow?']).on('exit', (code) => (code ? reject(new Error('say failed')) : resolve())))
  env.OPENKUMI_DICTATION_RECORDING = recording
  t.after(() => delete env.OPENKUMI_DICTATION_RECORDING)

  const win = await launch()
  await showsBot(win, 'Kumi')
  const bot = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Listener', provider: 'mock' })
  await win.evaluate((id) => (location.hash = `/${id}`), bot.id)
  const message = win.locator('.composer textarea')
  await message.waitFor()

  // Spoken after what was typed, and between it and what follows the cursor.
  await message.fill('Hi. Thanks!')
  await message.evaluate((el) => el.setSelectionRange(3, 3))
  await win.getByRole('button', { name: 'Dictate' }).click()
  await win.locator('.listening .rec.on').waitFor()
  await until(async () => (await message.inputValue()).includes('tomorrow'), 20_000)
  // While it listens the words are the microphone's: typing does not mix with them.
  assert.equal(await message.getAttribute('readonly'), '')
  await win.getByRole('button', { name: 'Finish dictation' }).click()
  await win.locator('.listening').waitFor({ state: 'detached' })
  assert.equal(await message.inputValue(), 'Hi. Could you check my calendar for tomorrow? Thanks!')
  // The cursor is left after the words that were spoken in.
  assert.deepEqual(await message.evaluate((el) => [el.selectionStart, document.activeElement === el]), ['Hi. Could you check my calendar for tomorrow?'.length, true])

  // Escape gives up, and the message is as it was.
  await win.getByRole('button', { name: 'Dictate' }).click()
  await until(async () => (await message.inputValue()).split('tomorrow').length > 2, 20_000)
  await message.press('Escape')
  await win.locator('.listening').waitFor({ state: 'detached' })
  assert.equal(await message.inputValue(), 'Hi. Could you check my calendar for tomorrow? Thanks!')

  // Sending while it listens puts the last words in first; the bot gets the text, as if it were typed.
  await message.fill('')
  await win.getByRole('button', { name: 'Dictate' }).click()
  await until(async () => (await message.inputValue()).includes('calendar'), 20_000)
  await message.press('Enter')
  await win.locator('.msg.assistant', { hasText: 'Echo: Could you check my calendar for tomorrow?' }).waitFor()
  assert.equal(await message.inputValue(), '')
  const { threads } = await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')
  const { items } = await ask(LOCAL_PORT, 'local-home', 'GET', `/api/threads/${threads.find((th) => th.botId === bot.id).id}`)
  assert.deepEqual(items.filter((i) => i.data.role === 'user').map((i) => i.data), [{ type: 'message', role: 'user', source: 'user', text: 'Could you check my calendar for tomorrow?' }])

  await ask(LOCAL_PORT, 'local-home', 'DELETE', `/api/bots/${bot.id}`)
  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('calls: a bot is called from its conversation, what is said shows as it is said, and the call is kept in the conversation', async (t) => {
  // Chromium's made-up microphone stands in for a real one, which the system is then not asked about,
  // and the stand-in for Codex plays the voice: small talk it answers itself, then something it hands to the bot.
  switches = ['--use-fake-device-for-media-stream']
  env.OPENKUMI_FAKE_CALL = 'chat:Hello there|says:!say Tomorrow is free.'
  t.after(() => {
    switches = []
    delete env.OPENKUMI_FAKE_CALL
  })
  const state = () => ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')

  const win = await launch()
  await showsBot(win, 'Kumi')
  const bot = await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Caller', provider: 'mock' })
  await win.evaluate((id) => (location.hash = `/${id}`), bot.id)
  // Calls need Codex, signed in with ChatGPT: the server has found it by now, or is about to, and the window hears of it.
  await until(async () => (await state()).calls.available)
  await win.locator('header button[aria-label="Call Caller"][title="Call Caller"]').waitFor()

  await win.getByRole('button', { name: 'Call Caller' }).click()
  const panel = win.locator('.call-panel')
  await panel.locator('.call-time').waitFor()
  assert.equal(await win.locator('header button.calling').count(), 1, 'the button in the conversation shows the call is on')
  // What is said shows in the panel as it is said.
  await panel.locator('.call-words p.user', { hasText: 'Hello there' }).waitFor()
  await panel.locator('.call-words p', { hasText: 'You said: Hello there' }).waitFor()
  // What the voice handed over is in the conversation, as said on a call, and the bot answered it there; the voice said the answer.
  await win.locator('.said', { hasText: 'On a call' }).locator('.msg.user', { hasText: '!say Tomorrow is free.' }).waitFor()
  await win.locator('.msg.assistant', { hasText: 'Tomorrow is free.' }).waitFor()
  await panel.locator('.call-words p', { hasText: 'Spoken: What came back for “!say Tomorrow is free.”' }).waitFor()

  // Muted, the bot does not hear; the call goes on, and stays in view whatever the window shows.
  await panel.getByRole('button', { name: 'Mute', exact: true }).click()
  await panel.locator('.call-status', { hasText: 'Muted' }).waitFor()
  await panel.getByRole('button', { name: 'Unmute' }).click()
  await panel.locator('.call-status', { hasText: 'On a call' }).waitFor()
  await win.evaluate(() => (location.hash = '/settings/general'))
  await win.locator('.set-view').waitFor()
  // Not behind the settings: it can be hung up from there.
  await panel.getByRole('button', { name: 'Hang up' }).click({ trial: true })
  await win.evaluate((id) => (location.hash = `/${id}`), bot.id)

  // Hanging up leaves a record of the call in the conversation, with what was said to unfold.
  await panel.getByRole('button', { name: 'Hang up' }).click()
  await panel.waitFor({ state: 'detached' })
  const record = win.locator('.call-record')
  await record.locator('summary', { hasText: /Talked with Caller for \d+ s/ }).click()
  assert.deepEqual(await record.locator('.call-lines p').allInnerTexts().then((lines) => lines.slice(0, 2).map((line) => line.replace(/\s+/g, ' '))), ['YOU Hello there', 'CALLER You said: Hello there'])
  assert.equal((await state()).call, null)
  assert.equal(await win.locator('header button.calling').count(), 0)

  // The bot's voice is chosen on a page of its own, from the ones Codex offers, sorted female and
  // male, each with what it is like. The settings show the one it has.
  await win.evaluate((id) => (location.hash = `/settings/bots/${id}`), bot.id)
  const voiceButton = win.locator('a.voice-button')
  await until(async () => (await voiceButton.locator('.voice-button-text').innerText()).replace(/\s+/g, ' ').trim() === 'Cove Male · Composed and direct')
  await voiceButton.click()
  const voices = win.getByRole('listbox', { name: 'Voices' })
  await until(async () => (await voices.locator('[role=group] h2').allTextContents()).join() === 'Female 2,Male 1')
  assert.deepEqual(await voices.locator('.voice-name').allTextContents(), ['Juniper', 'Maple', 'Cove'])
  assert.equal(await win.locator('.crumbs [aria-current=page]').textContent(), 'Voice')
  // It opens on the bot's own voice, the usual one.
  await win.locator('.voice-stage h2', { hasText: 'Cove' }).waitFor()
  await win.getByRole('button', { name: 'Caller’s voice' }).waitFor()
  // A click brings a voice into view, and a button makes it the bot's.
  await voices.getByRole('option', { name: /Maple/ }).click()
  await win.locator('.voice-stage h2', { hasText: 'Maple' }).waitFor()
  await win.getByRole('button', { name: 'Use Maple' }).click()
  await until(async () => (await state()).bots.find((b) => b.id === bot.id).voice === 'maple')
  await win.getByRole('button', { name: 'Caller’s voice' }).waitFor()
  // The arrow keys go through the voices as soon as the page opens, and Enter takes the one in view.
  await win.evaluate((id) => (location.hash = `/settings/bots/${id}`), bot.id)
  await voiceButton.click()
  await win.locator('.voice-stage h2', { hasText: 'Maple' }).waitFor()
  await win.keyboard.press('ArrowUp')
  await win.locator('.voice-stage h2', { hasText: 'Juniper' }).waitFor()
  await win.keyboard.press('Enter')
  await until(async () => (await state()).bots.find((b) => b.id === bot.id).voice === 'juniper')

  // Where bots cannot be called, the button says what is missing, in the conversation.
  const { settings } = await state()
  await ask(LOCAL_PORT, 'local-home', 'PATCH', '/api/settings', { disabledProviders: [...settings.disabledProviders, 'codex'] })
  await win.evaluate((id) => (location.hash = `/${id}`), bot.id)
  await until(async () => !(await state()).calls.available)
  // (Once the window has heard of it too: pointing at the button then says why.)
  await win.locator('header button[aria-label="Call Caller"][title^="Calls use your ChatGPT plan through Codex, which is switched off"]').waitFor()
  await win.getByRole('button', { name: 'Call Caller' }).click()
  await win.locator('.notice.error', { hasText: 'Calls use your ChatGPT plan through Codex, which is switched off in Settings' }).waitFor()
  assert.equal(await panel.count(), 0)
  await ask(LOCAL_PORT, 'local-home', 'PATCH', '/api/settings', { disabledProviders: settings.disabledProviders })

  await ask(LOCAL_PORT, 'local-home', 'DELETE', `/api/bots/${bot.id}`)
  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)
})

test('updates: the app finds a newer version of itself, and an environment this app cannot work with says which of the two to update', async () => {
  const configure = (config) => (fs.mkdirSync(`${tmp}/app`, { recursive: true }), fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify(config)))
  const { PROTOCOL } = await import('../../../packages/shared/src/protocol.ts')

  // ---- the app itself
  // Run from the repository it does not update itself, and says so where its version is.
  configure({ local: { enabled: true }, environments: [], current: 'local' })
  let win = await launch()
  await showsBot(win, 'Kumi')
  await win.evaluate(() => (location.hash = '/settings/about'))
  if (packaged) {
    // An installed app can, and offers to look. (OPENKUMI_DESKTOP_APP tests that one instead of the source.)
    await win.locator('#app-update button', { hasText: /Check for updates|Restart to update/ }).waitFor()
  } else {
    await win.locator('#app-update', { hasText: 'does not update itself' }).waitFor()
    assert.equal(await win.locator('#app-update button').count(), 0)
  }
  // The server this app runs is part of it, so it has no line of its own.
  assert.equal(await win.locator('#server-update').count(), 0)
  await app.close()
  await until(async () => !(await up(LOCAL_PORT)), 15_000)

  // Told where versions are published, it looks there: a stand-in for the project's releases, with a newer one.
  const installer = crypto.randomBytes(2048)
  const file = process.platform === 'darwin' ? 'OpenKumi-mac-arm64.zip' : process.platform === 'win32' ? 'OpenKumi-win-x64.exe' : 'OpenKumi-linux-x64.AppImage'
  const sha512 = crypto.createHash('sha512').update(installer).digest('base64')
  const asked = []
  const releases = http.createServer((req, res) => {
    asked.push(req.url)
    if (/^\/latest[\w-]*\.yml/.test(req.url)) return res.end(`version: 9.9.9\nfiles:\n  - url: ${file}\n    sha512: ${sha512}\n    size: ${installer.length}\npath: ${file}\nsha512: ${sha512}\nreleaseDate: '2026-11-15T00:00:00.000Z'\n`)
    if (req.url.startsWith(`/${file}`)) return res.end(installer)
    res.writeHead(404).end()
  })
  await new Promise((resolve) => releases.listen(REMOTE_PORT + 2, '127.0.0.1', resolve))
  env.OPENKUMI_DESKTOP_UPDATES_URL = `http://127.0.0.1:${REMOTE_PORT + 2}`
  try {
    win = await launch()
    await showsBot(win, 'Kumi')
    await win.evaluate(() => {
      window.updates = []
      window.openkumiDesktop.onState((state) => window.updates.push(state.update))
      location.hash = '/settings/about'
    })
    await win.locator('#app-update button', { hasText: 'Check for updates' }).click()
    // It finds the version and starts fetching it by itself. (Putting it in place is the system's
    // part, which it only does for an installed, signed app: not for this one.)
    await until(() => win.evaluate(() => window.updates.some((update) => update.version === '9.9.9')))
    assert.ok(asked.some((url) => /^\/latest[\w-]*\.yml/.test(url)))
    assert.equal(await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap((item) => item.submenu?.items ?? []).some((item) => /Check for Updates…|Restart to Update…/.test(item.label))), true)
    await app.close()
    await until(async () => !(await up(LOCAL_PORT)), 15_000)
  } finally {
    delete env.OPENKUMI_DESKTOP_UPDATES_URL
    releases.close()
    releases.closeAllConnections()
  }

  // ---- another computer, in a version this app cannot work with
  // It shows it is the computer this one was paired with, so it can be asked, with the key, to update itself.
  const key = 'the-key-this-computer-was-given'
  const hash = crypto.createHash('sha256').update(key).digest('hex')
  const tag = crypto.createHash('sha256').update(`device:${hash}`).digest('hex')
  let protocol = PROTOCOL - 1
  const heard = []
  const far = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    heard.push(`${req.method} ${url.pathname} ${req.headers.authorization ?? ''}`)
    res.setHeader('Content-Type', 'application/json')
    // The window asks too, and it is a page: it only reads an answer that says it may.
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (url.pathname === '/api/hello') {
      const known = url.searchParams.get('device') === tag
      const proof = crypto.createHmac('sha256', hash).update(`server:s_far:${url.searchParams.get('challenge')}`).digest('hex')
      return res.end(JSON.stringify({ app: 'openkumi', version: '0.0.9', protocol, id: 's_far', device: known ? { known, proof } : { known } }))
    }
    if (req.method === 'POST' && url.pathname === '/api/update' && req.headers.authorization === `Bearer ${key}`) return res.end(JSON.stringify({ how: 'installed', latest: '9.9.9', state: 'ready', error: '', checkedAt: Date.now(), working: 0 }))
    res.writeHead(404).end('{}')
  })
  await new Promise((resolve) => far.listen(REMOTE_PORT, '127.0.0.1', resolve))
  try {
    configure({ local: { enabled: false }, environments: [{ id: 'remote-far', name: 'Far Mac', addresses: [{ url: `http://127.0.0.1:${REMOTE_PORT}` }], token: key, enabled: true, serverId: 's_far' }], current: 'remote-far' })
    win = await launch()
    await win.locator('.gate-head p', { hasText: 'Far Mac runs an older OpenKumi than this app can work with.' }).waitFor({ timeout: 20_000 })
    const row = win.locator('.gate .set-row', { hasText: 'Far Mac' })
    await row.locator('p', { hasText: 'Runs an older OpenKumi, which has to be updated first (0.0.9)' }).waitFor()
    // Until now it was only asked who it is: nothing was sent the key.
    assert.ok(!heard.some((line) => line.includes(key)))
    await row.getByRole('button', { name: 'Update it' }).click()
    await win.locator('.notice', { hasText: 'Far Mac is starting OpenKumi 9.9.9. It connects by itself in a moment.' }).waitFor()
    assert.ok(heard.includes(`POST /api/update Bearer ${key}`))

    // One that is ahead of this app cannot be helped from here: it is the app that has to be updated.
    protocol = PROTOCOL + 1
    await win.locator('.gate-head p', { hasText: 'Far Mac runs a newer OpenKumi than this app can work with. Update this app' }).waitFor({ timeout: 20_000 })
    await app.close()
  } finally {
    far.close()
    far.closeAllConnections()
  }
})

test('updates from another computer: the server inside the app on that computer is asked to update, and has its app look for the new version', async () => {
  const configure = (config) => (fs.mkdirSync(`${tmp}/app`, { recursive: true }), fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify(config)))
  // A stand-in for the project's releases, offering at first only the version the app already is.
  const own = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')).version
  let offered = own
  const installer = crypto.randomBytes(2048)
  const file = process.platform === 'darwin' ? 'OpenKumi-mac-arm64.zip' : process.platform === 'win32' ? 'OpenKumi-win-x64.exe' : 'OpenKumi-linux-x64.AppImage'
  const sha512 = crypto.createHash('sha512').update(installer).digest('base64')
  const asked = []
  const releases = http.createServer((req, res) => {
    asked.push(req.url)
    if (/^\/latest[\w-]*\.yml/.test(req.url)) return res.end(`version: ${offered}\nfiles:\n  - url: ${file}\n    sha512: ${sha512}\n    size: ${installer.length}\npath: ${file}\nsha512: ${sha512}\nreleaseDate: '2026-11-25T00:00:00.000Z'\n`)
    if (req.url.startsWith(`/${file}`)) return res.end(installer)
    res.writeHead(404).end()
  })
  await new Promise((resolve) => releases.listen(REMOTE_PORT + 3, '127.0.0.1', resolve))

  // The other computer: the desktop app, running the bots there, with nobody at it. It updates itself from those releases.
  fs.mkdirSync(`${tmp}/mini-app`, { recursive: true })
  fs.writeFileSync(`${tmp}/mini-app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const mini = await _electron.launch({
    executablePath: electron,
    args: packaged ? [] : ['.'],
    env: { ...env, OPENKUMI_DESKTOP_DATA: `${tmp}/mini-app`, OPENKUMI_HOME: `${tmp}/mini-home`, OPENKUMI_PORT: String(REMOTE_PORT), OPENKUMI_DESKTOP_UPDATES_URL: `http://127.0.0.1:${REMOTE_PORT + 3}` },
  })
  try {
    await until(() => up(REMOTE_PORT), 60_000)
    // The server there is part of that app, which updates itself: so it can be asked to.
    await until(async () => (await ask(REMOTE_PORT, 'mini-home', 'GET', '/api/update').catch(() => ({}))).updatable === true)
    const before = await ask(REMOTE_PORT, 'mini-home', 'GET', '/api/update')
    assert.equal(before.how, 'app')
    assert.equal(before.state === 'idle' || before.state === 'checking', true)

    // This computer was paired with it, and shows its bots.
    const given = await pairWith(REMOTE_PORT, 'mini-home')
    configure({ local: { enabled: false }, environments: [{ id: 'remote-mini', name: 'Mini', addresses: [{ url: `http://127.0.0.1:${REMOTE_PORT}` }], token: given.key, enabled: true }], current: 'remote-mini' })
    const win = await launch()
    await showsBot(win, 'Kumi')
    await win.evaluate(() => (location.hash = '/settings/about'))
    const row = win.locator('#server-update', { hasText: 'Mini' })
    await row.locator('p', { hasText: 'It is part of the desktop app on that computer. Updating it has that app restart into the new version once no bot there is working.' }).waitFor()

    // A new version comes out. Asked from here, the app there looks for it, and its server reports what it finds as its own.
    // (Run from the repository, the app goes no further than finding it: it has no installer of its own to download for.)
    offered = '9.9.9'
    const looked = asked.length
    await row.getByRole('button', { name: /^(Check for updates|Update)$/ }).click()
    await until(() => asked.slice(looked).some((url) => /^\/latest[\w-]*\.yml/.test(url)))
    await until(async () => (await ask(REMOTE_PORT, 'mini-home', 'GET', '/api/update')).latest === '9.9.9')
    // This window hears it too: the version is out there. (Putting it in place is the system's part,
    // which it only does for an installed, signed app: so this one stops short of restarting.)
    await row.getByRole('button', { name: /^(Update|Start it now)$/ }).waitFor({ timeout: 120_000 })
    await app.close()
  } finally {
    await mini.close().catch(() => {})
    releases.close()
    releases.closeAllConnections()
    await until(async () => !(await up(REMOTE_PORT)), 15_000)
  }
})

test('telemetry: the server’s question is put once with its box ticked, nothing is sent before the answer, and the Privacy page shows what went and switches it off', async () => {
  // A stand-in for PostHog, which keeps what it is sent.
  const received = []
  const posthog = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      if (req.url === '/batch/') received.push(...JSON.parse(body).batch)
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"status":1}')
    })
  })
  await new Promise((resolve) => posthog.listen(0, '127.0.0.1', resolve))
  const before = { ...env }
  delete env.OPENKUMI_TELEMETRY
  const state = () => ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')
  try {
    fs.mkdirSync(`${tmp}/app`, { recursive: true })
    fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
    let win
    if (!packaged) {
      // The app as someone working on OpenKumi starts it, from the repository: its server sends nothing, and there is no question.
      win = await launch()
      await showsBot(win, 'Kumi')
      const { telemetry } = (await state()).about
      assert.equal(telemetry.can, false)
      assert.match(telemetry.why, /from its source/)
      await new Promise((r) => setTimeout(r, 500))
      assert.equal(await win.getByRole('dialog', { name: 'Help make OpenKumi better' }).count(), 0)
      await app.close()
      await until(async () => !(await up(LOCAL_PORT)), 15_000)
    }
    // From here on the server is told where to send, and it is the stand-in.
    env.OPENKUMI_TELEMETRY_URL = `http://127.0.0.1:${posthog.address().port}`
    env.OPENKUMI_TELEMETRY_KEY = 'phc_test'
    win = await launch()
    const shot = (name) => process.env.OPENKUMI_TEST_SHOTS && win.screenshot({ path: path.join(process.env.OPENKUMI_TEST_SHOTS, `${name}.png`) })
    await showsBot(win, 'Kumi')

    // Asked as soon as the environment shows, with the box ticked. Until it is answered nothing has gone.
    let question = win.getByRole('dialog', { name: 'Help make OpenKumi better' })
    await question.waitFor()
    const box = question.getByLabel('Send how OpenKumi is used and what goes wrong')
    assert.equal(await box.isChecked(), true)
    assert.deepEqual(await question.locator('.telemetry-lists h3').allInnerTexts(), ['Sent', 'Never sent'])
    await shot('telemetry-question')
    assert.equal((await state()).settings.telemetry, null)
    assert.deepEqual(received, [])

    // Closed without an answer, it is no answer: it is put again the next time the app is opened.
    await win.keyboard.press('Escape')
    await question.waitFor({ state: 'detached' })
    assert.equal((await state()).settings.telemetry, null)
    await app.close()
    await until(async () => !(await up(LOCAL_PORT)), 15_000)
    assert.deepEqual(received, [])
    // This time the app starts at its welcome, as it does when it is new: what it records there
    // waits in the app until there is a server to hand it to.
    fs.rmSync(`${tmp}/app/desktop.json`)
    win = await launch()
    await win.locator('.welcome-start', { hasText: 'Run them on this computer' }).click()
    await showsBot(win, 'Kumi')
    question = win.getByRole('dialog', { name: 'Help make OpenKumi better' })
    await question.getByRole('button', { name: 'Continue' }).click()
    await question.waitFor({ state: 'detached' })
    await until(() => received.length > 0, 10_000)
    assert.equal((await state()).settings.telemetry, true)
    // The server says how it runs, and which app is connected to it; that is all it knows of the app.
    const connected = received.find((e) => e.event === 'app connected')?.properties
    assert.deepEqual([connected?.app, connected?.local, connected?.how], ['desktop', true, 'app'])
    assert.match(connected.app_version, /^\d+\.\d+\.\d+/)
    // What the app records about itself goes the same way: handed to the server, which sends it.
    const fromApp = (event) => received.filter((e) => e.event === event && e.properties.app === 'desktop').map((e) => e.properties)
    await until(() => fromApp('screen opened').some((p) => p.screen === 'chat'), 10_000)
    assert.deepEqual(fromApp('screen opened').map((p) => p.screen), ['welcome', 'chat'])
    assert.deepEqual(fromApp('welcome answered').map((p) => p.choice), ['local'])
    // The app was opened before, when the question was closed without an answer.
    assert.deepEqual(fromApp('app opened').map((p) => p.first), [false])

    // The Privacy page: found from the search, shows the id and each thing that went.
    await win.evaluate(() => (location.hash = '/settings/general'))
    await win.getByLabel('Search settings').fill('telemetry')
    await win.locator('.set-results button', { hasText: 'Send how OpenKumi is used' }).click()
    const toggle = win.locator('#telemetry .switch')
    await toggle.waitFor()
    assert.equal(await toggle.isChecked(), true)
    const id = received[0].distinct_id
    await win.locator('#telemetry-id code', { hasText: id }).waitFor()
    const first = win.locator('.telemetry-sent details', { hasText: 'server started' }).first()
    await first.locator('summary').click()
    assert.match(await first.locator('dl').innerText(), /how\s*app/)
    await shot('telemetry-privacy')
    // Which pages of the settings were opened, by name.
    await until(() => fromApp('screen opened').some((p) => p.screen === 'settings/privacy'), 10_000)
    assert.deepEqual(fromApp('screen opened').map((p) => p.screen), ['welcome', 'chat', 'settings/general', 'settings/privacy'])

    // A new id, then off: the id is thrown away and what was sent is no longer listed.
    await win.getByRole('button', { name: 'New id' }).click()
    await until(async () => (await win.locator('#telemetry-id code').innerText()) !== id, 10_000)
    await toggle.click()
    await until(async () => (await state()).settings.telemetry === false, 10_000)
    await win.locator('#telemetry-id').waitFor({ state: 'detached' })
    assert.equal(JSON.parse(fs.readFileSync(`${dataOf('local-home')}/telemetry.json`, 'utf8')).id, undefined)
    await shot('telemetry-off')

    // Answered, the question is not put again.
    await app.close()
    await until(async () => !(await up(LOCAL_PORT)), 15_000)
    win = await launch()
    await showsBot(win, 'Kumi')
    await new Promise((r) => setTimeout(r, 500))
    assert.equal(await win.getByRole('dialog', { name: 'Help make OpenKumi better' }).count(), 0)
    await app.close()
    await until(async () => !(await up(LOCAL_PORT)), 15_000)
  } finally {
    for (const key of Object.keys(env)) delete env[key]
    Object.assign(env, before)
    posthog.close()
    posthog.closeAllConnections()
  }
})
