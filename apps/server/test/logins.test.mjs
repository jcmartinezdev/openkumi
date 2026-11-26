// A bot's logins, against a real server process and a real (headless) Chrome: the cookies a site
// signs in with outlive the browser, a login is a user name with a password in the vault, the bot
// signs in with it by name and never has the password, and what its owner types into a sign-in
// form while they drive the browser is offered to them to keep.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'

/** A server keeps its data in the folder of the person it runs for: here the first one, made when it first starts. */
const dataOf = (home) => path.join(home, 'people', JSON.parse(fs.readFileSync(path.join(home, 'people.json'), 'utf8'))[0].name)

// Clear of the other tests' servers (secrets.test.mjs stays under 5890), of the Mac's screen sharing (5900),
// of one run from the repository, and of the ports fetch refuses.
const PORT = 5910 + Math.floor(Math.random() * 80)
const BASE = `http://127.0.0.1:${PORT}`
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-logins-'))
/** Where the vault's key goes in a test, instead of the keychain of whoever runs it. */
const keys = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-keys-'))
let server
let bot
let token
const auth = () => ({ Authorization: `Bearer ${token}` })

async function call(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...auth() }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}
async function api(method, url, body) {
  const { status, json } = await call(method, url, body)
  if (status >= 400) throw new Error(`${method} ${url}: ${json.error}`)
  return json
}
async function settle(threadId, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { thread, items } = await api('GET', `/api/threads/${threadId}`)
    if (thread.status !== 'running') return items.map((i) => i.data)
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('Thread did not settle in time')
}
async function until(check, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = await check()
    if (found) return found
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('It did not happen in time')
}
async function say(threadId, text, timeoutMs = 30_000) {
  await api('POST', `/api/threads/${threadId}/messages`, { text })
  return settle(threadId, timeoutMs)
}
const fresh = async (botId = bot.id) => (await api('POST', `/api/bots/${botId}/fresh`)).id
const lastText = (items) => items.findLast((d) => d.type === 'message' && d.role === 'assistant')?.text
const lastOutput = (items) => items.findLast((d) => d.type === 'function_call_output').output
/** Calls one tool through the scripted model and returns what the tool gave back. */
const toolIn = async (threadId, name, args, timeoutMs = 60_000) => lastOutput(await say(threadId, `!tool ${name} ${JSON.stringify(args)}`, timeoutMs))

/** Whether some text is written anywhere in the data folder: in a file, or in the database's own files. */
function onDisk(text, dir = home) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const at = path.join(dir, entry.name)
    // A browser's profile is large and is not where OpenKumi writes.
    if (entry.isDirectory()) {
      const found = entry.name === 'browser-profile' ? null : onDisk(text, at)
      if (found) return found
    } else if (entry.isFile() && fs.readFileSync(at).includes(text)) return at
  }
  return null
}
/** Whether it is anywhere in what is kept of the conversations. */
function inConversations(text) {
  const db = new DatabaseSync(path.join(dataOf(home), 'openkumi.db'), { readOnly: true })
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM items WHERE instr(data, ?) > 0').get(text).n
  } finally {
    db.close()
  }
}

const USER = 'ana@example.com'
const PASSWORD = 'correct-horse-battery-staple-42'
/** What the site gives whoever signs in: a cookie with no end date, which is what Chrome forgets when it closes. */
const SESSION = 'sess_7f3a9c1e5b2d4f60'
const html = (res, title, body, headers = {}) => res.writeHead(200, { 'Content-Type': 'text/html', ...headers }).end(`<!doctype html><title>${title}</title>${body}`)
const signInForm = (note = '') =>
  `${note}<form method="post" action="/session"><input name="q" type="search" placeholder="Search"><input name="email" type="email" placeholder="Email" autofocus><input name="password" type="password" placeholder="Password">` +
  `<label><input type="checkbox" name="remember"> Remember me</label><button>Sign in</button></form><a href="/forgot">Forgot password?</a>`

