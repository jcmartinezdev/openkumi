// The rules for where a key may go, on both sides: which connections the server answers at all,
// and how a device picks an address, and makes sure it is its server, before it sends its key.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import http from 'node:http'
import { test } from 'node:test'
import { nearby, onTailscale } from '../src/network.ts'
import { checkNew, deviceTag, kindOf, ordered, probe, reach, refusal, verdict, withFound } from '../../../packages/client/src/addresses.ts'

test('the server answers this computer, the local network and Tailscale, and nothing on the internet', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.0.0.4', '172.16.5.5', '172.31.255.1', '192.168.1.20', '::ffff:192.168.1.20', '169.254.10.1', '100.101.102.103', 'fd7a:115c:a1e0::1', 'fe80::1'])
    assert.equal(nearby(ip), true, ip)
  for (const ip of ['203.0.113.9', '8.8.8.8', '172.32.0.1', '100.128.0.1', '::ffff:8.8.8.8', '2001:db8::1']) assert.equal(nearby(ip), false, ip)
  assert.deepEqual(['100.64.0.1', '100.127.255.255', '100.63.0.1', 'fd7a:115c:a1e0::5'].map(onTailscale), [true, true, false, true])
})

test('addresses: what network each is on, which may be sent a key over plain http, and the order they are tried in', () => {
  assert.deepEqual(
    ['http://127.0.0.1:4317', 'http://192.168.1.20:4317', 'http://mac-mini.local:4317', 'http://mac-mini:4317', 'http://100.101.102.103:4317', 'http://mac.tail1234.ts.net:4317', 'https://bots.example.com', 'http://[fe80::1]:4317'].map(kindOf),
    ['this computer', 'home', 'home', 'home', 'tailscale', 'tailscale', 'internet', 'home'],
  )
  assert.equal(refusal('http://192.168.1.20:4317'), null)
  assert.equal(refusal('http://mac.tail1234.ts.net:4317'), null)
  assert.equal(refusal('https://bots.example.com'), null)
  assert.match(refusal('http://bots.example.com:4317'), /plain http would let others read this device’s key/)
  assert.match(refusal('http://203.0.113.9:4317'), /Use an https address/)

  // Home first, then Tailscale, then the rest; within each, the server's own before the typed ones.
  const saved = [{ url: 'https://bots.example.com' }, { url: 'http://mac.tail1234.ts.net:4317', found: true }, { url: 'http://192.168.1.9:4317' }, { url: 'http://192.168.1.20:4317', found: true }]
  assert.deepEqual(ordered(saved), ['http://192.168.1.20:4317', 'http://192.168.1.9:4317', 'http://mac.tail1234.ts.net:4317', 'https://bots.example.com'])

  // The server's own are replaced by what it reports now; typed ones stay. Only home and Tailscale addresses are taken from it.
  assert.deepEqual(withFound(saved, ['http://192.168.1.30:4317', 'http://192.168.1.9:4317', 'https://elsewhere.example', 'http://8.8.8.8:4317', 42]), [
    { url: 'https://bots.example.com' },
    { url: 'http://192.168.1.9:4317' },
    { url: 'http://192.168.1.30:4317', found: true },
  ])
  // A server that reports nothing does not take away the way to it.
  assert.deepEqual(withFound([{ url: 'http://127.0.0.1:5000', found: true }], []), [{ url: 'http://127.0.0.1:5000', found: true }])
})

test('a device asks who is at an address without sending its key, and only its server can answer', async () => {
  const key = 'the-key-this-device-was-given'
  const hash = crypto.createHash('sha256').update(key).digest('hex')
  const heard = []
  /** One port per way of answering: the server, something that only says it is, an old server, and so on. */
  const answer = {
    server: (q) => ({ app: 'openkumi', id: 's_mine', device: q.get('device') === deviceTag(key) ? { known: true, proof: crypto.createHmac('sha256', hash).update(`server:s_mine:${q.get('challenge')}`).digest('hex') } : { known: false } }),
    pretender: () => ({ app: 'openkumi', id: 's_mine', device: { known: true, proof: 'ab'.repeat(32) } }),
    another: () => ({ app: 'openkumi', id: 's_theirs', device: { known: false } }),
    removed: () => ({ app: 'openkumi', id: 's_mine', device: { known: false } }),
    older: () => ({ app: 'openkumi', version: '0.0.1', authorized: false }),
    stranger: () => ({ hello: 'world' }),
  }
  const servers = {}
  for (const [name, says] of Object.entries(answer)) {
    const server = http.createServer((req, res) => {
      heard.push(`${req.url} ${JSON.stringify(req.headers)}`)
      const q = new URL(req.url, 'http://x').searchParams
      // The server answers a beat late, so a faster one later in the list does not win.
      setTimeout(() => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(says(q))), name === 'server' ? 150 : 0)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    servers[name] = { server, url: `http://127.0.0.1:${server.address().port}` }
  }
  try {
    const at = (name) => servers[name].url
    const said = async (name, serverId) => (await probe(at(name), key, serverId)).answer
    assert.equal(await said('server'), 'ok')
    assert.equal((await probe(at('server'), key)).serverId, 's_mine')
    assert.equal(await said('pretender'), 'other', 'says it knows the device, but cannot sign with the key’s hash')
    assert.equal(await said('another', 's_mine'), 'other', 'another OpenKumi server')
    assert.equal(await said('removed', 's_mine'), 'refused')
    assert.equal(await said('older'), 'outdated')
    assert.equal(await said('stranger'), 'unreachable')
    assert.equal(await said('server', 's_someone_else'), 'other')
    assert.equal((await probe('http://127.0.0.1:1', key)).answer, 'unreachable')
    assert.equal((await probe('http://203.0.113.9:4317', key)).answer, 'blocked', 'never asked at all')

    // The first address, in order, where the server answers wins, even when one after it answers sooner.
    const { found, answers } = await reach([at('pretender'), at('server'), at('another')], key, 's_mine')
    assert.equal(found.url, at('server'))
    assert.deepEqual(answers.map((a) => a.answer), ['other', 'ok'])
    assert.equal(verdict(answers), 'connected')
    assert.equal(verdict((await reach([at('removed'), at('stranger')], key, 's_mine')).answers), 'refused')

    // Adding an address: kept when it is the server or nothing answers yet, refused, with the reason, otherwise.
    assert.deepEqual(await checkNew(at('server'), key, { name: 'Mac mini', serverId: 's_mine' }), { checked: true, serverId: 's_mine' })
    assert.deepEqual(await checkNew('http://127.0.0.1:1', key, { name: 'Mac mini', serverId: 's_mine' }), { checked: false, serverId: undefined })
    await assert.rejects(checkNew(at('another'), key, { name: 'Mac mini', serverId: 's_mine' }), /Something else answers at .*, not Mac mini\. Its key was not sent there\./)
    await assert.rejects(checkNew(at('removed'), key, { name: 'Mac mini', serverId: 's_mine' }), /no longer lets this device in/)
    await assert.rejects(checkNew('http://bots.example.com:4317', key, { name: 'Mac mini' }), /Use an https address/)

    // Through all of it, the key itself never left this device, nor its hash.
    assert.ok(heard.length > 10)
    assert.ok(!heard.some((line) => line.includes(key) || line.includes(hash)))
  } finally {
    for (const { server } of Object.values(servers)) server.close()
  }
})
