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

const LOCAL_PORT = 4950 + Math.floor(Math.random() * 20)
const REMOTE_PORT = LOCAL_PORT + 25
const SERVER = path.resolve(import.meta.dirname, '../../server/src/index.ts')
const packaged = process.env.OPENBOT_DESKTOP_APP
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'openbot-desktop-'))
// OPENBOT_DESKTOP_YES answers the app's own confirmation dialogs, which a test cannot click.
const env = {
  ...process.env,
  OPENBOT_DESKTOP_DATA: `${tmp}/app`,
  OPENBOT_DESKTOP_YES: '1',
  OPENBOT_DESKTOP_HIDDEN: process.env.OPENBOT_TEST_SHOW ? '' : '1',
  OPENBOT_HOME: `${tmp}/local-home`,
  OPENBOT_PORT: String(LOCAL_PORT),
  OPENBOT_MOCK: '1',
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
  // Once it is finished it is drawn as one, exactly as it will be the next time the chat is opened.
  await win.waitForFunction(() => document.querySelectorAll('.msg.assistant h2').length === 24 && !document.querySelector('.md-piece'), null, { timeout: 30_000 })
  assert.match(await win.locator('.msg.assistant').last().innerText(), /^Echo:[\s\S]*until part 24 is done\.$/)

  // The bot's browser: its pictures go from the server to the worker and onto the canvas.
  await win.getByRole('button', { name: 'Toggle browser' }).click()
  await win.waitForFunction(() => getComputedStyle(document.querySelector('.view canvas')).visibility === 'visible', null, { timeout: 60_000 })
  // A page that is one big red link.
  const page = `data:text/html,<body style="margin:0"><a href="about:blank" style="display:block;height:100vh;background:rgb(210,40,60)"></a>`
  await win.locator('.address').fill(page)
  await win.keyboard.press('Enter')
  const middle = () =>
    win.evaluate(async () => {
      const bitmap = await createImageBitmap(document.querySelector('.view canvas'))
      const copy = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')
      copy.drawImage(bitmap, 0, 0)
      return [...copy.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data.slice(0, 3)]
    })
  const near = ([r, g, b]) => Math.abs(r - 210) < 12 && Math.abs(g - 40) < 12 && Math.abs(b - 60) < 12
  await until(async () => near(await middle()), 20_000)

  // And what is done to the canvas reaches the page.
  await win.locator('.view canvas').click()
  await until(async () => (await state()).browsers[bot.id]?.tabs.every((t) => t.url === 'about:blank'), 15_000)

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

test('plugins: browse them, open one, and install it for one bot', async () => {
  fs.writeFileSync(`${tmp}/app/desktop.json`, JSON.stringify({ local: { enabled: true }, environments: [], current: 'local' }))
  const win = await launch()
  await showsBot(win, 'Assistant')
  win.on('dialog', (dialog) => dialog.accept())
  await ask(LOCAL_PORT, 'local-home', 'POST', '/api/bots', { name: 'Second bot', provider: 'mock' })

  // The list: every plugin with what it is for.
  await win.evaluate(() => (location.hash = '/settings/plugins'))
  await win.locator('.plugin-card').first().waitFor()
  assert.deepEqual(await win.locator('.plugin-card h3').allInnerTexts(), ['Gmail', 'Google Calendar', 'Google Drive', 'Linear', 'Notion'])

  // A plugin's own page says what it does, what a bot can do with it and what installing adds.
  await win.locator('.plugin-card', { hasText: 'Gmail' }).click()
  await win.locator('.plugin-head h1', { hasText: 'Gmail' }).waitFor()
  assert.match(await win.locator('.plugin-about').innerText(), /Gives a bot your inbox[\s\S]*Two ways it can work/)
  assert.deepEqual(await win.locator('.set-section h2').allInnerTexts(), ['What a bot can do with it', 'What installing adds to the bot', 'Direct connection'])

  // Install asks which bot it is for, and only that bot gets it.
  await win.getByRole('button', { name: 'Install' }).click()
  await win.locator('.choose-bot button', { hasText: 'Second bot' }).click()
  const row = win.locator('.set-section', { hasText: 'Installed for' }).locator('.set-row')
  await row.waitFor()
  assert.match(await row.innerText(), /Second bot\s*Works through the bot’s browser/)
  const bots = (await ask(LOCAL_PORT, 'local-home', 'GET', '/api/state')).bots
  assert.deepEqual(bots.map((b) => [b.name, b.plugins, b.skills.includes('gmail')]), [['Assistant', [], false], ['Second bot', ['gmail'], true]])
  // It cannot be installed twice for the same bot.
  await win.getByRole('button', { name: 'Install' }).click()
  assert.equal(await win.locator('.choose-bot button', { hasText: 'Second bot' }).isDisabled(), true)
  await win.keyboard.press('Escape')

  // The list shows where it is installed, and removing it takes it away again.
  await win.locator('.crumbs a', { hasText: 'Plugins' }).click()
  await win.locator('.plugin-card', { hasText: 'Installed for 1 bot' }).click()
  await win.locator('.set-row', { hasText: 'Second bot' }).getByRole('button', { name: 'Remove' }).click()
  await win.locator('.set-section', { hasText: 'Installed for' }).waitFor({ state: 'detached' })

  await app.close()
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
  await win.locator('.model-pop').waitFor({ state: 'detached' })
  await until(async () => (await assistant()).provider === 'grok', 10_000)
  assert.equal((await assistant()).model, 'grok-test-fast')
  await win.locator('.model-button', { hasText: 'grok-test-fast' }).waitFor()

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

  // Beside the models are the reasoning levels the bot's model takes. Picking one is kept, and shown on the button.
  await open()
  assert.deepEqual(await win.locator('.model-effort [role=radio]').allInnerTexts(), ['Auto', 'Low', 'Medium', 'High', 'Extra High', 'Max'])
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