/** A site with accounts. It notes every form it is sent, for the test to read. */
const seen = []
const site_ = http.createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const url = new URL(req.url, 'http://site')
  const signedIn = (req.headers.cookie ?? '').includes(`session=${SESSION}`)
  const form = new URLSearchParams(body)
  const json = !!req.headers['content-type']?.includes('json')
  if (req.method === 'POST') seen.push({ path: url.pathname, form: json ? JSON.parse(body) : Object.fromEntries(form) })
  if (url.pathname === '/home') return signedIn ? html(res, 'Home', `<p>Signed in as ${USER}</p><a href="/logout">Sign out</a>`) : res.writeHead(302, { Location: '/login' }).end()
  if (url.pathname === '/logout') return res.writeHead(302, { Location: '/login', 'Set-Cookie': 'session=; Path=/; Max-Age=0' }).end()
  if (url.pathname === '/login') return html(res, 'Sign in', signInForm())
  // A form that takes its time to answer.
  if (url.searchParams.has('slow')) await new Promise((r) => setTimeout(r, 2500))
  if (url.pathname === '/session') {
    const right = form.get('email') === USER && form.get('password') === PASSWORD
    // JSON for the page that signs in with a script, a page for the forms.
    if (json) {
      const sent = JSON.parse(body)
      const ok = sent.email === USER && sent.password === PASSWORD
      return res.writeHead(ok ? 200 : 401, ok ? { 'Set-Cookie': `session=${SESSION}; Path=/; HttpOnly` } : {}).end('{}')
    }
    return right ? res.writeHead(302, { Location: '/home', 'Set-Cookie': `session=${SESSION}; Path=/; HttpOnly` }).end() : html(res, 'Sign in', signInForm('<p role="alert">Wrong e-mail or password.</p>'))
  }
  // A form that asks for the user name alone, and for the password on its next page.
  if (url.pathname === '/first') return html(res, 'Sign in', '<form method="post" action="/second"><input name="identifier" autocomplete="username" placeholder="Email or phone"><button>Next</button></form><form action="/news"><input type="email" name="newsletter" placeholder="Your e-mail for our newsletter"></form>')
  if (url.pathname === '/second') {
    return html(res, 'Enter your password', `<p>${form.get('identifier')}</p><form method="post" action="/session"><input type="hidden" name="email" value="${form.get('identifier')}"><input name="password" type="password" placeholder="Password"><button>Sign in</button></form>`)
  }
  // A form that is not written as one: Enter does nothing, and the button signs in with a script.
  if (url.pathname === '/scripted') {
    return html(
      res,
      'Sign in',
      `<input id="user" placeholder="Username"><input id="pass" type="password" placeholder="Password"><div role="button" onclick="alert('no')">Sign in with Google</div>` +
        `<div role="button" id="go" tabindex="0">Log in</div><script>document.getElementById('go').onclick = async () => { const r = await fetch('/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.value, password: pass.value }) }); if (r.ok) location = '/home'; else document.title = 'Refused' }</script>`,
    )
  }
  // A form written as one, sent by a script that waits for its answer.
  if (url.pathname === '/slow') {
    return html(
      res,
      'Sign in',
      `<form id="f"><input name="email" type="email" placeholder="Email"><input name="password" type="password" placeholder="Password"><button>Sign in</button></form>` +
        `<script>f.onsubmit = async (e) => { e.preventDefault(); const r = await fetch('/session?slow', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.email.value, password: f.password.value }) }); if (r.ok) location = '/home' }</script>`,
    )
  }
  // A form on the site that sends what is typed into it to another one.
  if (url.pathname === '/sends-away') return html(res, 'Sign in', `<form method="post" action="http://${elsewhere}/session"><input name="email" type="email" placeholder="Email"><input name="password" type="password" placeholder="Password"><button>Sign in</button></form>`)
  if (url.pathname === '/sends-away-by-button') return html(res, 'Sign in', `<form id="f" method="post" action="/session"><input name="email" type="email" placeholder="Email"><input name="password" type="password" placeholder="Password"></form><button form="f" formaction="http://${elsewhere}/session">Sign in</button>`)
  // A page that knows who is coming back, and asks for the password alone.
  if (url.pathname === '/welcome-back') return html(res, 'Welcome back', `<p>Welcome back, ${USER}</p><form method="post" action="/session"><input type="hidden" name="email" value="${USER}"><input name="password" type="password" placeholder="Password" autofocus><button>Sign in</button></form>`)
  // A site that says back the password it was sent.
  if (url.pathname === '/shows') return html(res, 'Sign in', '<form method="post" action="/shown"><input name="email" type="email" placeholder="Email" autofocus><input name="password" type="password" placeholder="Password"><button>Sign in</button></form>')
  if (url.pathname === '/shown') return html(res, 'Welcome', `<p>Welcome. Your password is ${form.get('password')}</p>`)
  if (url.pathname === '/plain') return html(res, 'Plain', '<p>Nothing to sign in to here.</p><input type="email" placeholder="Your e-mail for our newsletter">')
  html(res, 'Elsewhere', '<p>Another page.</p>')
})
/** The site as a login names it, and the same computer under another name: another site. */
let site
let elsewhere

