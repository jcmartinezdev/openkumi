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
// Several servers can be started from one folder of versions: the owner's, and one for each
// person given a server of their own on this computer (people.ts). Any of them may fetch a new
// version, two of them at once too, and the others start it when they notice it is in place. Each
// leaves a note of the version it runs, so that it is not tidied away from under it.
//
// A server inside the desktop app is updated with the app, and one run from the repository with
// git: both only say so.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
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

/** How this server runs: inside the desktop app, installed on its own, or from the repository. */
export const HOW: ServerUpdate['how'] = (process as { parentPort?: unknown }).parentPort ? 'app' : RUNTIME ? 'installed' : 'source'

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

export const updateInfo = (): ServerUpdate => ({ how: HOW, ...state, staged: staged(), working: working() })

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
/** Whether a version's folder holds a whole version. One is put in place in a single step, so anything less was cut short. */
const whole = (dir: string) => fs.existsSync(path.join(dir, 'server', 'package.json'))

/** Whether a process is still there. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    // Not ours to signal, but there.
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** What this server works on while it fetches a version is named after its process, so that two servers fetching at once do not write over each other. */
const MINE = `${process.pid}-`
/** Whether a file or folder of that kind is another server's, which is still at it. */
function theirs(name: string): boolean {
  const pid = Number(/^\.?(\d+)-/.exec(name)?.[1])
  return !!pid && pid !== process.pid && alive(pid)
}

/** Fetches a version, checks it and unpacks it beside the others. Does nothing when it is already there. */
async function fetchVersion({ version, archives }: Manifest) {
  const dir = versionDir(version)
  if (whole(dir)) return
  const archive = archives[TARGET]
  if (!archive || !/^[\w.-]+$/.test(archive.file) || !/^[0-9a-f]{64}$/.test(archive.sha256)) throw new Error(`OpenKumi ${version} was not published for this kind of computer (${TARGET}).`)
  const downloads = path.join(RUNTIME, 'downloads')
  fs.mkdirSync(downloads, { recursive: true })
  const file = path.join(downloads, MINE + archive.file)
  // Read whole, then written: some tens of megabytes held for a moment. Passing it on piece by
  // piece as it arrives makes Node 24 fall over, taking the server with it, when the other end
  // closes the connection while a piece is still waiting to be taken.
  const bytes = await fetch(`${RELEASES}/download/v${version}/${archive.file}`)
    .then(async (res) => (res.ok ? Buffer.from(await res.arrayBuffer()) : null))
    .catch(() => null)
  if (!bytes) throw new Error(`OpenKumi ${version} could not be downloaded.`)
  // The checksum comes from the release's own list, so a download that was cut short or changed on the way is not unpacked.
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== archive.sha256) throw new Error(`The download of OpenKumi ${version} is not the file that was published. Nothing was changed.`)
  fs.writeFileSync(file, bytes)
  const unpacked = path.join(RUNTIME, 'versions', `.${MINE}${version}.unpacking`)
  fs.rmSync(unpacked, { recursive: true, force: true })
  fs.mkdirSync(unpacked, { recursive: true })
  try {
    await run('tar', ['-xzf', file, '-C', unpacked])
    // Tried once before anything points at it: its Node has to run here, and its program has to load.
    const said = await run(path.join(unpacked, 'node'), [path.join(unpacked, 'server', 'src', 'cli.ts'), 'version'])
    if (said.trim() !== version) throw new Error(`it says it is “${said.trim().slice(0, 40)}”`)
    try {
      fs.renameSync(unpacked, dir)
    } catch {
      // Refused because something is there. A whole version: another server put the same one in
      // place meanwhile, and that one is it. Anything less was left by something cut short.
      if (!whole(dir)) {
        fs.rmSync(dir, { recursive: true, force: true })
        fs.renameSync(unpacked, dir)
      }
    }
  } catch (e) {
    throw new Error(`OpenKumi ${version} was downloaded but does not run on this computer: ${(e as Error).message}. Nothing was changed.`)
  } finally {
    fs.rmSync(unpacked, { recursive: true, force: true })
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

/**
 * Points `current` at a version, in one step: a start that happens meanwhile gets the old one or
 * the new one, never neither. Not back from a newer one, which another server put there meanwhile.
 */
function pointAt(version: string) {
  const now = currentVersion()
  if (now && newer(now, version)) return
  const link = path.join(RUNTIME, 'current')
  const next = path.join(RUNTIME, `.${MINE}current`)
  fs.rmSync(next, { force: true })
  fs.symlinkSync(path.join('versions', version), next)
  fs.renameSync(next, link)
}

/** Where each server started from this folder of versions leaves a note, named by its process, of the version it runs. */
const running = () => path.join(RUNTIME, 'running')

/** The versions that servers started from this folder are running right now. Notes left by servers that are gone are thrown away. */
function inUse(): string[] {
  const versions: string[] = []
  for (const pid of list(running())) {
    const note = path.join(running(), pid)
    try {
      if (alive(Number(pid))) versions.push(fs.readFileSync(note, 'utf8').trim())
      else fs.rmSync(note, { force: true })
    } catch {
      // Gone since it was listed.
    }
  }
  return versions
}

const list = (dir: string) => {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * Removes the versions from before this one that no server is running and that is not started
 * next, and what was left of fetching one. A newer version is never removed here: another server
 * may be putting it in place at this moment, between unpacking it and pointing `current` at it.
 */
function tidy() {
  const keep = new Set([VERSION, currentVersion(), ...inUse()])
  try {
    for (const name of list(path.join(RUNTIME, 'versions'))) if (!keep.has(name) && !theirs(name) && !newer(name, VERSION)) fs.rmSync(path.join(RUNTIME, 'versions', name), { recursive: true, force: true })
    for (const name of list(path.join(RUNTIME, 'downloads'))) if (!theirs(name)) fs.rmSync(path.join(RUNTIME, 'downloads', name), { recursive: true, force: true })
  } catch {
    // Nothing to tidy.
  }
}

let busy: Promise<ServerUpdate> | null = null

/** The newer version that is in place and only waits to be started (`current` points at it), or null. */
function staged(): string | null {
  const next = currentVersion()
  return next && newer(next, VERSION) ? next : null
}

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
      if (!wanted || !install || HOW !== 'installed') return set({ state: staged() ? 'ready' : 'idle' })
      set({ state: 'downloading' })
      await fetchVersion(release)
      pointAt(release.version)
      set({ state: 'ready' })
    } catch (e) {
      // A look that failed takes nothing away from a version that is already in place: it still
      // starts once the bots are done. What went wrong is kept, since it may be a still newer
      // version that could not be fetched.
      set({ state: staged() ? 'ready' : 'failed', error: (e as Error).message })
    }
  })()
    .then(() => updateInfo())
    .finally(() => (busy = null))
  return busy
}

