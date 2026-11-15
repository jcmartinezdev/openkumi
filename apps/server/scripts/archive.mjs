// Makes the server as it is installed on its own (release/server/): one archive for each kind of
// computer, holding the server, the openkumi command and the Node it runs with, so the computer
// it goes to needs neither Node nor npm. Beside them, what the installer and a running server
// read to find and check them: SHA256SUMS and openkumi-server.json.
//
//   node apps/server/scripts/archive.mjs                 every kind
//   node apps/server/scripts/archive.mjs darwin-arm64    only these
//
// The server's own folder is the same in each; only Node differs. Node is fetched from
// nodejs.org and checked against the checksums published with it, so every archive can be made on
// one computer of any kind.
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, stagePackages, stageServer } from './stage.mjs'

/** The Node the server is shipped with: the line the desktop app's own Node is on, where the server is tested. */
const NODE = '24.22.3'
/** What is published, by Node's name for each: its `process.platform`-`process.arch` to Node's download. */
const TARGETS = { 'darwin-arm64': 'darwin-arm64', 'linux-x64': 'linux-x64', 'linux-arm64': 'linux-arm64' }

const wanted = process.argv.slice(2)
for (const target of wanted) if (!TARGETS[target]) throw new Error(`There is no server archive for "${target}". The kinds are: ${Object.keys(TARGETS).join(', ')}.`)
const targets = wanted.length ? wanted : Object.keys(TARGETS)

const out = path.join(ROOT, 'release', 'server')
const work = path.join(out, 'work')
const cache = path.join(ROOT, 'release', 'node')
fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(work, { recursive: true })
fs.mkdirSync(cache, { recursive: true })

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'server', 'package.json'), 'utf8')).version
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

async function download(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

const sums = (await download(`https://nodejs.org/dist/v${NODE}/SHASUMS256.txt`)).toString()

/** The `node` program for a kind of computer, taken from Node's own download. Kept between runs. */
async function nodeFor(target) {
  const name = `node-v${NODE}-${TARGETS[target]}`
  const kept = path.join(cache, `${name}.bin`)
  if (fs.existsSync(kept)) return kept
  const expected = sums.split('\n').find((line) => line.endsWith(`  ${name}.tar.gz`))?.split(' ')[0]
  if (!expected) throw new Error(`Node ${NODE} has no download for ${target}.`)
  const archive = path.join(cache, `${name}.tar.gz`)
  fs.writeFileSync(archive, await download(`https://nodejs.org/dist/v${NODE}/${name}.tar.gz`))
  if (sha256(archive) !== expected) throw new Error(`The download of ${name} is not the file Node published.`)
  execFileSync('tar', ['-xzf', archive, '-C', cache, `${name}/bin/node`, `${name}/LICENSE`])
  fs.renameSync(path.join(cache, name, 'bin', 'node'), kept)
  fs.renameSync(path.join(cache, name, 'LICENSE'), `${kept}.LICENSE`)
  fs.rmSync(path.join(cache, name), { recursive: true })
  fs.rmSync(archive)
  return kept
}

// The part that is the same for every kind of computer.
const server = path.join(work, 'server')
stageServer(server)
stagePackages(path.join(server, 'node_modules'))
fs.mkdirSync(path.join(work, 'bin'))
fs.copyFileSync(path.join(ROOT, 'apps', 'server', 'bin', 'openkumi'), path.join(work, 'bin', 'openkumi'))
fs.chmodSync(path.join(work, 'bin', 'openkumi'), 0o755)
fs.writeFileSync(path.join(work, 'VERSION'), `${version}\n`)

const archives = {}
for (const target of targets) {
  const node = await nodeFor(target)
  fs.copyFileSync(node, path.join(work, 'node'))
  fs.chmodSync(path.join(work, 'node'), 0o755)
  fs.copyFileSync(`${node}.LICENSE`, path.join(work, 'NODE-LICENSE'))
  const file = `openkumi-server-${target}.tar.gz`
  // Made by root, of nobody in particular: whoever unpacks it owns what comes out.
  execFileSync('tar', ['-czf', path.join(out, file), ...(process.platform === 'darwin' ? ['--no-xattrs', '--no-mac-metadata', '--uid', '0', '--gid', '0'] : ['--owner=0', '--group=0']), '-C', work, 'VERSION', 'NODE-LICENSE', 'node', 'bin', 'server'], {
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  archives[target] = { file, sha256: sha256(path.join(out, file)) }
  console.log(`  release/server/${file}  ${(fs.statSync(path.join(out, file)).size / 1e6).toFixed(1)} MB`)
}
fs.rmSync(work, { recursive: true })

// What a running server reads to find its next version (apps/server/src/update.ts), and what the installer checks its download against.
fs.writeFileSync(path.join(out, 'openkumi-server.json'), JSON.stringify({ version, node: NODE, archives }, null, 2) + '\n')
fs.writeFileSync(path.join(out, 'SHA256SUMS'), Object.values(archives).map(({ file, sha256 }) => `${sha256}  ${file}\n`).join(''))
