// The app keeping itself up to date. It looks at the project's releases when it starts and every
// few hours, downloads a newer version in the background, and tells the window when it is ready.
// The new version takes this one's place when the app quits, or at once when the person says so:
// never by itself while the app is open, since quitting stops the bots that run on this computer.
//
// Only an installed app does this. On a Mac the system swaps the app in, which it only does for a
// signed one. On Linux only the AppImage can replace itself.
import { app, autoUpdater as system } from 'electron'
import electronUpdater from 'electron-updater'
import type { AppUpdate } from '@openkumi/shared/desktop'

const { autoUpdater } = electronUpdater

/** Another place to look for versions: tests, and a release being tried before it is published. */
const FEED = process.env.OPENKUMI_DESKTOP_UPDATES_URL || ''

const able = FEED ? true : app.isPackaged && (process.platform !== 'linux' || !!process.env.APPIMAGE)

let update: AppUpdate = { state: able ? 'none' : 'unsupported', version: null, progress: 0, error: '', checkedAt: 0 }

/** How the app stands with its own updates right now. */
export const updateState = () => update

const listeners: (() => void)[] = []
/** `fn` is called whenever there is something new to tell: the window, and the servers this app runs. */
export function onUpdateChange(fn: () => void) {
  listeners.push(fn)
}
function set(patch: Partial<AppUpdate>) {
  update = { ...update, ...patch }
  for (const fn of listeners) fn()
}

/** What went wrong, in a line, without the pages of detail the updater adds. */
const reason = (e: Error) => {
  const text = String(e?.message ?? e).split('\n')[0]
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|ETIMEDOUT|ECONNRE|ERR_NETWORK|ERR_NAME_NOT_RESOLVED/.test(text)) return 'The newest version could not be looked up. Is this computer online?'
  if (/404|Cannot find .*\.yml|No published versions/.test(text)) return 'No newer version has been published yet.'
  return text.slice(0, 300)
}

if (able) {
  autoUpdater.autoDownload = true
  // Quitting the app is the one moment nothing is cut off by swapping it.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null
  if (FEED) {
    autoUpdater.forceDevUpdateConfig = true
    autoUpdater.setFeedURL({ provider: 'generic', url: FEED })
  }
  autoUpdater.on('checking-for-update', () => set({ state: update.state === 'ready' ? 'ready' : 'checking', error: '' }))
  autoUpdater.on('update-not-available', () => set({ state: update.state === 'ready' ? 'ready' : 'none', checkedAt: Date.now() }))
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, progress: 0, checkedAt: Date.now() }))
  autoUpdater.on('download-progress', (progress) => set({ state: 'downloading', progress: Math.round(progress.percent) }))
  // On a Mac this comes before the system's own updater has taken the download and checked its
  // signature, and only once it has can the app restart into it: until then it is still downloading.
  const mac = process.platform === 'darwin'
  autoUpdater.on('update-downloaded', (info) => set(mac ? { version: info.version, progress: 100 } : { state: 'ready', version: info.version, progress: 100 }))
  if (mac) system.on('update-downloaded', () => set({ state: 'ready', progress: 100 }))
  // A version that is already downloaded stays ready, whatever a later look runs into.
  autoUpdater.on('error', (e) => update.state !== 'ready' && set({ state: 'failed', error: reason(e) }))
  if (mac) system.on('error', (e) => update.state !== 'ready' && set({ state: 'failed', error: reason(e) }))
}

/** Looks for a newer version now. What it finds reaches the window through `onUpdateChange`. */
export async function checkForUpdate() {
  if (!able || update.state === 'checking' || update.state === 'downloading') return
  await autoUpdater.checkForUpdates().catch(() => {})
}

/** Looks now, and again every few hours for as long as the app is open. */
export function startUpdates() {
  if (!able) return
  // Not in the app's first seconds, which belong to getting the window and the bots up.
  setTimeout(() => void checkForUpdate(), 8000)
  setInterval(() => void checkForUpdate(), 4 * 3_600_000)
}

/** Quits and opens the downloaded version. Whatever has to be stopped cleanly is stopped before this is called. */
export function installUpdate() {
  if (update.state !== 'ready') return
  autoUpdater.quitAndInstall(true, true)
}
