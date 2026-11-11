// Runs the app for working on it: the interface comes from a Vite server, so a change to
// apps/web shows in the window at once. The app's own two programs are built first; after
// changing apps/desktop or apps/server, quit and run this again.
import { spawn } from 'node:child_process'
import path from 'node:path'
import electron from 'electron'

const here = path.resolve(import.meta.dirname, '..')
const port = Number(process.env.OPENBOT_DEV_PORT ?? 5173)
const url = `http://127.0.0.1:${port}`
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

await import('./build.mjs')

const vite = spawn(npm, ['run', 'dev', '-w', '@openbot/web'], { cwd: path.join(here, '..', '..'), stdio: 'inherit', env: { ...process.env, OPENBOT_DEV_PORT: String(port) } })
const stop = () => vite.kill('SIGTERM')
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

// The window asks for its page as soon as it opens, so Vite has to be answering by then.
for (let waited = 0; ; waited += 150) {
  if (await fetch(url).then((r) => r.ok, () => false)) break
  if (vite.exitCode !== null || waited > 30_000) {
    stop()
    throw new Error('The Vite server did not start.')
  }
  await new Promise((r) => setTimeout(r, 150))
}

const app = spawn(electron, ['.'], { cwd: here, stdio: 'inherit', env: { ...process.env, OPENBOT_DEV_URL: url } })
app.on('exit', (code) => {
  stop()
  process.exit(code ?? 0)
})
