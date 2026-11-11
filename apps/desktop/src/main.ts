// The desktop app. Its work is split over separate processes and threads, so that none of it can
// hold up another part:
//   - this process: the window, the menu, the list of environments. It does no work of its own.
//   - the local environment (local.ts): Open Bot's server, in a process of its own.
//   - the window (apps/web): the interface, loaded from the app itself, talking straight to the
//     environment it shows; its connection and the drawing of a bot's browser run on a worker thread.
import { BrowserWindow, Menu, type MenuItemConstructorOptions, app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { DesktopState, Link } from '@openbot/shared/desktop'
import os from 'node:os'
import { pair, parseAddress } from '@openbot/client/pair'
import { config, find, nameOf, save, showing, statuses, turnedOn } from './environments.ts'
import { local, onLocalChange, retryLocal, startLocal, stopLocal } from './local.ts'
import { ASSUME_YES, HIDDEN, PRELOAD } from './paths.ts'
import { APP_URL, keepPage, serveInterface } from './protocol.ts'

let win: BrowserWindow | null = null

// ---- what the window is told

/** How the window reaches the environment it shows, once there is something to reach. */
function connection(): Link | null {
  const id = showing()
  if (id === 'local') return local.state === 'running' ? { id, name: nameOf(id), url: `http://127.0.0.1:${local.port}`, token: local.token, local: true } : null
  const environment = find(id)
  return environment ? { id: environment.id, name: environment.name, url: environment.url, token: environment.token, local: false } : null
}

function state(): DesktopState {
  return {
    version: app.getVersion(),
    platform: process.platform,
    fullScreen: !!win?.isFullScreen(),
    local: { enabled: config.local.enabled, state: config.local.enabled ? local.state : 'off', error: local.error, startedHere: !!local.child },
    environments: config.environments.map(({ id, name, url, enabled }) => ({ id, name, url, enabled })),
    current: showing(),
    connection: connection(),
  }
}

/** Tells the window how things stand now. Called after anything changes. */
function announce() {
  buildMenu()
  if (win && !win.isDestroyed()) win.webContents.send('desktop:state', state())
}

onLocalChange(announce)

/** Saves a change to the environments and tells the window. */
function changed() {
  save()
  announce()
}

// ---- changes to the environments

function open(id: string) {
  if (!turnedOn().includes(id)) return
  config.current = id
  changed()
}

/** Asks the person at the computer, in a dialog of the app itself. */
async function confirmed(message: string, detail: string, action: string) {
  if (ASSUME_YES || !win) return true
  const { response } = await dialog.showMessageBox(win, { type: 'question', buttons: [action, 'Cancel'], defaultId: 0, cancelId: 1, message, detail })
  return response === 0
}

/** Turns the local environment on (the server runs on this computer) or off (it does not). */
async function setLocal(on: boolean) {
  if (on) {
    config.local.enabled = true
    changed()
    await startLocal()
    return
  }
  if (!config.local.enabled) return
  const detail = local.child
    ? 'Open Bot on this computer stops, and so do the bots that live here, until you turn it on again. Nothing is deleted.'
    : 'This app stops using Open Bot on this computer. It was started outside this app, so it keeps running.'
  if (!(await confirmed('Turn off the local environment?', detail, 'Turn Off'))) return
  config.local.enabled = false
  changed()
  await stopLocal()
}

async function add(input: { address?: unknown; code?: unknown; name?: unknown }) {
  const url = parseAddress(input?.address)
  const token = await pair(url, input?.code, os.hostname().replace(/\.local$/, ''))
  const listed = config.environments.find((e) => e.url === url)
  const name = String(input?.name ?? '').trim().slice(0, 60) || listed?.name || new URL(url).hostname
  // Pairing again with a computer that is already listed replaces the key it gave before.
  const id = listed?.id ?? `remote-${Date.now().toString(36)}`
  config.environments = [...config.environments.filter((e) => e.id !== id), { id, name, url, token, enabled: true }]
  // With nothing else to look at, the new environment is shown at once.
  if (!showing()) config.current = id
  changed()
}

function update(id: string, patch: { name?: unknown; enabled?: unknown }) {
  const environment = find(id)
  if (!environment) return
  if (typeof patch?.name === 'string' && patch.name.trim()) environment.name = patch.name.trim().slice(0, 60)
  if (typeof patch?.enabled === 'boolean') environment.enabled = patch.enabled
  changed()
}

async function remove(id: string) {
  const environment = find(id)
  if (!environment || !(await confirmed(`Remove “${environment.name}”?`, 'This app forgets the environment and the key it was given. Nothing on that computer is deleted.', 'Remove'))) return
  config.environments = config.environments.filter((e) => e.id !== id)
  changed()
}

// ---- what the window may ask for (see preload.ts)
// Only the app's own page is answered: it is the one page that is given access codes.

const fromApp = (event: { senderFrame: { url: string } | null }) => !!event.senderFrame?.url.startsWith(APP_URL)

function answer(channel: string, handler: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromApp(event)) throw new Error('Not allowed.')
    return handler(...args)
  })
}