/** Starts the new version, once it is in place and nothing would be cut off by that (or it was asked not to wait). */
function settle() {
  if (state.state !== 'ready' || !restart || (working() > 0 && !hurried)) return
  console.log(`  Starting OpenKumi ${staged() ?? state.latest} in place of ${VERSION}.`)
  restart()
  restart = null
}

/** What POST /api/update does: fetch the newest version now, and start it at once (`now`) or when the bots are done. */
export async function updateNow(now: boolean): Promise<ServerUpdate> {
  if (HOW !== 'installed') throw new Error(WHY_NOT[HOW])
  // A look that is under way may be one that only looks: this one is made after it, so that
  // being asked to install always installs.
  while (busy) await busy.catch(() => {})
  const info = await update(true)
  // "Do not wait for the bots" holds for the version this request put in place, and for no other:
  // one that failed, or found nothing, leaves nothing behind for a later request to inherit.
  hurried = info.state === 'ready' && (hurried || now)
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
  if (HOW !== 'installed') return
  restart = server.restart
  const note = path.join(running(), String(process.pid))
  fs.mkdirSync(running(), { recursive: true })
  fs.writeFileSync(note, VERSION)
  process.on('exit', () => fs.rmSync(note, { force: true }))
  tidy()
  const look = () => void update(settings().autoUpdate)
  setTimeout(look, 30_000).unref()
  setInterval(look, 6 * HOUR).unref()
  // The moment a bot is done is when the new version can start; the timer is for whatever that misses.
  onEvent((event) => event.type === 'thread.upsert' && state.state === 'ready' && void setTimeout(settle, 500))
  setInterval(() => {
    // Another server started from the same folder of versions may have put a new one in place: this one starts it too.
    if ((state.state === 'idle' || state.state === 'failed') && staged()) set({ state: 'ready' })
    settle()
  }, 15_000).unref()
}
