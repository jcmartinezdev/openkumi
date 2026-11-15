// How a server gets a new version of itself.
//
// A server installed on its own (openkumi.ai/install.sh) lives in a folder of versions:
//   <runtime>/versions/<version>/   node, bin/openkumi, server/ (this program)
//   <runtime>/current               a link to the version that is started
// A new version is fetched from the release it was published in, checked against the release's
// own list of checksums, unpacked beside the others and tried once. Then `current` is pointed at
// it, which changes nothing for the server that is running, and the server stops with a code that
// tells whatever runs it (the background service, or `openkumi start`) to start it again: that
// start is the new version. It waits for that until no bot is working, unless it is told not to.
//
// A server inside the desktop app is updated with the app, and one run from the repository with
// git: both only say so.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ServerUpdate } from '@openkumi/shared'
import { VERSION, emit, onEvent } from './config.ts'
import { settings } from './settings.ts'

export { VERSION }

/** The folder of versions this server was started from, when it was installed on its own (set by bin/openkumi). */
export const RUNTIME = process.env.OPENKUMI_RUNTIME || ''
/** Where releases are published. Tests, and a release being tried before it is published, name another place. */
const RELEASES = (process.env.OPENKUMI_RELEASES_URL || 'https://github.com/jcmartinezdev/openkumi/releases').replace(/\/+$/, '')
/** The code the server ends with when it wants to be started again (EX_TEMPFAIL). */
export const RESTART = 75

/** Which of the published archives runs on this computer. */
export const TARGET = `${process.platform}-${process.arch}`

const how: ServerUpdate['how'] = (process as { parentPort?: unknown }).parentPort ? 'app' : RUNTIME ? 'installed' : 'source'

/** Why a server that cannot update itself cannot. */
export const WHY_NOT: Record<Exclude<ServerUpdate['how'], 'installed'>, string> = {
  app: 'This OpenKumi runs inside the desktop app on that computer, and is updated with the app.',
  source: 'This OpenKumi runs from its source. Update it there with “git pull” and “npm install”, then start it again.',
}

let state: Pick<ServerUpdate, 'latest' | 'state' | 'error' | 'checkedAt'> = { latest: null, state: 'idle', error: '', checkedAt: 0 }
/** How many threads are at work; given by the server once it runs (the command line has none). */
let working = () => 0
/** Stops the server so that it is started again; given by the server once it runs. */
let restart: (() => void) | null = null
/** Asked to update without waiting for the bots. */
let hurried = false

export const updateInfo = (): ServerUpdate => ({ how, ...state, working: working() })

function set(patch: Partial<typeof state>) {
  state = { ...state, ...patch }
  emit({ type: 'update', update: updateInfo() })
}

/** What a release says about its server: the version, and the archive for each kind of computer. */
interface Manifest {
  version: string
  archives: Record<string, { file: string; sha256: string }>
}

/** Whether version `a` comes after `b`. Only plain x.y.z versions are published. */
export function newer(a: string, b: string): boolean {
  const parts = (v: string) => v.split('-')[0].split('.').map((n) => Number(n) || 0)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  return false
}

async function latestRelease(): Promise<Manifest> {
  const res = await fetch(`${RELEASES}/latest/download/openkumi-server.json`, { signal: AbortSignal.timeout(20_000) }).catch(() => null)
  if (!res?.ok) throw new Error(res?.status === 404 ? 'No version of OpenKumi has been published yet.' : 'The newest version could not be looked up. Is this computer online?')
  const said = await res.json().catch(() => null)
  if (typeof said?.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(said.version) || typeof said.archives !== 'object') throw new Error('The newest version could not be read.')
  return said
}

const versionDir = (version: string) => path.join(RUNTIME, 'versions', version)

