// Makes the installable app (release/). Pass --dir to stop at the unpacked app, which is quicker.
// Build first (npm run build at the top does both the interface and the app's own programs).
//
// What goes into it:
//   the app's own programs (dist/), packed
//   Resources/web      the interface, built (apps/web/dist)
//   Resources/server   the server as it is in apps/server (sources, superpowers, registrations, principles), with the packages it needs to run
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { build } from 'electron-builder'

const here = path.resolve(import.meta.dirname, '..')
const root = path.resolve(here, '..', '..')
const release = path.join(root, 'release')
const stage = path.join(release, 'stage')
const web = path.join(root, 'apps', 'web', 'dist')
if (!fs.existsSync(path.join(web, 'index.html')) || !fs.existsSync(path.join(here, 'dist', 'main.cjs'))) throw new Error('Nothing to package yet. Run "npm run build" first.')

// The server is not bundled: it runs from its sources, beside the packages it uses. Those are
// copied from this repository's node_modules, so what is shipped is what was tested.
fs.rmSync(stage, { recursive: true, force: true })
const server = path.join(stage, 'server')
for (const part of ['src', 'superpowers', 'registrations', 'principles.md', 'package.json']) fs.cpSync(path.join(root, 'apps', 'server', part), path.join(server, part), { recursive: true })
const modules = path.join(root, 'node_modules')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const needed = execFileSync(npm, ['ls', '--omit=dev', '--all', '--parseable', '-w', '@openkumi/server'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((dir) => dir.startsWith(modules + path.sep) && !dir.startsWith(path.join(modules, '@openkumi') + path.sep))
// Kept apart from the server until the app is put together: the packager leaves out any folder
// called node_modules that it is asked to copy.
const packages = path.join(stage, 'packages')
for (const dir of new Set(needed)) fs.cpSync(dir, path.join(packages, path.relative(modules, dir)), { recursive: true })

const icon = 'assets/icon.png'
await build({
  projectDir: here,
  dir: process.argv.includes('--dir'),
  config: {
    appId: 'ai.openkumi.desktop',
    productName: 'OpenKumi',
    // Electron is installed at the top of the repository, where the packager does not look.
    electronVersion: JSON.parse(fs.readFileSync(path.join(modules, 'electron', 'package.json'), 'utf8')).version,
    directories: { output: release, buildResources: 'assets' },
    files: ['dist/**', 'package.json'],
    extraResources: [
      { from: web, to: 'web' },
      { from: server, to: 'server' },
    ],
    // Nothing here is compiled for a particular machine.
    npmRebuild: false,
    // The way back from a superpower's sign-in in the computer's own browser (see src/main.ts).
    protocols: [{ name: 'OpenKumi sign-in', schemes: ['openkumi'] }],
    // Runs once the app is put together and before it is signed.
    afterPack: ({ appOutDir, packager }) => {
      const resources = packager.platform.name === 'mac' ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : path.join(appOutDir, 'resources')
      fs.cpSync(packages, path.join(resources, 'server', 'node_modules'), { recursive: true })
    },
    mac: { target: ['dmg'], category: 'public.app-category.productivity', icon },
    win: { target: ['nsis'], icon },
    linux: { target: ['AppImage'], icon, category: 'Utility' },
  },
})
fs.rmSync(stage, { recursive: true, force: true })