function start() {
  server = spawn(process.execPath, ['src/index.ts'], {
    env: { ...process.env, OPENKUMI_HOME: home, OPENKUMI_PORT: String(PORT), OPENKUMI_MOCK: '1', OPENKUMI_VAULT_KEYS: keys, OPENKUMI_CLAUDE_BIN: path.resolve('test/fixtures/fake-claude.mjs') },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => String(d).includes('running at') && resolve())
    server.on('exit', (code) => reject(new Error(`server exited with ${code}`)))
  })
}
async function stop() {
  server.removeAllListeners('exit')
  server.kill('SIGTERM')
  await new Promise((r) => server.on('exit', r))
}

/** A connection to the server's event stream, as an app's view has. */
async function openSocket() {
  const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${token}`)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = () => reject(new Error('The event stream failed'))
  })
  return socket
}

before(async () => {
  await new Promise((resolve) => site_.listen(0, '127.0.0.1', resolve))
  site = `127.0.0.1:${site_.address().port}`
  elsewhere = `localhost:${site_.address().port}`
  await start()
  token = JSON.parse(fs.readFileSync(path.join(dataOf(home), 'auth.json'), 'utf8')).accessToken
  bot = await api('POST', '/api/bots', { name: 'Keeper', provider: 'mock' })
})

after(async () => {
  await stop()
  site_.close()
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(keys, { recursive: true, force: true })
})

const logins = async (botId = bot.id) => (await api('GET', `/api/bots/${botId}/secrets`)).secrets.filter((s) => s.user)
const sentTo = (pathname) => seen.filter((s) => s.path === pathname)

test('the owner adds a login: a user name the bot is told, and a password it is not', async () => {
  // A login needs no name of its own: it is called after its site.
  const added = await api('POST', `/api/bots/${bot.id}/secrets`, { sites: site, user: USER, value: PASSWORD })
  const name = site.replace(/[.:]/g, '-')
  assert.deepEqual([added.name, added.user, added.sites, added.what, added.by], [name, USER, [site], `Login for ${site}`, 'owner'])
  assert.ok(!JSON.stringify(await api('GET', `/api/bots/${bot.id}/secrets`)).includes(PASSWORD))
  assert.equal(onDisk(PASSWORD), null, 'the password is kept encrypted')
  const told = lastText(await say(await fresh(), '!system'))
  assert.ok(told.includes(`Your secrets:\n- ${name}: Login for ${site} (a login, user name "${USER}", for ${site})\n`), told)
  assert.match(told, /A secret with a user name is a login: an account on its site\. To sign in with it, open the site's sign-in page and call browser_sign_in\./)
  assert.match(told, /When a site has signed you out and you have a login for it \(see Your secrets\), sign in again yourself with browser_sign_in, without asking\./)
  assert.ok(!told.includes(PASSWORD))
  // In its conversation it can ask for a login; a run of an automation or a subagent signs in with the ones there are.
  assert.match(lastText(await say(await fresh(), '!tools')), /\bbrowser_sign_in\b[\s\S]*\bask_secret ask_login save_secret\b/)
  // The password has no place in what the bot is told.
  assert.match((await call('PUT', `/api/bots/${bot.id}/secrets/${name}`, { user: `me ${PASSWORD}` })).json.error, /The user name is told to the bot: the password has no place in it\./)
  assert.match((await call('POST', `/api/bots/${bot.id}/secrets`, { sites: 'short.example.com', user: 'abc12', value: 'abc12' })).json.error, /The user name is told to the bot/, 'a short one neither')
  // A password too short to be found in what the bot reads is no login's.
  assert.match((await call('POST', `/api/bots/${bot.id}/secrets`, { sites: 'short.example.com', user: 'someone', value: 'abc12' })).json.error, /A login’s password is six characters at least/)
  // A second login for the site gets a name of its own, and a secret without a user name is no login.
  const second = await api('POST', `/api/bots/${bot.id}/secrets`, { sites: site, user: 'other@example.com', value: 'another-password-000' })
  assert.equal(second.name, `${name}-2`)
  await api('DELETE', `/api/bots/${bot.id}/secrets/${second.name}`)
  assert.match((await call('POST', `/api/bots/${bot.id}/secrets`, { sites: site, value: 'no-name-and-no-user' })).json.error, /A secret’s name is/)
})

test('a bot signs in with a login by itself: the form is found, filled in and sent, and the bot never has the password', async () => {
  const name = site.replace(/[.:]/g, '-')
  const id = await fresh()
  // The site sends whoever is not signed in to its sign-in page.
  assert.match(await toolIn(id, 'browser_navigate', { url: `http://${site}/home` }), /Page: Sign in\n/)
  seen.length = 0
  const went = await toolIn(id, 'browser_sign_in', {})
  assert.match(went, new RegExp(`^The sign-in form was sent with the login "${name}" \\(${USER}\\), and the site moved on from it\\. This is the page now\\. If it asks for a code, a CAPTCHA or anything else only the user has, have the user do that step: call browser_ask_user\\.\\n\\nPage: Home\\n`))
  assert.match(went, /Signed in as ana@example\.com/)
  // The user name went into its field and not into the search box before it; the box to stay signed in was ticked.
  assert.deepEqual(sentTo('/session'), [{ path: '/session', form: { q: '', email: USER, password: PASSWORD, remember: 'on' } }])
  assert.equal(inConversations(PASSWORD), 0)
  // A script of the bot's could read the password out of the page, so none runs on that site.
  assert.match(await toolIn(id, 'browser_eval', { expression: 'document.cookie' }), /^Error: One of your secrets is for /)

  // Signed in already, there is no form: the page the login was kept from is not known, and the bot is told what to do.
  assert.match(await toolIn(id, 'browser_sign_in', { login: name }), /^Error: No sign-in form was found on this page \(http:\/\/127\.0\.0\.1:\d+\/home\)\. Open the page of 127\.0\.0\.1:\d+ that asks for the user name and password/)

  // A form that asks for the user name first, and for the password on the page after it. The page's other field for an e-mail address is left alone.
  await toolIn(id, 'browser_navigate', { url: `http://${site}/logout` })
  await toolIn(id, 'browser_navigate', { url: `http://${site}/first` })
  seen.length = 0
  assert.match(await toolIn(id, 'browser_sign_in', { login: name }), /and the site moved on from it\.[\s\S]*Page: Home\n/)
  assert.deepEqual(sentTo('/second'), [{ path: '/second', form: { identifier: USER } }])
  assert.equal(sentTo('/session')[0].form.password, PASSWORD)

  // A form that is not written as one: Enter does nothing there, so the button that says it signs in is clicked, not the one for somebody else's account.
  await toolIn(id, 'browser_navigate', { url: `http://${site}/logout` })
  await toolIn(id, 'browser_navigate', { url: `http://${site}/scripted` })
  seen.length = 0
  assert.match(await toolIn(id, 'browser_sign_in', {}), /and the site moved on from it\.[\s\S]*Page: Home\n/)
  assert.deepEqual(seen, [{ path: '/session', form: { email: USER, password: PASSWORD } }])

  // A form that answers slowly is sent once: Enter sends it, and its button is not pressed after it.
  await toolIn(id, 'browser_navigate', { url: `http://${site}/logout` })
  await toolIn(id, 'browser_navigate', { url: `http://${site}/slow` })
  seen.length = 0
  assert.match(await toolIn(id, 'browser_sign_in', {}), /and the site moved on from it\.[\s\S]*Page: Home\n/)
  assert.equal(sentTo('/session').length, 1)

  // A form on the login's site that sends what is typed into it to another site is not given the password.
  await toolIn(id, 'browser_navigate', { url: `http://${site}/logout` })
  await toolIn(id, 'browser_navigate', { url: `http://${site}/sends-away` })
  seen.length = 0
  assert.match(await toolIn(id, 'browser_sign_in', {}), new RegExp(`^Error: The sign-in form here sends what is typed into it to ${elsewhere}, and the login "${name}" is for ${site.replace(/\./g, '\\.')}, so the password was not entered\\.`))
  assert.deepEqual(seen, [])
  // Nor one whose button, written outside the form, says so.
  await toolIn(id, 'browser_navigate', { url: `http://${site}/sends-away-by-button` })
  assert.match(await toolIn(id, 'browser_sign_in', {}), new RegExp(`^Error: The sign-in form here sends what is typed into it to ${elsewhere},`))
  assert.deepEqual(seen, [])

  // On a page of another site nothing is entered: not when the bot names the login either.
  await toolIn(id, 'browser_navigate', { url: `http://${elsewhere}/login` })
  seen.length = 0
  assert.match(await toolIn(id, 'browser_sign_in', {}), new RegExp(`^Error: You have no login for the site this page is on\\. Your logins: ${name} \\(${USER}, for ${site.replace(/\./g, '\\.')}\\)\\. Name the one to use, or open its site first\\.`))
  assert.match(await toolIn(id, 'browser_sign_in', { login: name }), new RegExp(`^Error: The sign-in form here is on ${elsewhere}, and the login "${name}" is for ${site.replace(/\./g, '\\.')}, so nothing was entered\\.`))
  assert.match(await toolIn(id, 'browser_snapshot', {}), /input:email "Email"\n/, 'the user name was not typed there either')
  assert.deepEqual(seen, [])
  // A page without a sign-in form, whatever else it asks an e-mail address for.
  await toolIn(id, 'browser_navigate', { url: `http://${site}/plain` })
  assert.match(await toolIn(id, 'browser_sign_in', {}), /^Error: No sign-in form was found on this page/)
  assert.match(await toolIn(id, 'browser_snapshot', {}), /input:email "Your e-mail for our newsletter"$/)
  // A name that is no login's.
  await api('POST', `/api/bots/${bot.id}/secrets`, { name: 'api-key', sites: site, value: 'key_0123456789abcdef', what: 'A key' })
  assert.match(await toolIn(id, 'browser_sign_in', { login: 'api-key' }), new RegExp(`^Error: "api-key" is a secret without a user name, not a login\\. Your logins: ${name}\\.`))
  assert.match(await toolIn(id, 'browser_sign_in', { login: 'nothing' }), /^Error: You have no login named "nothing"\./)
  await api('DELETE', `/api/bots/${bot.id}/secrets/api-key`)

  // A run of an automation signs in too, and has nobody to ask for anything more.
  const subagent = await fresh()
  await say(subagent, `!tool spawn_subagent ${JSON.stringify({ name: 'Signs in', task: `!tool browser_sign_in ${JSON.stringify({ login: name })}` })}`)
  const child = await until(async () => (await api('GET', '/api/state')).threads.find((t) => t.parentId === subagent && t.kind === 'subagent'))
  // Its window is new and shows no page: nothing is known of where this login signs in, so it says so.
  assert.match(lastOutput(await settle(child.id, 60_000)), /^Error: No sign-in form was found on this page \(about:blank\)\./)
  await settle(subagent)
})

