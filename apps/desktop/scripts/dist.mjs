// Makes the installable app (release/). Pass --dir to stop at the unpacked app, which is quicker.
// Build first (npm run build at the top does both the interface and the app's own programs).
// It is made for the processor of this computer; --arch=x64,arm64 makes it for those instead
// (nothing in it is compiled here but the dictation program on a Mac, which is released for
// Apple silicon only).
//
// Beside each installer comes what an installed app reads to update itself (latest*.yml, and on
// a Mac a .zip of the app): the release workflow uploads all of it to the release, which is where
// the app looks (src/updates.ts). Nothing is uploaded from here.
//
// On a Mac the app is signed with the Developer ID certificate in the keychain (or CSC_LINK), and
// notarized when APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER say with which key. Without
// those it is still built, but macOS will not open it on another computer, nor update it.
//
// What goes into it:
//   the app's own programs (dist/), packed
//   Resources/dictation  on a Mac, the program that takes dictation, which has to be outside the archive to run
//   Resources/web      the interface, built (apps/web/dist)
//   Resources/server   the server as it is in apps/server (sources, superpowers, master prompt), with the packages it needs to run
import fs from 'node:fs'
import path from 'node:path'
import { Arch, build } from 'electron-builder'
import { stagePackages, stageServer } from '../../server/scripts/stage.mjs'

const here = path.resolve(import.meta.dirname, '..')
const root = path.resolve(here, '..', '..')
const release = path.join(root, 'release')
const stage = path.join(release, 'stage')
const web = path.join(root, 'apps', 'web', 'dist')
if (!fs.existsSync(path.join(web, 'index.html')) || !fs.existsSync(path.join(here, 'dist', 'main.cjs'))) throw new Error('Nothing to package yet. Run "npm run build" first.')

// The server goes in as it is in apps/server, beside the packages it uses (see stage.mjs).
fs.rmSync(stage, { recursive: true, force: true })
const server = path.join(stage, 'server')
stageServer(server)
// Kept apart from the server until the app is put together: the packager leaves out any folder
// called node_modules that it is asked to copy.
const packages = path.join(stage, 'packages')
stagePackages(packages)

const modules = path.join(root, 'node_modules')
const asked = process.argv.find((arg) => arg.startsWith('--arch='))?.slice(7).split(',')
const archs = (asked ?? [process.arch]).map((name) => {
  if (!(name in Arch)) throw new Error(`"${name}" is not a processor the app is made for. Use arm64 or x64.`)
  return name
})
/** Every installer is named for what it runs on and not for its version, so a link to the newest one never changes. */
const artifactName = 'OpenKumi-${os}-${arch}.${ext}'

const icon = 'assets/icon.png'
await build({
  projectDir: here,
  dir: process.argv.includes('--dir'),
  config: {
    appId: 'ai.openkumi.desktop',
    productName: 'OpenKumi',
    artifactName,
    // Where an installed app looks for a newer version: this project's releases.
    publish: [{ provider: 'github', owner: 'jcmartinezdev', repo: 'openkumi' }],
    // Electron is installed at the top of the repository, where the packager does not look.
    electronVersion: JSON.parse(fs.readFileSync(path.join(modules, 'electron', 'package.json'), 'utf8')).version,
    directories: { output: release, buildResources: 'assets' },
    files: ['dist/**', '!dist/dictation', 'package.json'],
    extraResources: [
      { from: web, to: 'web' },
      { from: server, to: 'server' },
      ...(fs.existsSync(path.join(here, 'dist', 'dictation')) ? [{ from: 'dist/dictation', to: 'dictation' }] : []),
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
    mac: {
      // The .dmg is what people download; the .zip is what an installed app updates itself from.
      target: [{ target: 'dmg', arch: archs }, { target: 'zip', arch: archs }],
      category: 'public.app-category.productivity',
      icon,
      // Dictation listens with the microphone (src/dictation.ts). A signed app has to say it may.
      extendInfo: { NSMicrophoneUsageDescription: 'OpenKumi listens while you dictate a message to a bot. What you say is written down on this Mac and never leaves it as sound.' },
      entitlements: 'assets/entitlements.mac.plist',
      entitlementsInherit: 'assets/entitlements.mac.plist',
      // With no certificate to sign with (a rehearsal on a build machine), it is signed by nobody
      // in particular: enough for it to open where it was built, which an unsigned app does not.
      ...(process.env.OPENKUMI_UNSIGNED ? { identity: '-' } : {}),
    },
    win: { target: [{ target: 'nsis', arch: archs }], icon },
    // The program inside is named by hand: the name made from the package's (@openkumi/desktop) is not one a file may have.
    linux: { target: [{ target: 'AppImage', arch: archs }], icon, category: 'Utility', executableName: 'openkumi' },
  },
  publish: 'never',
})
fs.rmSync(stage, { recursive: true, force: true })
