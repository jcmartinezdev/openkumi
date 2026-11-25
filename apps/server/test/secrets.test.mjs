// A bot's secrets, against a real server process: kept encrypted with a key that is not in the
// data folder, used by name, sent only to the site they are for, and never written into the
// conversation. The model is the scripted one; the page a password is typed into is in a real
// (headless) Chrome.
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

// Clear of the other tests' servers, of one run from the repository, and of the ports fetch refuses.
const PORT = 5200 + Math.floor(Math.random() * 300)
const BASE = `http://127.0.0.1:${PORT}`
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-secrets-'))
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
const tool = async (name, args, botId = bot.id, timeoutMs) => lastOutput(await say(await fresh(botId), `!tool ${name} ${JSON.stringify(args)}`, timeoutMs))
const toolIn = async (threadId, name, args, timeoutMs) => lastOutput(await say(threadId, `!tool ${name} ${JSON.stringify(args)}`, timeoutMs))

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

/** A service a bot has a key for. It says back what it was sent, and notes it for the test to read. */
const seen = []
const service = http.createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const url = new URL(req.url, 'http://service')
  const got = { path: url.pathname, query: Object.fromEntries(url.searchParams), method: req.method, authorization: req.headers.authorization ?? null, type: req.headers['content-type'] ?? null, body }
  seen.push(got)
  if (url.pathname === '/away') return res.writeHead(302, { Location: `http://localhost:${service.address().port}/echo` }).end()
  if (url.pathname === '/moved') return res.writeHead(307, { Location: '/echo' }).end()
  // Sends the request on with everything its address carried: first to another page of its own, then to another site.
  if (url.pathname === '/hop') return res.writeHead(307, { Location: `/hop2${url.search}` }).end()
  if (url.pathname === '/hop2') return res.writeHead(302, { Location: `http://localhost:${service.address().port}/echo${url.search}` }).end()
  // A page that opens a blank one, which has no address of its own and is this site's page all the same.
  if (url.pathname === '/opener') return res.writeHead(200, { 'Content-Type': 'text/html' }).end(`<title>Opener</title><input value="held by the opener"><button onclick="window.open('about:blank')">Pop</button>`)
  // Sends the request on to an address that names a secret, as if the bot had asked for it there.
  if (url.pathname === '/names') return res.writeHead(302, { Location: '/echo?leak={{secret:plausible}}' }).end()
  // Says back only how the key it was sent begins, as a page that cuts a long value short does.
  if (url.pathname === '/clip') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end(`Your key begins ${(req.headers.authorization ?? '').slice(7, 47)}…`)
  if (url.pathname === '/form') {
    return res
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end('<title>Sign up</title><form method="post" action="/posted"><input name="password" placeholder="Choose a password"><button>Go</button></form><textarea placeholder="Notes"></textarea>')
  }
  if (url.pathname === '/posted') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<title>Done</title><p>Signed up.</p>')
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(got))
})
/** The service's site as a secret names it, and the same computer under another name: another site. */
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

before(async () => {
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve))
  site = `127.0.0.1:${service.address().port}`
  elsewhere = `localhost:${service.address().port}`
  await start()
  token = JSON.parse(fs.readFileSync(path.join(dataOf(home), 'auth.json'), 'utf8')).accessToken
  bot = await api('POST', '/api/bots', { name: 'Keeper', provider: 'mock' })
})

after(async () => {
  await stop()
  service.close()
  fs.rmSync(home, { recursive: true, force: true })
  fs.rmSync(keys, { recursive: true, force: true })
})

const KEY = 'plsbl_4f9c2d7e81a04b6b9d3e5f60718293a4'

test('the owner adds a secret: it is kept encrypted, with its key outside the data folder, and no app is sent its value', async () => {
  assert.deepEqual(await api('GET', `/api/bots/${bot.id}/secrets`), { secrets: [], kept: null })
  // A site may be given as a whole address: what is kept is its host, with the port when it is not the usual one.
  const added = await api('POST', `/api/bots/${bot.id}/secrets`, { name: 'plausible', sites: `http://${site}/api/v2`, value: KEY, what: 'Plausible API key' })
  assert.deepEqual([added.name, added.what, added.sites, added.by, added.usedAt], ['plausible', 'Plausible API key', [site], 'owner', null])
  assert.ok(!JSON.stringify(added).includes(KEY))

  const { secrets, kept } = await api('GET', `/api/bots/${bot.id}/secrets`)
  assert.equal(kept, 'file')
  assert.equal(secrets.length, 1)
  assert.ok(!JSON.stringify(secrets).includes(KEY))

  // On disk: in the bot's private folder, which only the person's account reads, and not as it was typed.
  const file = path.join(dataOf(home), 'bots', bot.id, 'private', 'secrets.json')
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.equal(onDisk(KEY), null, 'the value is nowhere in the data folder')
  // The key it is encrypted with is elsewhere: a copy of the data folder alone opens nothing.
  const [keyFile] = fs.readdirSync(keys)
  assert.match(keyFile, /^k_[\w-]+\.key$/)
  assert.equal(fs.statSync(path.join(keys, keyFile)).mode & 0o777, 0o600)
  assert.equal(onDisk(fs.readFileSync(path.join(keys, keyFile), 'utf8').trim()), null, 'the key is not in the data folder')

  // Its owner can read it, on the computer that runs OpenKumi.
  assert.deepEqual(await api('GET', `/api/bots/${bot.id}/secrets/plausible/value`), { value: KEY })

  // What it is and where it goes can be changed without giving the value again.
  const changed = await api('PUT', `/api/bots/${bot.id}/secrets/plausible`, { what: 'Plausible key for reports' })
  assert.deepEqual([changed.what, changed.sites], ['Plausible key for reports', [site]])
  assert.deepEqual(await api('GET', `/api/bots/${bot.id}/secrets/plausible/value`), { value: KEY })

  // A name is something a model types between braces, and a site is a site: each of them by itself, not "the rest".
  const add = (secret) => call('POST', `/api/bots/${bot.id}/secrets`, secret)
  assert.equal((await add({ name: 'No good!', sites: site, value: 'x' })).status, 400)
  assert.match((await add({ name: 'other', sites: '', value: 'x' })).json.error, /which site/)
  assert.match((await add({ name: 'other', sites: '*.example.com', value: 'x' })).json.error, /"\*" does not stand for the rest/)
  assert.match((await add({ name: 'other', sites: site, value: '' })).json.error, /No value/)
  // Adding never writes over one that is there, and changing never adds.
  assert.match((await add({ name: 'plausible', sites: 'example.com', value: 'another-value-0001', what: 'Something else' })).json.error, /There is already a secret named "plausible"/)
  assert.match((await add({ name: 'Plausible', sites: 'example.com', value: 'another-value-0001' })).json.error, /There is already a secret named "plausible"/, 'however the name is typed')
  assert.match((await call('PUT', `/api/bots/${bot.id}/secrets/other`, { sites: site, value: 'x' })).json.error, /There is no secret named "other"/)
  const still = (await api('GET', `/api/bots/${bot.id}/secrets`)).secrets
  assert.deepEqual(still.map((s) => [s.name, s.what, s.sites]), [['plausible', 'Plausible key for reports', [site]]])
  assert.deepEqual(await api('GET', `/api/bots/${bot.id}/secrets/plausible/value`), { value: KEY })
})

