// Gives every part of OpenKumi the same new version:
//
//   npm run bump 0.2.0
//
// The server, the desktop app and the iPhone app say this version, and the release is named
// after it. A release does this by itself (Actions > Release > Run workflow, see
// docs/development.md), so it is rarely run by hand.
//
// The iPhone app gets it too (apps/mobile/app.json): it is released with the rest (docs/mobile-releases.md).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const version = (process.argv[2] ?? '').replace(/^v/, '')
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Say which version, as three numbers: npm run bump 0.2.0')
  process.exit(1)
}

// Not the dictation package. It is native code the iPhone app is built with, and its version is
// part of the app's fingerprint: raised with every release, every release would need a new build
// through TestFlight instead of an update over the air. Its code is fingerprinted as it is anyway.
const NATIVE = [path.join('packages', 'dictation', 'package.json')]
const files = ['package.json', ...['apps', 'packages'].flatMap((dir) => fs.readdirSync(path.join(root, dir)).map((name) => path.join(dir, name, 'package.json')))].filter((file) => fs.existsSync(path.join(root, file)) && !NATIVE.includes(file))
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  // Only the package's own version, which is the first one in the file; the rest is left as it is written.
  fs.writeFileSync(path.join(root, file), text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`))
}
// The version the iPhone app shows, and the App Store with it.
const app = path.join(root, 'apps', 'mobile', 'app.json')
fs.writeFileSync(app, fs.readFileSync(app, 'utf8').replace(/("version":\s*")[^"]+(")/, `$1${version}$2`))

// The lock file names each of them too.
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })

console.log(`\n  Everything is at ${version}.\n`)