test('a login the site does not take is not sent over and over', async () => {
  const name = site.replace(/[.:]/g, '-')
  const id = await fresh()
  await api('PUT', `/api/bots/${bot.id}/secrets/${name}`, { value: 'not-the-password-any-more' })
  await toolIn(id, 'browser_navigate', { url: `http://${site}/logout` })
  seen.length = 0
  for (let n = 0; n < 3; n++) {
    assert.match(
      await toolIn(id, 'browser_sign_in', {}),
      new RegExp(`^Not signed in: the form was sent with the login "${name}" \\(${USER}\\), and the site still shows it\\.[\\s\\S]*a site locks an account after a few wrong tries\\. If the password is wrong, only the user can give the login a new one\\.\\n\\nPage: Sign in\\n[\\s\\S]*Wrong e-mail or password\\.`),
    )
  }
  assert.equal(sentTo('/session').length, 3)
  assert.match(await toolIn(id, 'browser_sign_in', {}), new RegExp(`^Error: The login "${name}" was sent 3 times and the site did not take it, so it is not tried again for now`))
  assert.equal(sentTo('/session').length, 3, 'nothing more was sent')
  assert.equal(inConversations('not-the-password-any-more'), 0)
  // Its owner gives it the right password, and it is theirs to try again.
  await api('PUT', `/api/bots/${bot.id}/secrets/${name}`, { value: PASSWORD })
  assert.match(await toolIn(id, 'browser_sign_in', {}), /and the site moved on from it\.[\s\S]*Page: Home\n/)
})