test('a bot is told of its secrets by name, never by value', async () => {
  const told = lastText(await say(await fresh(), '!system'))
  assert.match(told, /# Your secrets\nYou have a vault for secrets/)
  assert.ok(told.includes(`Your secrets:\n- plausible: Plausible key for reports (for ${site})\n`))
  assert.match(told, /call ask_secret: the user types it into a private card/)
  assert.ok(!told.includes(KEY))
  // In its conversation with its owner it can ask for one; anywhere it can keep one.
  assert.match(lastText(await say(await fresh(), '!tools')), /\bweb_fetch ask_secret save_secret\b/)
  const id = await fresh()
  await say(id, '!tool spawn_subagent {"name":"Offered","task":"!tools"}')
  const child = await until(async () => (await api('GET', '/api/state')).threads.find((t) => t.parentId === id && t.kind === 'subagent'))
  const offered = lastText(await settle(child.id))
  assert.match(offered, /\bsave_secret\b/)
  assert.doesNotMatch(offered, /ask_secret/, 'nobody reads a subagent’s thread, so it cannot ask there')
  await settle(id)
  // A bot that has none is told so.
  const other = await api('POST', '/api/bots', { name: 'Empty', provider: 'mock' })
  assert.match(lastText(await say(await fresh(other.id), '!system')), /as \[secret: name\]\.\nYou have none yet\.\n/)
  await api('DELETE', `/api/bots/${other.id}`)
})

test('web_fetch puts a secret in by name as the request leaves, and takes it out of what comes back', async () => {
  seen.length = 0
  const out = await tool('web_fetch', {
    url: `http://${site}/echo?site_id=openkumi.ai`,
    method: 'POST',
    headers: { Authorization: 'Bearer {{secret:plausible}}' },
    body: '{"metrics":["visitors"],"date_range":"7d"}',
  })
  // The service was sent the value itself, in a request made as the bot wrote it.
  assert.deepEqual(seen, [{ path: '/echo', query: { site_id: 'openkumi.ai' }, method: 'POST', authorization: `Bearer ${KEY}`, type: 'application/json', body: '{"metrics":["visitors"],"date_range":"7d"}' }])
  // It said the key back, and the bot reads the secret's name in its place.
  assert.match(out, /^HTTP 200 /)
  assert.ok(out.includes('"authorization":"Bearer [secret: plausible]"'), out)
  assert.ok(!out.includes(KEY))

  // In the address, where it is written as an address takes it, and in the body.
  seen.length = 0
  const inAddress = await tool('web_fetch', { url: `http://${site}/echo?key={{secret:plausible}}&n=1`, method: 'PUT', body: 'key={{ secret:plausible }}' })
  assert.deepEqual([seen[0].query, seen[0].body, seen[0].method], [{ key: KEY, n: '1' }, `key=${KEY}`, 'PUT'])
  assert.ok(inAddress.startsWith(`HTTP 200 http://${site}/echo?key={{secret:plausible}}&n=1\n`), inAddress)
  assert.ok(!inAddress.includes(KEY))

  // Followed to another page of the same site, as it was sent.
  seen.length = 0
  await tool('web_fetch', { url: `http://${site}/moved`, method: 'POST', headers: { Authorization: 'Bearer {{secret:plausible}}' }, body: '{"a":1}' })
  assert.deepEqual(seen.map((s) => [s.path, s.method, s.authorization, s.body]), [['/moved', 'POST', `Bearer ${KEY}`, '{"a":1}'], ['/echo', 'POST', `Bearer ${KEY}`, '{"a":1}']])

  // Nothing of it reached the conversation, and its owner sees that it was used.
  assert.equal(inConversations(KEY), 0)
  assert.ok((await api('GET', `/api/bots/${bot.id}/secrets`)).secrets[0].usedAt > 0)

  // A request without a secret is what it always was, and can now send something too.
  seen.length = 0
  assert.match(await tool('web_fetch', { url: `http://${site}/echo` }), /"method":"GET"/)
  assert.match(await tool('web_fetch', { url: `http://${site}/echo`, method: 'DELETE', headers: { 'X-Why': 'test' } }), /"method":"DELETE"/)
  assert.match(await tool('web_fetch', { url: `http://${site}/echo`, body: 'x' }), /^Error: A GET sends no body/)
  // A header the bot gave is sent as it gave it, also one that says what a body would be on a request that has none.
  seen.length = 0
  await tool('web_fetch', { url: `http://${site}/echo`, headers: { 'Content-Type': 'application/json' } })
  assert.equal(seen[0].type, 'application/json')
  // It goes with the body when a site answers a POST by sending it on to be read elsewhere.
  seen.length = 0
  await tool('web_fetch', { url: `http://${site}/away`, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' })
  assert.deepEqual(seen.map((s) => [s.path, s.method, s.type, s.body]), [['/away', 'POST', 'application/json', '{"a":1}'], ['/echo', 'GET', null, '']])
  assert.match(await tool('web_fetch', { url: `http://${site}/echo`, headers: { Host: 'evil.example' } }), /^Error: The header "Host" cannot be set/)
})

test('a secret goes to the site it is for and nowhere else', async () => {
  seen.length = 0
  // The same computer under another name is another site.
  assert.equal(
    await tool('web_fetch', { url: `http://${elsewhere}/echo`, headers: { Authorization: 'Bearer {{secret:plausible}}' } }),
    `Error: The secret "plausible" is for ${site}, not for ${elsewhere}, so it was not sent. Only the user can change where a secret may go, in your settings under Secrets.`,
  )
  assert.match(await tool('web_fetch', { url: `http://${elsewhere}/echo?k={{secret:plausible}}` }), /^Error: The secret "plausible" is for /)
  assert.match(await tool('web_fetch', { url: `http://${elsewhere}/echo`, method: 'POST', body: '{{secret:plausible}}' }), /^Error: The secret "plausible" is for /)
  // Nor can it be made part of where the request goes.
  assert.match(await tool('web_fetch', { url: 'http://{{secret:plausible}}.example.com/' }), /^Error: /)
  assert.match(await tool('web_fetch', { url: `http://${site}/echo`, headers: { Authorization: 'Bearer {{secret:nothing}}' } }), /^Error: You have no secret named "nothing"\. Yours: plausible\./)
  assert.deepEqual(seen, [], 'none of those requests was made')

  // A site that answers by sending the request on elsewhere does not take the secret along.
  const away = await tool('web_fetch', { url: `http://${site}/away`, headers: { Authorization: 'Bearer {{secret:plausible}}' } })
  assert.equal(away, `Error: ${site} sent the request on to ${elsewhere}, which "plausible" is not for, so it was not followed.`)
  assert.deepEqual(seen.map((s) => s.path), ['/away'])
  // Nor when it answers so twice: first to a page of its own, repeating the key in the address, and from there to another site.
  seen.length = 0
  const twice = await tool('web_fetch', { url: `http://${site}/hop?key={{secret:plausible}}` })
  assert.equal(twice, `Error: ${site} sent the request on to ${elsewhere}, which "plausible" is not for, so it was not followed.`)
  assert.deepEqual(seen.map((s) => [s.path, s.query.key]), [['/hop', KEY], ['/hop2', KEY]], 'the other site was never asked')
  // Only the bot names a secret. An answer that sends the request on to an address with a secret's name in it,
  // to have it put in where the bot never asked for it, is not followed, on the secret's own site either.
  seen.length = 0
  assert.equal(await tool('web_fetch', { url: `http://${site}/names` }), `Error: ${site} sent the request on to an address that names one of your secrets, which only you do, so it was not followed.`)
  assert.deepEqual(seen.map((s) => s.path), ['/names'])
  // Written out by the bot itself, what says who is asking stays behind too; the rest goes along.
  seen.length = 0
  await tool('web_fetch', { url: `http://${site}/away`, headers: { Authorization: 'Bearer typed-by-the-bot', 'X-Other': '1' } })
  assert.deepEqual(seen.map((s) => [s.path, s.authorization]), [['/away', 'Bearer typed-by-the-bot'], ['/echo', null]])

  // Out on the internet it only travels where nobody on the way can read it.
  await api('POST', `/api/bots/${bot.id}/secrets`, { name: 'far', sites: 'example.com', value: 'far-away-value-1', what: 'A key for a site far away' })
  assert.match(await tool('web_fetch', { url: 'http://example.com/', headers: { 'X-Key': '{{secret:far}}' } }), /^Error: The secret "far" was not sent: http:\/\/example\.com is not an https address/)
  await api('DELETE', `/api/bots/${bot.id}/secrets/far`)
  // Nor is a name taken for where it leads, this computer's own name neither: without https only an address written as numbers will do.
  await api('POST', `/api/bots/${bot.id}/secrets`, { name: 'named', sites: elsewhere, value: 'named-host-value-01', what: 'A key for a site known by name' })
  seen.length = 0
  assert.match(await tool('web_fetch', { url: `http://${elsewhere}/echo`, headers: { 'X-Key': '{{secret:named}}' } }), /^Error: The secret "named" was not sent: http:\/\/localhost:\d+ is not an https address, .* Without https a secret only goes to an address written as numbers/)
  assert.deepEqual(seen, [])
  await api('DELETE', `/api/bots/${bot.id}/secrets/named`)
  assert.deepEqual((await api('GET', `/api/bots/${bot.id}/secrets`)).secrets.map((s) => s.name), ['plausible'])

  // Another bot has no such secret: each bot's vault is its own.
  const other = await api('POST', '/api/bots', { name: 'Neighbour', provider: 'mock' })
  assert.match(await tool('web_fetch', { url: `http://${site}/echo`, headers: { Authorization: 'Bearer {{secret:plausible}}' } }, other.id), /^Error: You have no secret named "plausible", or any other yet\./)
  await api('DELETE', `/api/bots/${other.id}`)
})

test('a bot asks for a secret, and its owner types it into a card: it never passes through the conversation', async () => {
  const typed = 'svc_live_9b1d4e7a2c5f48d0a3b6c9e2f5a8d1b4'
  const asked = { name: 'service-key', site, what: 'Service API key', where: 'https://example.com/settings/keys' }
  const waitFor = async (id) => (await until(async () => (await api('GET', `/api/threads/${id}`)).items.find((i) => i.data.type === 'function_call' && i.data.name === 'ask_secret'))).data

  const id = await fresh()
  await api('POST', `/api/threads/${id}/messages`, { text: `!tool ask_secret ${JSON.stringify(asked)}` })
  const shown = await waitFor(id)
  // The card is drawn from the call, which says what is asked for and where it will go.
  assert.deepEqual(JSON.parse(shown.arguments), asked)
  assert.equal((await api('GET', `/api/threads/${id}`)).thread.status, 'running', 'the bot waits')
  // An empty answer is no answer: the bot goes on waiting.
  assert.match((await call('POST', `/api/secret-requests/${shown.call_id}`, { value: '' })).json.error, /No value/)
  await api('POST', `/api/secret-requests/${shown.call_id}`, { value: typed })
  const items = await settle(id)
  assert.equal(lastOutput(items), `Saved as "service-key", for ${site}. Use it by name: {{secret:service-key}} in web_fetch, or secret: "service-key" in browser_type.`)
  const kept = (await api('GET', `/api/bots/${bot.id}/secrets`)).secrets.find((s) => s.name === 'service-key')
  assert.deepEqual([kept.what, kept.sites, kept.by], ['Service API key', [site], 'owner'])
  assert.equal(inConversations(typed), 0)
  assert.equal(onDisk(typed), null)
  // And it works: the service is sent what was typed.
  seen.length = 0
  await toolIn(id, 'web_fetch', { url: `http://${site}/echo`, headers: { 'Authorization': 'Bearer {{secret:service-key}}' } })
  assert.equal(seen[0].authorization, `Bearer ${typed}`)
  // The card answers once.
  assert.match((await call('POST', `/api/secret-requests/${shown.call_id}`, { value: 'again' })).json.error, /no longer waiting/)

  // The owner can say no.
  const second = await fresh()
  await api('POST', `/api/threads/${second}/messages`, { text: `!tool ask_secret ${JSON.stringify({ ...asked, name: 'unwanted' })}` })
  await api('POST', `/api/secret-requests/${(await waitFor(second)).call_id}`, { declined: true })
  assert.match(lastOutput(await settle(second)), /^The user said no\./)
  assert.ok(!(await api('GET', `/api/bots/${bot.id}/secrets`)).secrets.some((s) => s.name === 'unwanted'))

  // Asked again for one it has, nothing is shown: what is typed would take its place. Unless that is what the bot means, and says.
  assert.match(await tool('ask_secret', asked), /^Error: You already have a secret named "service-key"\. Use it, or pick another name\. If it no longer works, ask again with replace set to true/)
  const third = await fresh()
  await api('POST', `/api/threads/${third}/messages`, { text: `!tool ask_secret ${JSON.stringify({ ...asked, replace: true })}` })
  await api('POST', `/api/secret-requests/${(await waitFor(third)).call_id}`, { value: 'svc_live_replacement_0001' })
  await settle(third)
  assert.deepEqual(await api('GET', `/api/bots/${bot.id}/secrets/service-key/value`), { value: 'svc_live_replacement_0001' })

  // What the card said holds when it is answered: one added under the name while it waited is not written over.
  const meanwhile = await fresh()
  await api('POST', `/api/threads/${meanwhile}/messages`, { text: `!tool ask_secret ${JSON.stringify({ ...asked, name: 'meanwhile' })}` })
  const open = await waitFor(meanwhile)
  await api('POST', `/api/bots/${bot.id}/secrets`, { name: 'meanwhile', sites: 'example.com', value: 'added-in-settings-0001', what: 'Added in settings' })
  assert.match((await call('POST', `/api/secret-requests/${open.call_id}`, { value: 'typed-into-the-card-0002' })).json.error, /There is already a secret named "meanwhile"/)
  assert.deepEqual(await api('GET', `/api/bots/${bot.id}/secrets/meanwhile/value`), { value: 'added-in-settings-0001' })
  await api('POST', `/api/secret-requests/${open.call_id}`, { declined: true })
  await settle(meanwhile)
  await api('DELETE', `/api/bots/${bot.id}/secrets/meanwhile`)
  // And there is nothing to replace where there is nothing.
  assert.equal(await tool('ask_secret', { ...asked, name: 'nothing-there', replace: true }), 'Error: You have no secret named "nothing-there" to replace. Ask for it without replace.')

  // Stopping the bot ends the wait.
  const fourth = await fresh()
  await api('POST', `/api/threads/${fourth}/messages`, { text: `!tool ask_secret ${JSON.stringify({ ...asked, name: 'stopped' })}` })
  const waiting = await waitFor(fourth)
  await api('POST', `/api/threads/${fourth}/stop`)
  await settle(fourth)
  assert.match((await call('POST', `/api/secret-requests/${waiting.call_id}`, { value: 'too late' })).json.error, /no longer waiting/)

  // What is kept is what the card showed: a name or a site that would be kept otherwise is sent back to the bot.
  assert.equal(await tool('ask_secret', { ...asked, name: 'Service Key' }), 'Error: Give the name as it will be kept: "service-key".')
  assert.equal(await tool('ask_secret', { ...asked, site: 'https://Example.com/login' }), 'Error: Give the site as its host alone: "example.com".')
  assert.match(await tool('ask_secret', { ...asked, what: '' }), /^Error: Say what it is/)
})

test('a bot keeps a value it came to hold, and it is taken out of the conversation', async () => {
  const held = 'ghp_h3ldByTheBot00aa11bb22cc33dd44ee55ff'
  const id = await fresh()
  // It was written out before it was kept: said by the owner, and repeated by the bot.
  const before = await say(id, `here is the key: ${held}`)
  assert.ok(lastText(before).includes(held))
  assert.equal(inConversations(held), 2)
  const args = { name: 'github', site, what: 'GitHub token', value: held }
  const items = await say(id, `!tool save_secret ${JSON.stringify(args)}`)
  assert.equal(
    lastOutput(items),
    `Kept as "github", for ${site}. From now on use it by name ({{secret:github}} in web_fetch, secret: "github" in browser_type) and do not write the value anywhere. Where it stood earlier in this conversation, its name stands now.`,
  )
  // The call is written down without the value, and what was said before has the secret's name in its place.
  assert.deepEqual(JSON.parse(items.find((d) => d.type === 'function_call').arguments), { ...args, value: '[not written here]' })
  assert.equal(inConversations(held), 0)
  assert.equal(items.find((d) => d.type === 'message' && d.role === 'user').text, 'here is the key: [secret: github]')
  assert.equal(items.find((d) => d.type === 'message' && d.role === 'assistant').text, 'Echo: here is the key: [secret: github]')
  assert.equal(onDisk(held), null)
  const kept = (await api('GET', `/api/bots/${bot.id}/secrets`)).secrets.find((s) => s.name === 'github')
  assert.deepEqual([kept.by, kept.what], ['bot', 'GitHub token'])
  assert.deepEqual(await api('GET', `/api/bots/${bot.id}/secrets/github/value`), { value: held })

  // What a secret is said to be is kept as it is and told to the bot, so the value has no place in it, nor in its name.
  const told = 'key_wr1ttenInWhatItIs00aa11bb22'
  await toolIn(id, 'save_secret', { name: 'described', site, what: `The key ${told} for reports`, value: told })
  const described = (await api('GET', `/api/bots/${bot.id}/secrets`)).secrets.find((s) => s.name === 'described')
  assert.equal(described.what, 'The key [secret: described] for reports')
  // Also one with spaces in it, as it was written, before what it is said to be is tidied up.
  const spaced = 'correct  horse   battery staple'
  await toolIn(id, 'save_secret', { name: 'spaced', site, what: `It is "${spaced}", as agreed`, value: spaced })
  assert.equal((await api('GET', `/api/bots/${bot.id}/secrets`)).secrets.find((s) => s.name === 'spaced').what, 'It is "[secret: spaced]", as agreed')
  await api('DELETE', `/api/bots/${bot.id}/secrets/spaced`)
  // And the other way round: written with a line break where the value has a space, it is the value once tidied up.
  const plain = 'correct horse battery staple'
  await toolIn(id, 'save_secret', { name: 'broken', site, what: 'It is correct horse\nbattery staple', value: plain })
  assert.equal((await api('GET', `/api/bots/${bot.id}/secrets`)).secrets.find((s) => s.name === 'broken').what, 'It is [secret: broken]')
  await api('DELETE', `/api/bots/${bot.id}/secrets/broken`)
  assert.equal(onDisk(told), null)
  assert.equal(inConversations(told), 0)
  const instructions = (await api('GET', `/api/bots/${bot.id}/instructions`)).text
  assert.ok(instructions.includes('- described: The key [secret: described] for reports (for ') && !instructions.includes(told))
  assert.match((await call('PUT', `/api/bots/${bot.id}/secrets/described`, { what: `Now ${told} again` })).json.what, /^Now \[secret: described\] again$/)
  assert.match(await toolIn(id, 'save_secret', { name: 'abcdef-012345', site, what: 'Named after itself', value: 'abcdef-012345' }), /^Error: A secret’s name is what it is called, not the secret itself\./)
  await api('DELETE', `/api/bots/${bot.id}/secrets/described`)

  // A bot neither replaces nor removes one: what was there may be kept nowhere else.
  assert.equal(
    await toolIn(id, 'save_secret', { ...args, value: 'another-value-entirely' }),
    'Error: There is already a secret named "github". Pick another name: only the user replaces or removes one, in your settings under Secrets.',
  )
  assert.deepEqual(await api('GET', `/api/bots/${bot.id}/secrets/github/value`), { value: held })
  assert.equal(inConversations('another-value-entirely'), 1, 'only in what was said to the scripted model, which stands for the owner here')

  // The same through an engine, which makes its calls at the address it was given for the turn.
  const engine = await api('POST', '/api/bots', { name: 'Engine', provider: 'claude-code' })
  const through = await say(await fresh(engine.id), `!tool save_secret ${JSON.stringify({ ...args, value: 'eng_1nTheEngine00aa11bb22cc33' })}`)
  assert.equal(JSON.parse(through.find((d) => d.type === 'function_call').arguments).value, '[not written here]')
  assert.equal(inConversations('eng_1nTheEngine00aa11bb22cc33'), 0)
  assert.deepEqual(await api('GET', `/api/bots/${engine.id}/secrets/github/value`), { value: 'eng_1nTheEngine00aa11bb22cc33' })
  // Deleting a bot takes its vault with it.
  await api('DELETE', `/api/bots/${engine.id}`)
  assert.ok(!fs.existsSync(path.join(dataOf(home), 'bots', engine.id)))
})

test('a password is made up, typed into a page of its site, and never seen by the bot', async () => {
  const id = await fresh()
  assert.equal(
    await toolIn(id, 'save_secret', { name: 'signup', site, what: 'Password for the service' }),
    `Made up a password and kept it as "signup", for ${site}. Type it with browser_type and secret: "signup". The user can see it in your settings, under Secrets.`,
  )
  const { value: password } = await api('GET', `/api/bots/${bot.id}/secrets/signup/value`)
  assert.match(password, /^[A-Za-z0-9\-_!@#%+=]{24}$/)
  assert.ok(/[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password) && /[-_!@#%+=]/.test(password), 'some of every kind')

  // On a page of another site it is not typed.
  await toolIn(id, 'browser_navigate', { url: `http://${elsewhere}/form` }, 60_000)
  const wrong = await toolIn(id, 'browser_snapshot', {})
  const wrongRef = Number(wrong.match(/\[(\d+)\] input:text "Choose a password"/)[1])
  assert.match(await toolIn(id, 'browser_type', { ref: wrongRef, secret: 'signup' }), /^Error: The secret "signup" is for .*, not for localhost:\d+, so it was not sent\./)
  assert.equal(await toolIn(id, 'browser_eval', { expression: 'document.querySelector("input").value' }), '""')

  // On a page of its own site it is, and what the page then shows of it reads as its name.
  const page = await toolIn(id, 'browser_navigate', { url: `http://${site}/form` })
  const ref = Number(page.match(/\[(\d+)\] input:text "Choose a password"/)[1])
  // A secret goes into a field and nowhere else: aimed at a button, nothing is clicked, and nothing typed at whatever has the focus.
  seen.length = 0
  const button = Number(page.match(/\[(\d+)\] button "Go"/)[1])
  assert.match(await toolIn(id, 'browser_type', { ref: button, secret: 'signup' }), /^Error: The secret was not typed: that is not a field text can be put into/)
  assert.deepEqual(seen.filter((s) => s.path === '/posted'), [], 'the form was not sent')
  // A script of the bot's could give a value back in a shape nothing looks for, or send it elsewhere, and one
  // that ran before the secret was typed would still be there to read it. So on a site one of its secrets is
  // for, the bot runs none: before, while or after.
  const refused = new RegExp(`^Error: One of your secrets is for ${site.replace(/\./g, '\\.')}, and a script could read it out of a page there, so none is run on that site\\.`)
  assert.match(await toolIn(id, 'browser_eval', { expression: 'document.querySelector("input").addEventListener("input", (e) => localStorage.setItem("seen", btoa(e.target.value)))' }), refused)
  assert.equal(await toolIn(id, 'browser_type', { ref, secret: 'signup' }), 'Typed the secret "signup".')
  assert.match(await toolIn(id, 'browser_snapshot', {}), /input:text "Choose a password" value="\[secret: signup\]"/)
  for (const expression of ['[...document.querySelector("input").value].join(" ")', 'fetch("http://localhost:1/?" + document.querySelector("input").value)', 'document.title']) {
    assert.match(await toolIn(id, 'browser_eval', { expression }), refused)
  }
  assert.match(await toolIn(id, 'browser_type', { ref, secret: 'signup', text: 'both' }), /^Error: Give text or secret, not both\./)
  // Sent off, the service has the password itself.
  seen.length = 0
  await toolIn(id, 'browser_press_key', { key: 'Enter' })
  await until(() => seen.find((s) => s.path === '/posted'))
  assert.equal(new URLSearchParams(seen.find((s) => s.path === '/posted').body).get('password'), password)
  // The service has the form before the browser has the page that answers it: looked at too early, the page is still on its way.
  await until(async () => /^Page: Done\n/.test(await toolIn(id, 'browser_snapshot', {})))
  assert.match(await toolIn(id, 'browser_eval', { expression: 'localStorage.getItem("seen")' }), refused)

  // The other way round, with another bot: on a site where a script of the bot's ran in a window before it had a
  // secret for it, the script may still be there, in that page or reaching into one it opened. So the secret is
  // not put into any page of that window.
  const scripter = await api('POST', '/api/bots', { name: 'Scripter', provider: 'mock' })
  const theirs = await fresh(scripter.id)
  await toolIn(theirs, 'browser_navigate', { url: `http://${site}/form` }, 60_000)
  const planted =
    'window.w = window.open(location.href); setInterval(() => { try { const v = window.w.document.querySelector("input").value; if (v) window.w.document.title = "GOT " + [...v].reverse().join("") } catch {} }, 50); "planted"'
  assert.equal(await toolIn(theirs, 'browser_eval', { expression: planted }), '"planted"', 'this bot has no secret for the site yet')
  await toolIn(theirs, 'save_secret', { name: 'theirs', site, what: 'A password made up later' })
  // The page it opened is where the bot now works, in the same window.
  await until(async () => (await api('GET', '/api/state')).browsers[scripter.id]?.tabs.length === 2)
  const popup = await toolIn(theirs, 'browser_snapshot', {})
  const inPopup = Number(popup.match(/\[(\d+)\] input:text "Choose a password"/)[1])
  assert.match(await toolIn(theirs, 'browser_type', { ref: inPopup, secret: 'theirs' }), /^Error: You ran a script of your own on 127\.0\.0\.1:\d+ in this browser window, or in a page that may belong to it, and it could read what is put into the page\. .* have a subagent do this step, in a window of its own\./)
  const untouched = await toolIn(theirs, 'browser_snapshot', {})
  assert.ok(!untouched.includes('GOT') && !untouched.includes('value='), untouched)
  // A window of its own is another matter (a conversation keeps its window when it is started fresh; a subagent, a run, or a browser started anew has another).
  await api('POST', `/api/bots/${scripter.id}/browser/stop`)
  const clean = Number((await toolIn(theirs, 'browser_navigate', { url: `http://${site}/form` }, 60_000)).match(/\[(\d+)\] input:text "Choose a password"/)[1])
  assert.equal(await toolIn(theirs, 'browser_type', { ref: clean, secret: 'theirs' }), 'Typed the secret "theirs".')
  // And once a secret was put into a page of a window, no script runs on that site there, though its owner removes the secret: the field still holds it.
  await api('DELETE', `/api/bots/${scripter.id}/secrets/theirs`)
  assert.match(await toolIn(theirs, 'browser_eval', { expression: 'document.querySelector("input").value' }), refused)
  // A page with no address of its own (a blank one, as a new window is, or as another page opens) may be any
  // site's. A bot without secrets runs scripts there as it always did; but after that no secret is put into
  // any page of that window, whichever site it is on.
  await api('POST', `/api/bots/${scripter.id}/browser/stop`)
  assert.equal(await toolIn(theirs, 'browser_eval', { expression: '1 + 1' }, 60_000), '2')
  await toolIn(theirs, 'save_secret', { name: 'later', site, what: 'A password made up after the script' })
  const after = Number((await toolIn(theirs, 'browser_navigate', { url: `http://${site}/form` })).match(/\[(\d+)\] input:text "Choose a password"/)[1])
  assert.match(await toolIn(theirs, 'browser_type', { ref: after, secret: 'later' }), /^Error: You ran a script of your own on 127\.0\.0\.1:\d+ in this browser window, or in a page that may belong to it,/)
  await api('DELETE', `/api/bots/${scripter.id}`)

  // A bot that has secrets runs no script in such a page: the blank page a site's page opens is that site's, and a
  // script in it reaches into the page that opened it. A page that is all its own, such as a data: page, is another matter.
  const opener = await toolIn(id, 'browser_navigate', { url: `http://${site}/opener` }, 60_000)
  assert.match(await toolIn(id, 'browser_click', { ref: Number(opener.match(/\[(\d+)\] button "Pop"/)[1]) }), /URL: about:blank/)
  assert.match(await toolIn(id, 'browser_eval', { expression: 'window.opener.document.querySelector("input").value' }), /^Error: This page has no address of its own, so it may belong to a site one of your secrets is for/)
  // The way on is to open something in it.
  await toolIn(id, 'browser_navigate', { url: 'data:text/html,' + encodeURIComponent('<title>mine</title>') })
  assert.equal(await toolIn(id, 'browser_eval', { expression: 'document.title' }), '"mine"')

  // A long token is known by how it begins: a page's outline shows the first 80 characters of a field, and that is as much the secret.
  const long = `tok_${'L0ngT0ken'.repeat(14)}`
  await api('POST', `/api/bots/${bot.id}/secrets`, { name: 'long', sites: site, value: long, what: 'A long token' })
  const form = await toolIn(id, 'browser_navigate', { url: `http://${site}/form` })
  const notes = Number(form.match(/\[(\d+)\] textarea "Notes"/)[1])
  await toolIn(id, 'browser_type', { ref: notes, secret: 'long' })
  const outline = await toolIn(id, 'browser_snapshot', {})
  assert.match(outline, /textarea "Notes" value="\[secret: long\]"/, outline)
  assert.ok(!outline.includes('L0ngT0ken'))
  // The same where a service says back only part of what it was sent.
  assert.match(await toolIn(id, 'web_fetch', { url: `http://${site}/clip`, headers: { Authorization: 'Bearer {{secret:long}}' } }), /\n\nYour key begins \[secret: long\]…$/)
  assert.equal(inConversations('L0ngT0ken'), 0)
  await api('DELETE', `/api/bots/${bot.id}/secrets/long`)

  // Two keys of a kind begin alike (every such token has the same first part). Each is taken out whole, under its own name.
  const head = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
  const anon = `${head}.eyJyb2xlIjoiYW5vbiJ9.AAAAanonSignature0123456789`
  const service = `${head}.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.BBBBserviceSignature0123456789abcdef`
  await api('POST', `/api/bots/${bot.id}/secrets`, { name: 'service', sites: site, value: service, what: 'The service key' })
  await api('POST', `/api/bots/${bot.id}/secrets`, { name: 'anon', sites: site, value: anon, what: 'The public key' })
  const alike = await toolIn(id, 'web_fetch', { url: `http://${site}/echo?also={{secret:service}}`, headers: { Authorization: 'Bearer {{secret:anon}}' } })
  assert.ok(alike.includes('"authorization":"Bearer [secret: anon]"') && alike.includes('"also":"[secret: service]"'), alike)
  assert.ok(!alike.includes('Signature') && !alike.includes('eyJyb2xl'), alike)
  // Nor when one was kept with a word in front of it, so that another begins inside what looks like its beginning.
  await api('POST', `/api/bots/${bot.id}/secrets`, { name: 'with-word', sites: site, value: `Bearer ${head}.eyJvbGQiOnRydWV9.CCCColdSignature0123456789`, what: 'An older key, kept with its word' })
  const inside = await toolIn(id, 'web_fetch', { url: `http://${site}/echo`, headers: { Authorization: 'Bearer {{secret:anon}}' } })
  assert.ok(inside.includes('"authorization":"[secret: anon]"') && !inside.includes('Signature') && !inside.includes('eyJ'), inside)
  await api('DELETE', `/api/bots/${bot.id}/secrets/with-word`)
  await api('DELETE', `/api/bots/${bot.id}/secrets/service`)
  await api('DELETE', `/api/bots/${bot.id}/secrets/anon`)

  // A value its owner replaced meanwhile is still taken out of what comes back: it may be on its way, or in a page that is open.
  await api('POST', `/api/bots/${bot.id}/secrets`, { name: 'rotated', sites: site, value: 'old-value-before-rotation-01', what: 'A key that is replaced' })
  await toolIn(id, 'web_fetch', { url: `http://${site}/echo`, headers: { Authorization: 'Bearer {{secret:rotated}}' } })
  await api('PUT', `/api/bots/${bot.id}/secrets/rotated`, { value: 'new-value-after-rotation-02' })
  const late = await toolIn(id, 'web_fetch', { url: `http://${site}/echo?late=old-value-before-rotation-01&now={{secret:rotated}}` })
  assert.ok(late.includes('"late":"[secret: rotated]"') && late.includes('"now":"[secret: rotated]"'), late)
  await api('DELETE', `/api/bots/${bot.id}/secrets/rotated`)
  await api('POST', `/api/bots/${bot.id}/browser/stop`)
})

test('a value arrives whole however it is written: in JSON as JSON writes text, in a form as a form does', async () => {
  const quoted = 'pa"ss\\word & more=1+1'
  await api('POST', `/api/bots/${bot.id}/secrets`, { name: 'quoted', sites: site, value: quoted, what: 'A password with a quote in it' })
  seen.length = 0
  const json = await tool('web_fetch', { url: `http://${site}/echo`, method: 'POST', body: '{"user":"me","password":"{{secret:quoted}}"}' })
  assert.deepEqual(JSON.parse(seen[0].body), { user: 'me', password: quoted })
  assert.equal(seen[0].type, 'application/json')
  // What the service says back holds it as JSON holds it, and the bot reads its name there too.
  assert.ok(json.includes('"password\\":\\"[secret: quoted]\\"') && !json.includes('more=1+1'), json)
  seen.length = 0
  await tool('web_fetch', { url: `http://${site}/echo`, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'user=me&password={{secret:quoted}}&keep=1' })
  assert.deepEqual(Object.fromEntries(new URLSearchParams(seen[0].body)), { user: 'me', password: quoted, keep: '1' })
  // Anything else is sent as it was written, with the value as it is.
  seen.length = 0
  await tool('web_fetch', { url: `http://${site}/echo`, method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'the password is {{secret:quoted}}' })
  assert.equal(seen[0].body, `the password is ${quoted}`)
  assert.equal(inConversations('more=1+1'), 0)
  await api('DELETE', `/api/bots/${bot.id}/secrets/quoted`)
})

test('taking a value out of a conversation changes what was said, never what an item is, and reaches the conversation a subagent works for', async () => {
  // A password that is also a word the conversation is made of.
  const id = await fresh()
  await say(id, 'my old password is assistant')
  const items = await say(id, `!tool save_secret ${JSON.stringify({ name: 'weak', site, what: 'An old password', value: 'assistant' })}`)
  assert.deepEqual(
    items.filter((d) => d.type === 'message').map((d) => [d.role, d.text.slice(0, 24)]),
    [['user', 'my old password is [secr'], ['assistant', 'Echo: my old password is'], ['user', '!tool save_secret {"name'], ['assistant', 'Tool result: Kept as "we']],
  )
  assert.equal(items[1].text, 'Echo: my old password is [secret: weak]')
  assert.deepEqual(items.map((d) => d.type), ['message', 'message', 'message', 'function_call', 'function_call_output', 'message'])
  assert.deepEqual(await api('GET', `/api/bots/${bot.id}/secrets/weak/value`), { value: 'assistant' })
  await api('DELETE', `/api/bots/${bot.id}/secrets/weak`)

  // Further in, a text is a text whatever it is called: a key the bot sent as "key" in a request is taken out too.
  const sent = 'key_sentInARequest00aa11bb22'
  const calls = await fresh()
  await say(calls, `!tool web_fetch ${JSON.stringify({ url: `http://${site}/echo`, method: 'POST', headers: { key: sent }, body: JSON.stringify({ key: sent, name: sent }) })}`)
  assert.ok(inConversations(sent) > 0)
  const after = await say(calls, `!tool save_secret ${JSON.stringify({ name: 'sent', site, what: 'A key', value: sent })}`)
  assert.equal(inConversations(sent), 0)
  assert.deepEqual(JSON.parse(after.find((d) => d.type === 'function_call' && d.name === 'web_fetch').arguments).headers, { key: '[secret: sent]' })
  assert.deepEqual(after.filter((d) => d.type === 'function_call').map((d) => d.name), ['web_fetch', 'save_secret'], 'what the calls are stays')
  await api('DELETE', `/api/bots/${bot.id}/secrets/sent`)

  // Kept by a subagent, a value that was written in the conversation above it is taken out there too.
  const above = await fresh()
  const pasted = 'sub_pastedAbove00aa11bb22cc33dd'
  await say(above, `keep this for me: ${pasted}`)
  assert.ok(inConversations(pasted) > 0)
  await say(above, `!tool spawn_subagent ${JSON.stringify({ name: 'Keeper', task: `!tool save_secret ${JSON.stringify({ name: 'from-above', site, what: 'A key', value: pasted })}` })}`)
  const child = await until(async () => (await api('GET', '/api/state')).threads.find((t) => t.parentId === above && t.kind === 'subagent'))
  await settle(child.id)
  await settle(above)
  assert.equal(inConversations(pasted), 0)
  assert.equal(onDisk(pasted), null)
  // The conversation says that something in it was rewritten, for an app that held it from before.
  assert.ok((await api('GET', `/api/threads/${above}`)).thread.rewrites >= 1)
  assert.deepEqual(await api('GET', `/api/bots/${bot.id}/secrets/from-above/value`), { value: pasted })
  await api('DELETE', `/api/bots/${bot.id}/secrets/from-above`)
})

test('what is kept of a secret opens only as that bot’s secret of that name', async () => {
  // Read once, so that it is at hand.
  assert.deepEqual(await api('GET', `/api/bots/${bot.id}/secrets/plausible/value`), { value: KEY })
  // Copied by hand into another bot's vault, it is not that bot's to read.
  const other = await api('POST', '/api/bots', { name: 'Copier', provider: 'mock' })
  const from = path.join(dataOf(home), 'bots', bot.id, 'private', 'secrets.json')
  const to = path.join(dataOf(home), 'bots', other.id, 'private', 'secrets.json')
  const copied = JSON.parse(fs.readFileSync(from, 'utf8')).secrets.find((s) => s.name === 'plausible')
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.writeFileSync(to, JSON.stringify({ secrets: [copied] }), { mode: 0o600 })
  const [theirs] = (await api('GET', `/api/bots/${other.id}/secrets`)).secrets
  assert.match(theirs.problem, /could not be read/)
  assert.match((await call('GET', `/api/bots/${other.id}/secrets/plausible/value`)).json.error, /could not be read/)
  seen.length = 0
  assert.match(await tool('web_fetch', { url: `http://${site}/echo`, headers: { Authorization: 'Bearer {{secret:plausible}}' } }, other.id), /^Error: This secret could not be read/)
  assert.deepEqual(seen, [])
  await api('DELETE', `/api/bots/${other.id}`)
})

test('a key that is gone leaves its secrets unreadable, not lost, until they are entered again', async () => {
  const before = (await api('GET', `/api/bots/${bot.id}/secrets`)).secrets.map((s) => s.name)
  assert.deepEqual(before, ['plausible', 'service-key', 'github', 'signup'])
  // The data folder arrives on a computer that does not have the key: here, the key is taken away.
  await stop()
  const [keyFile] = fs.readdirSync(keys)
  const key = fs.readFileSync(path.join(keys, keyFile))
  fs.rmSync(path.join(keys, keyFile))
  await start()
  try {
    const { secrets } = await api('GET', `/api/bots/${bot.id}/secrets`)
    assert.deepEqual(secrets.map((s) => s.name), before, 'they are all still listed')
    for (const secret of secrets) assert.match(secret.problem, /The key this was encrypted with is not on this computer/)
    assert.match((await call('GET', `/api/bots/${bot.id}/secrets/plausible/value`)).json.error, /not on this computer/)
    assert.match(await tool('web_fetch', { url: `http://${site}/echo`, headers: { Authorization: 'Bearer {{secret:plausible}}' } }), /^Error: The key this was encrypted with is not on this computer/)

    // Entered again, one is kept with a new key; the others wait as they are.
    const again = await api('PUT', `/api/bots/${bot.id}/secrets/plausible`, { value: KEY })
    assert.equal(again.problem, undefined)
    assert.equal(fs.readdirSync(keys).length, 1)
    assert.notEqual(fs.readdirSync(keys)[0], keyFile)
    seen.length = 0
    await tool('web_fetch', { url: `http://${site}/echo`, headers: { Authorization: 'Bearer {{secret:plausible}}' } })
    assert.equal(seen[0].authorization, `Bearer ${KEY}`)
    assert.match((await api('GET', `/api/bots/${bot.id}/secrets`)).secrets.find((s) => s.name === 'github').problem, /not on this computer/)

    // The old key comes back (the keychain was restored too): what it encrypted is read again, beside what the new one did.
    await stop()
    fs.writeFileSync(path.join(keys, keyFile), key, { mode: 0o600 })
    await start()
    const all = (await api('GET', `/api/bots/${bot.id}/secrets`)).secrets
    assert.deepEqual(all.map((s) => s.problem), [undefined, undefined, undefined, undefined])
    assert.deepEqual(await api('GET', `/api/bots/${bot.id}/secrets/plausible/value`), { value: KEY })
    assert.match((await api('GET', `/api/bots/${bot.id}/secrets/github/value`)).value, /^ghp_/)
  } finally {
    if (!fs.existsSync(path.join(keys, keyFile))) fs.writeFileSync(path.join(keys, keyFile), key, { mode: 0o600 })
  }
})

test('the owner removes a secret, and only the computer that runs OpenKumi is shown one', async () => {
  await api('DELETE', `/api/bots/${bot.id}/secrets/signup`)
  assert.deepEqual((await api('GET', `/api/bots/${bot.id}/secrets`)).secrets.map((s) => s.name), ['plausible', 'service-key', 'github'])
  assert.match(await tool('web_fetch', { url: `http://${site}/echo`, headers: { 'X-Key': '{{secret:signup}}' } }), /^Error: You have no secret named "signup"\. Yours: plausible, service-key, github\./)

  // A computer that was paired looks after secrets like the owner's own, but is not sent a value.
  const { code } = await api('POST', '/api/pairing')
  const paired = await pair(code)
  const from = (method, url, body) => fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${paired}` }, body: body ? JSON.stringify(body) : undefined })
  assert.equal((await from('GET', `/api/bots/${bot.id}/secrets`)).status, 200)
  const refused = await from('GET', `/api/bots/${bot.id}/secrets/plausible/value`)
  assert.equal(refused.status, 403)
  assert.match((await refused.json()).error, /only shown on the computer running OpenKumi/)
})

/** Pairs a computer with the code its owner read out, as an app does, and gives the key it is handed. */
async function pair(code) {
  const post = async (url, body) => (await fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  const sign = (who, ours, theirs) => crypto.createHmac('sha256', code.replaceAll('-', '')).update(`${who}:${ours}:${theirs}`).digest('hex')
  const nonce = crypto.randomBytes(16).toString('hex')
  const begun = await post('/api/pair/begin', { nonce })
  const paired = await post('/api/pair/finish', { nonce, serverNonce: begun.nonce, proof: sign('computer', nonce, begun.nonce), name: 'Phone' })
  assert.ok(paired.key, 'paired')
  return paired.key
}
