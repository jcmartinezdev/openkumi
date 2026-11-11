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
  fs.rmSync(tmp, { recursive: true, force: true })
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