test('a site keeps the bot signed in when its browser closes, and when the server starts again', async () => {
  const id = await fresh()
  assert.match(await toolIn(id, 'browser_navigate', { url: `http://${site}/home` }), /Page: Home\n/, 'signed in by the test before')
  await api('POST', `/api/bots/${bot.id}/browser/stop`)
  // The cookie the site signs in with has no end date, and Chrome forgets those when it closes. It is kept, encrypted like a secret.
  const kept = path.join(dataOf(home), 'bots', bot.id, 'private', 'session-cookies.json')
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(kept, 'utf8'))).sort(), ['data', 'iv', 'key'])
  assert.equal(onDisk(SESSION), null)
  assert.match(await toolIn(id, 'browser_navigate', { url: `http://${site}/home` }), /Page: Home\n[\s\S]*Signed in as/)
  await stop()
  await start()
  assert.match(await toolIn(await fresh(), 'browser_navigate', { url: `http://${site}/home` }), /Page: Home\n[\s\S]*Signed in as/)
  // Signed out by the site, the cookie is not brought back.
  const again = await fresh()
  await toolIn(again, 'browser_navigate', { url: `http://${site}/logout` })
  await api('POST', `/api/bots/${bot.id}/browser/stop`)
  assert.ok(!fs.existsSync(kept))
  assert.match(await toolIn(again, 'browser_navigate', { url: `http://${site}/home` }), /Page: Sign in\n/)
  await api('POST', `/api/bots/${bot.id}/browser/stop`)
})