/** Fetches a version, checks it and unpacks it beside the others. Does nothing when it is already there. */
async function fetchVersion({ version, archives }: Manifest) {
  const dir = versionDir(version)
  if (fs.existsSync(path.join(dir, 'server', 'package.json'))) return
  const archive = archives[TARGET]
  if (!archive || !/^[\w.-]+$/.test(archive.file) || !/^[0-9a-f]{64}$/.test(archive.sha256)) throw new Error(`OpenKumi ${version} was not published for this kind of computer (${TARGET}).`)
  const downloads = path.join(RUNTIME, 'downloads')
  fs.mkdirSync(downloads, { recursive: true })
  const file = path.join(downloads, archive.file)
  const res = await fetch(`${RELEASES}/download/v${version}/${archive.file}`).catch(() => null)
  if (!res?.ok || !res.body) throw new Error(`OpenKumi ${version} could not be downloaded.`)
  const hash = crypto.createHash('sha256')
  await pipeline(
    Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
    async function* (chunks) {
      for await (const chunk of chunks) {
        hash.update(chunk)
        yield chunk
      }
    },
    fs.createWriteStream(file),
  )
  // The checksum comes from the release's own list, so a download that was cut short or changed on the way is not unpacked.
  if (hash.digest('hex') !== archive.sha256) {
    fs.rmSync(file, { force: true })
    throw new Error(`The download of OpenKumi ${version} is not the file that was published. Nothing was changed.`)
  }
  const unpacked = path.join(RUNTIME, 'versions', `.${version}.unpacking`)
  fs.rmSync(unpacked, { recursive: true, force: true })
  fs.mkdirSync(unpacked, { recursive: true })
  try {
    await run('tar', ['-xzf', file, '-C', unpacked])
    // Tried once before anything points at it: its Node has to run here, and its program has to load.
    const said = await run(path.join(unpacked, 'node'), [path.join(unpacked, 'server', 'src', 'cli.ts'), 'version'])
    if (said.trim() !== version) throw new Error(`it says it is “${said.trim().slice(0, 40)}”`)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.renameSync(unpacked, dir)
  } catch (e) {
    fs.rmSync(unpacked, { recursive: true, force: true })
    throw new Error(`OpenKumi ${version} was downloaded but does not run on this computer: ${(e as Error).message}. Nothing was changed.`)
  } finally {
    fs.rmSync(file, { force: true })
  }
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (err += chunk))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim().split('\n').pop() || `${path.basename(command)} ended with ${code}`))))
  })
}

/** The version that is started next: what `current` points at. */
export function currentVersion(): string | null {
  try {
    return path.basename(fs.readlinkSync(path.join(RUNTIME, 'current')))
  } catch {
    return null
  }
}

/** Points `current` at a version, in one step: a start that happens meanwhile gets the old one or the new one, never neither. */
function pointAt(version: string) {
  const link = path.join(RUNTIME, 'current')
  const next = `${link}.next`
  fs.rmSync(next, { force: true })
  fs.symlinkSync(path.join('versions', version), next)
  fs.renameSync(next, link)
}

/** Removes the versions that are neither running nor started next. */
function tidy() {
  const keep = new Set([VERSION, currentVersion()])
  try {
    for (const name of fs.readdirSync(path.join(RUNTIME, 'versions'))) if (!keep.has(name)) fs.rmSync(path.join(RUNTIME, 'versions', name), { recursive: true, force: true })
    fs.rmSync(path.join(RUNTIME, 'downloads'), { recursive: true, force: true })
  } catch {
    // Nothing to tidy.
  }
}

let busy: Promise<ServerUpdate> | null = null

/**
 * Looks up the newest version and, with `install`, puts it in place when it is newer than this
 * one. Nothing is started again here: see `settle`. Two calls at once share one piece of work.
 */
export function update(install: boolean): Promise<ServerUpdate> {
  busy ??= (async () => {
    try {
      set({ state: 'checking', error: '' })
      const release = await latestRelease()
      set({ latest: release.version, checkedAt: Date.now() })
      const wanted = newer(release.version, VERSION)
      if (!wanted || !install || how !== 'installed') return set({ state: wanted && currentVersion() === release.version ? 'ready' : 'idle' })
      set({ state: 'downloading' })
      await fetchVersion(release)
      pointAt(release.version)
      set({ state: 'ready' })
    } catch (e) {
      set({ state: 'failed', error: (e as Error).message })
    }
  })()
    .then(() => updateInfo())
    .finally(() => (busy = null))
  return busy
}

/** Starts the new version, once it is in place and nothing would be cut off by that (or it was asked not to wait). */
function settle() {
  if (state.state !== 'ready' || !restart || (working() > 0 && !hurried)) return
  console.log(`  Starting OpenKumi ${state.latest} in place of ${VERSION}.`)
  restart()
  restart = null
}

/** What POST /api/update does: fetch the newest version now, and start it at once (`now`) or when the bots are done. */
export async function updateNow(now: boolean): Promise<ServerUpdate> {
  if (how !== 'installed') throw new Error(WHY_NOT[how])
  hurried ||= now
  const info = await update(true)
  // The answer goes out first; the server it came from is gone a moment later.
  setTimeout(settle, 300)
  return info
}

const HOUR = 3_600_000

/**
 * Called once the server runs. From then on it looks for a new version now and then, fetches it
 * when the owner left that switched on, and starts it when no bot is working.
 */
export function startUpdates(server: { working: () => number; restart: () => void }) {
  working = server.working
  if (how !== 'installed') return
  restart = server.restart
  tidy()
  const look = () => void update(settings().autoUpdate)
  setTimeout(look, 30_000).unref()
  setInterval(look, 6 * HOUR).unref()
  // The moment a bot is done is when the new version can start; the timer is for whatever that misses.
  onEvent((event) => event.type === 'thread.upsert' && state.state === 'ready' && void setTimeout(settle, 500))
  setInterval(settle, 15_000).unref()
}