ipcMain.on('desktop:initial', (event) => (event.returnValue = fromApp(event) ? state() : null))
answer('desktop:statuses', () => statuses())
answer('desktop:open', (id) => open(String(id)))
answer('desktop:set-local', (on) => setLocal(!!on))
answer('desktop:retry', () => retryLocal())
answer('desktop:add', (input) => add(input))
answer('desktop:update', (id, patch) => update(String(id), patch))
answer('desktop:remove', (id) => remove(String(id)))
answer('desktop:page', (html) => {
  if (typeof html !== 'string' || html.length > 8_000_000) throw new Error('Not a page.')
  return keepPage(html)
})

// ---- the window

function createWindow() {
  const mac = process.platform === 'darwin'
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 400,
    minHeight: 560,
    title: 'Open Bot',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0c0c0d' : '#ffffff',
    show: false,
    // On a Mac the interface runs to the top of the window, with the window's buttons over it.
    ...(mac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 17 } } : {}),
    // A window that is not on the screen (tests) would otherwise be slowed down.
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: !HIDDEN },
  })
  const created = win
  if (!HIDDEN) created.once('ready-to-show', () => created.show())
  created.on('closed', () => {
    if (win === created) win = null
  })
  created.on('enter-full-screen', announce)
  created.on('leave-full-screen', announce)

  const pages = created.webContents
  // The window only ever shows the app's own page. Links go to the computer's browser.
  const outside = (url: string) => void (/^https?:/.test(url) && shell.openExternal(url))
  pages.on('will-navigate', (event, url) => {
    if (url.startsWith(APP_URL)) return
    event.preventDefault()
    outside(url)
  })
  pages.setWindowOpenHandler(({ url }) => {
    outside(url)
    return { action: 'deny' }
  })
  // Copying to the clipboard is all the interface asks for. Pages in it get nothing.
  pages.session.setPermissionRequestHandler((contents, permission, allow, details) =>
    allow(contents === pages && permission === 'clipboard-sanitized-write' && 'requestingUrl' in details && details.requestingUrl.startsWith(APP_URL)),
  )
  void created.loadURL(APP_URL)
}

/** Sends the window to a page of its settings. */
const goTo = (page: string) => void win?.webContents.executeJavaScript(`location.hash = '/settings/${page}'`).catch(() => {})

function buildMenu() {
  const mac = process.platform === 'darwin'
  const settings: MenuItemConstructorOptions = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => goTo('general') }
  const appMenu: MenuItemConstructorOptions[] = mac
    ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, settings, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }]
    : []
  const environments: MenuItemConstructorOptions[] = turnedOn().map((id) => ({ label: nameOf(id), type: 'radio', checked: id === config.current, click: () => open(id) }))
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...appMenu,
      {
        label: 'Environment',
        submenu: [...environments, ...(environments.length ? [{ type: 'separator' } as const] : []), { label: 'Manage Environments…', click: () => goTo('environments') }, ...(mac ? [] : [{ type: 'separator' } as const, settings])],
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  )
}

// ---- the app

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (win?.isMinimized()) win.restore()
    win?.focus()
  })
  void app.whenReady().then(() => {
    // Tests run the app without a window, so it should not sit in the Dock either.
    if (HIDDEN) app.dock?.hide()
    serveInterface()
    buildMenu()
    // The local environment runs whenever it is turned on, whichever environment the window shows.
    // It starts alongside the window, not after it; the window is told when it is ready.
    if (config.local.enabled) void startLocal().catch(() => {})
    createWindow()
    app.on('activate', () => {
      if (!win) createWindow()
    })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  // The server this app started ends with it; bots that are still working are stopped cleanly.
  let stopped = false
  app.on('before-quit', (event) => {
    if (stopped || !local.child) return
    event.preventDefault()
    void stopLocal().then(() => {
      stopped = true
      app.quit()
    })
  })
}