test('a bot asks for a login in a card: the owner types the user name and the password, and the bot signs in', async () => {
  const other = await api('POST', '/api/bots', { name: 'Asker', provider: 'mock' })
  const asked = { name: 'the-site', site, what: 'Account on the site', user: 'ana' }
  const id = await fresh(other.id)
  await api('POST', `/api/threads/${id}/messages`, { text: `!tool ask_login ${JSON.stringify(asked)}` })
  const shown = (await until(async () => (await api('GET', `/api/threads/${id}`)).items.find((i) => i.data.type === 'function_call' && i.data.name === 'ask_login'))).data
  assert.deepEqual(JSON.parse(shown.arguments), asked)
  assert.match((await call('POST', `/api/secret-requests/${shown.call_id}`, { user: USER, value: '' })).json.error, /No value/)
  // The owner corrects the user name the bot gave.
  await api('POST', `/api/secret-requests/${shown.call_id}`, { user: USER, value: PASSWORD })
  assert.equal(lastOutput(await settle(id)), `Saved as the login "the-site", for ${site}. Sign in with it: open the sign-in page and call browser_sign_in.`)
  const [login] = await logins(other.id)
  assert.deepEqual([login.name, login.user, login.sites, login.what, login.by], ['the-site', USER, [site], 'Account on the site', 'owner'])
  assert.equal(inConversations(PASSWORD), 0)
  await toolIn(id, 'browser_navigate', { url: `http://${site}/login` })
  assert.match(await toolIn(id, 'browser_sign_in', {}), /and the site moved on from it\.[\s\S]*Page: Home\n/)

  // An app from before logins answers with the password alone: the user name is the one the bot gave. Without either there is no login.
  const second = await fresh(other.id)
  await api('POST', `/api/threads/${second}/messages`, { text: `!tool ask_login ${JSON.stringify({ name: 'no-user', site, what: 'Another account' })}` })
  const open = (await until(async () => (await api('GET', `/api/threads/${second}`)).items.find((i) => i.data.type === 'function_call' && i.data.name === 'ask_login'))).data
  assert.match((await call('POST', `/api/secret-requests/${open.call_id}`, { value: 'a-password-alone-01' })).json.error, /Give the user name too\./)
  await api('POST', `/api/secret-requests/${open.call_id}`, { declined: true })
  assert.match(lastOutput(await settle(second)), /^The user said no\./)

  // A bot that signs up for an account keeps it as a login, with a password it never sees.
  assert.match(
    await toolIn(await fresh(other.id), 'save_secret', { name: 'signed-up', site: 'example.com', what: 'Account at example.com', user: 'kumi@example.com' }),
    /^Made up a password and kept it as "signed-up", for example\.com\. .* It is a login now: once the account exists, sign in with browser_sign_in and login: "signed-up"\.$/,
  )
  assert.deepEqual((await logins(other.id)).map((l) => [l.name, l.user, l.by]), [['the-site', USER, 'owner'], ['signed-up', 'kumi@example.com', 'bot']])
  await api('DELETE', `/api/bots/${other.id}`)
})

