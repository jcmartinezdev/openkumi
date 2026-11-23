// Run from the repository, to work on OpenKumi, the server keeps to places of its own: its data in
// ~/.openkumi-dev and port 4417, where an installed OpenKumi has ~/.openkumi and 4317. Nor does it
// look after a background service: the ones on the computer are the installed OpenKumi's.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

/** Every file under `dir` with what it holds, to see that nothing there changed. */
const contents = (dir) => Object.fromEntries(fs.readdirSync(dir, { recursive: true }).sort().map((name) => [name, fs.statSync(path.join(dir, name)).isFile() ? fs.readFileSync(path.join(dir, name), 'utf8') : '']))

test('run from the repository, OpenKumi keeps to a folder and a port of its own, and leaves an installed one’s data and service alone', () => {
  // A home folder of its own, with what an installed OpenKumi keeps in one: its data, the folder
  // from when it was called Open Bot, and the background service of its person, Ana.
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-repository-'))
  const service = process.platform === 'darwin' ? path.join(user, 'Library', 'LaunchAgents', 'ai.openkumi.server.ana.plist') : path.join(user, '.config', 'systemd', 'user', 'openkumi-ana.service')
  fs.mkdirSync(path.join(user, '.openkumi', 'people', 'ana', 'bots'), { recursive: true })
  fs.writeFileSync(path.join(user, '.openkumi', 'people.json'), JSON.stringify([{ name: 'ana', port: 4317 }]))
  fs.writeFileSync(path.join(user, '.openkumi', 'people', 'ana', 'auth.json'), JSON.stringify({ accessToken: 'installed' }))
  fs.mkdirSync(path.join(user, '.openbot'))
  fs.writeFileSync(path.join(user, '.openbot', 'auth.json'), JSON.stringify({ accessToken: 'from-before' }))
  fs.mkdirSync(path.dirname(service), { recursive: true })
  fs.writeFileSync(service, 'the installed OpenKumi’s')
  const installed = () => [contents(path.join(user, '.openkumi')), contents(path.join(user, '.openbot')), fs.readFileSync(service, 'utf8')]
  const before = installed()
  // What looks after services on this computer is stood in for: whatever asks it is written down,
  // and nothing reaches the computer's own services, should one of them be called Ana.
  const bin = path.join(user, 'bin')
  const asked = path.join(user, 'asked')
  fs.mkdirSync(bin)
  for (const program of ['launchctl', 'systemctl']) fs.writeFileSync(path.join(bin, program), `#!/bin/sh\necho "${program} $*" >> "${asked}"\nexit 1\n`, { mode: 0o755 })

  // Nothing says where its data is: not a test's server, which is told, nor an installed one.
  const { OPENKUMI_HOME, OPENKUMI_PORT, OPENKUMI_HOOKS_PORT, OPENKUMI_RUNTIME, ...rest } = process.env
  const env = { ...rest, HOME: user, PATH: `${bin}${path.delimiter}${rest.PATH}`, NODE_TEST_CONTEXT: '', OPENKUMI_NAME: 'Ana', OPENKUMI_MOCK: '1' }
  const openkumi = (more, ...args) => spawnSync(process.execPath, ['src/cli.ts', ...args], { env: { ...env, ...more }, encoding: 'utf8' })
  try {
    const listed = openkumi({}, 'people')
    assert.equal(listed.status, 0, listed.stderr)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(user, '.openkumi-dev', 'people.json'), 'utf8')), [{ name: 'ana', port: 4417 }])
    assert.ok(fs.existsSync(path.join(user, '.openkumi-dev', 'people', 'ana', 'bots')), 'her data folder from the repository is one of its own')

    // On a port nothing else here has from now on: one from the repository may well be running on 4417.
    const port = { OPENKUMI_PORT: String(6000 + Math.floor(Math.random() * 100) * 2) }
    assert.match(openkumi(port, 'people').stdout, /ana +port \d+ +not running/, 'her server has no service, though the installed Ana’s has one')
    // Ana here has the name of the installed OpenKumi's Ana, whose service that is. It is not this one's to look after.
    const refused = openkumi(port, 'service', 'remove')
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /Run from the repository, OpenKumi has no background service/)
    // Renaming a person stops their service first, when they have one. From here, she has none.
    const renamed = openkumi(port, 'people', 'rename', 'ana', 'ana-dev')
    assert.equal(renamed.status, 0, renamed.stderr)
    assert.ok(fs.existsSync(path.join(user, '.openkumi-dev', 'people', 'ana-dev', 'bots')))

    assert.deepEqual(installed(), before, 'the installed OpenKumi’s data, its folder from before and its service are as they were')
    assert.ok(!fs.existsSync(asked), `nothing was asked of the computer's services: ${fs.existsSync(asked) ? fs.readFileSync(asked, 'utf8') : ''}`)
  } finally {
    fs.rmSync(user, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
})
