// Gives every part of OpenKumi the same new version, ready to be released:
//
//   npm run bump 0.2.0
//
// The server and the desktop app say this version, and the release is named after it. Then commit,
// tag and push, which is what makes the release (.github/workflows/release.yml):
//
//   git commit -am "Release 0.2.0" && git tag v0.2.0 && git push --follow-tags
//
// The iPhone app's version is its own (apps/mobile/app.json): it is released through the App Store.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const version = (process.argv[2] ?? '').replace(/^v/, '')
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Say which version, as three numbers: npm run bump 0.2.0')
  process.exit(1)
}

const files = ['package.json', ...['apps', 'packages'].flatMap((dir) => fs.readdirSync(path.join(root, dir)).map((name) => path.join(dir, name, 'package.json')))].filter((file) => fs.existsSync(path.join(root, file)))
for (const file of files) {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  // Only the package's own version, which is the first one in the file; the rest is left as it is written.
  fs.writeFileSync(path.join(root, file), text.replace(/("version":\s*")[^"]+(")/, `$1${version}$2`))
}
// The lock file names each of them too.
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })

console.log(`\n  Everything is at ${version}. To release it:\n`)
console.log(`    git commit -am "Release ${version}" && git tag v${version} && git push --follow-tags\n`)