test('the owner signs in by hand in the bot’s browser, and is asked whether to keep what they typed', async () => {
  const other = await api('POST', '/api/bots', { name: 'Watched', provider: 'mock' })
  const id = await fresh(other.id)
  await toolIn(id, 'browser_navigate', { url: `http://${site}/login` })
  const windowOf = async () => (await api('GET', '/api/state')).browsers[other.id].windows.find((w) => w.threadId === id)
  const win = await windowOf()
  const socket = await openSocket()
  const viewer = crypto.randomUUID()
  const control = (action) => socket.send(JSON.stringify({ type: 'browser.control', botId: other.id, windowId: win.id, viewer, action }))
  const input = (input) => socket.send(JSON.stringify({ type: 'browser.input', botId: other.id, tabId: win.activeTab, input }))
  const key = (name) => (input({ kind: 'keydown', key: name }), input({ kind: 'keyup', key: name }))
  /** Types into the form as the owner does from the app: the e-mail field has the keyboard when the page opens. */
  const signIn = (user, password) => {
    input({ kind: 'text', text: user })
    key('Tab')
    input({ kind: 'text', text: password })
    key('Enter')
  }
  /** Signs out, which ends on the sign-in page: typed into before it is there, nothing would be typed anywhere. */
  const page = async () => {
    await api('POST', `/api/bots/${other.id}/browser/navigate`, { tabId: win.activeTab, url: `http://${site}/logout` })
    await until(async () => /Page: Sign in\n[\s\S]*input:email "Email"\n/.test(await toolIn(id, 'browser_snapshot', {})))
  }

  // The bot at work in its window is not watched: only what the owner types while they have control is.
  control('take')
  await until(async () => (await windowOf()).controller === viewer)
  // A password the site refuses is not offered: its form is still there.
  signIn(USER, 'a-wrong-password-01')
  await until(() => sentTo('/session').some((s) => s.form.password === 'a-wrong-password-01'))
  await new Promise((r) => setTimeout(r, 2500))
  assert.equal((await windowOf()).offer, null)

  // One it takes is.
  await page()
  signIn(USER, PASSWORD)
  const offer = await until(async () => (await windowOf()).offer)
  assert.deepEqual(offer, { id: offer.id, site, user: USER })
  assert.ok(!JSON.stringify(await api('GET', '/api/state')).includes(PASSWORD), 'no app is sent the password')
  assert.equal(onDisk(PASSWORD.slice(0, 12), path.join(dataOf(home), 'bots', other.id)), null, 'nothing is written down before the owner says yes')
  assert.deepEqual(await logins(other.id), [])
  // Handing back does not take the question away, and "not now" keeps nothing.
  control('give')
  await until(async () => (await windowOf()).controller === null)
  assert.equal((await windowOf()).offer.id, offer.id)
  assert.match((await call('POST', `/api/bots/${other.id}/browser/login-offer`, { windowId: win.id, offerId: 'another', save: true })).json.error, /That sign-in is no longer held\./)
  await api('POST', `/api/bots/${other.id}/browser/login-offer`, { windowId: win.id, offerId: offer.id, save: false })
  assert.equal((await windowOf()).offer, null)
  assert.deepEqual(await logins(other.id), [])

  // Yes keeps it as the bot's login, under the user name the owner confirmed, with the page its form is on.
  control('take')
  await until(async () => (await windowOf()).controller === viewer)
  await page()
  signIn(USER, PASSWORD)
  const second = await until(async () => (await windowOf()).offer)
  await api('POST', `/api/bots/${other.id}/browser/login-offer`, { windowId: win.id, offerId: second.id, save: true, user: USER })
  const [login] = await logins(other.id)
  const name = site.replace(/[.:]/g, '-')
  assert.deepEqual([login.name, login.user, login.sites, login.page, login.what, login.by], [name, USER, [site], `http://${site}/login`, `Login for ${site}`, 'owner'])
  assert.deepEqual(await api('GET', `/api/bots/${other.id}/secrets/${name}/value`), { value: PASSWORD })
  assert.equal((await windowOf()).offer, null)

  // Signing in again with what the bot has is not asked about.
  await page()
  seen.length = 0
  signIn(USER, PASSWORD)
  await until(() => sentTo('/session').length)
  await new Promise((r) => setTimeout(r, 2500))
  assert.equal((await windowOf()).offer, null)
  control('give')
  await until(async () => (await windowOf()).controller === null)

  // From then on the bot signs in by itself, from wherever it is: the login knows its sign-in page.
  await toolIn(id, 'browser_navigate', { url: `http://${site}/logout` })
  await toolIn(id, 'browser_navigate', { url: `http://${site}/plain` })
  assert.match(await toolIn(id, 'browser_sign_in', { login: name }), /and the site moved on from it\.[\s\S]*Page: Home\n/)

  // A new password typed for the same account is offered as that: it takes the place of the one the bot has.
  await api('PUT', `/api/bots/${other.id}/secrets/${name}`, { value: 'the-password-before-01' })
  control('take')
  await until(async () => (await windowOf()).controller === viewer)
  await page()
  signIn(USER, PASSWORD)
  const third = await until(async () => (await windowOf()).offer)
  assert.deepEqual(third, { id: third.id, site, user: USER, replaces: name })
  await api('POST', `/api/bots/${other.id}/browser/login-offer`, { windowId: win.id, offerId: third.id, save: true })
  assert.deepEqual(await api('GET', `/api/bots/${other.id}/secrets/${name}/value`), { value: PASSWORD })
  assert.equal((await logins(other.id)).length, 1)

  // A page that asks for the password alone, as a site does of someone it knows: the account is the one the bot has there.
  await api('PUT', `/api/bots/${other.id}/secrets/${name}`, { value: 'the-password-before-02' })
  await api('POST', `/api/bots/${other.id}/browser/navigate`, { tabId: win.activeTab, url: `http://${site}/logout` })
  await api('POST', `/api/bots/${other.id}/browser/navigate`, { tabId: win.activeTab, url: `http://${site}/welcome-back` })
  await until(async () => /Page: Welcome back\n[\s\S]*input:password "Password"\n/.test(await toolIn(id, 'browser_snapshot', {})))
  input({ kind: 'text', text: PASSWORD })
  key('Enter')
  const fourth = await until(async () => (await windowOf()).offer)
  assert.deepEqual(fourth, { id: fourth.id, site, user: USER, replaces: name })
  await api('POST', `/api/bots/${other.id}/browser/login-offer`, { windowId: win.id, offerId: fourth.id, save: true })
  assert.deepEqual(await api('GET', `/api/bots/${other.id}/secrets/${name}/value`), { value: PASSWORD })

  // A site that says back what was typed: while the password is held for the owner's answer, the bot does not read it there.
  await api('POST', `/api/bots/${other.id}/browser/navigate`, { tabId: win.activeTab, url: `http://${site}/shows` })
  await until(async () => /Page: Sign in\n[\s\S]*input:email "Email"\n/.test(await toolIn(id, 'browser_snapshot', {})))
  signIn('someone@example.com', 'said-back-password-77')
  const fifth = await until(async () => (await windowOf()).offer)
  assert.match(await toolIn(id, 'browser_snapshot', {}), /Welcome\. Your password is \[secret: a password typed by hand\]$/)
  assert.equal(inConversations('said-back-password-77'), 0)
  await api('POST', `/api/bots/${other.id}/browser/login-offer`, { windowId: win.id, offerId: fifth.id, save: false })
  socket.close()
  await api('DELETE', `/api/bots/${other.id}`)
})
