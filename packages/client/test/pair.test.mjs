// How a typed address is read: plain http only on this computer and the home network, https anywhere else.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { build } from 'esbuild'

test('an address typed without http:// or https:// is https unless it is at home', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-pair-'))
  const bundle = path.join(dir, 'pair.mjs')
  await build({ entryPoints: [path.join(import.meta.dirname, '../src/pair.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'warning' })
  const { parseAddress } = await import(bundle)
  fs.rmSync(dir, { recursive: true, force: true })

  // At home, and on this computer: plain http, on OpenKumi's port unless another is given.
  assert.equal(parseAddress('192.168.1.20'), 'http://192.168.1.20:4317')
  assert.equal(parseAddress('mac-mini.local:5000'), 'http://mac-mini.local:5000')
  assert.equal(parseAddress('localhost'), 'http://localhost:4317')
  // Tailscale and anywhere else: https, on its usual port.
  assert.equal(parseAddress('mac-mini.tail1234.ts.net'), 'https://mac-mini.tail1234.ts.net')
  assert.equal(parseAddress('100.101.102.103:8443'), 'https://100.101.102.103:8443')
  assert.equal(parseAddress('bots.example.com'), 'https://bots.example.com')
  // What was typed is kept; whether a key may go there is decided elsewhere (see addresses.ts).
  assert.equal(parseAddress('http://mac-mini.tail1234.ts.net'), 'http://mac-mini.tail1234.ts.net:4317')
  assert.equal(parseAddress('HTTPS://192.168.1.20'), 'https://192.168.1.20')
})
