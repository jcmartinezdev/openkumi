// Puts the server together as it is shipped: its sources as they are in apps/server (they are
// not bundled; Node runs the TypeScript as it is), its superpowers and master prompt, and the
// packages it needs to run. Those are copied from this repository's node_modules, so what is
// shipped is what was tested. Nothing in it is compiled for a particular computer, so the same
// folder goes into the desktop app (apps/desktop/scripts/dist.mjs) and into every server archive
// (archive.mjs).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const modules = path.join(ROOT, 'node_modules')

/** Copies the server's own files into `dir`. */
export function stageServer(dir) {
  for (const part of ['src', 'superpowers', 'master-prompt.md', 'package.json']) fs.cpSync(path.join(ROOT, 'apps', 'server', part), path.join(dir, part), { recursive: true })
  fs.cpSync(path.join(ROOT, 'LICENSE'), path.join(dir, 'LICENSE'))
}

/** Copies the packages the server needs to run into `dir`, which becomes its node_modules. */
export function stagePackages(dir) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const needed = execFileSync(npm, ['ls', '--omit=dev', '--all', '--parseable', '-w', '@openkumi/server'], { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' })
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(modules + path.sep) && !line.startsWith(path.join(modules, '@openkumi') + path.sep))
  if (!needed.length) throw new Error('The server’s packages were not found. Run "npm install" first.')
  for (const from of new Set(needed)) fs.cpSync(from, path.join(dir, path.relative(modules, from)), { recursive: true })
}
