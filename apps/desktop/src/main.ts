// The desktop app. Its work is split over separate processes and threads, so that none of it can
// hold up another part:
//   - this process: the window, the menu, the list of environments. It does no work of its own.
//   - the local environment (local.ts): OpenKumi's server, in a process of its own.
//   - the window (apps/web): the interface, loaded from the app itself, talking straight to the
//     environment it shows; its connection and the drawing of a bot's browser run on a worker thread.
import { BrowserWindow, Menu, type MenuItemConstructorOptions, app, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { DesktopState, Link } from '@openkumi/shared/desktop'
import { shownName } from '@openkumi/shared/people'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkNew, ordered, refusal, withFound } from '@openkumi/client/addresses'
import { pair, parseAddress } from '@openkumi/client/pair'
import { canDictate, cancelDictation, microphone, openMicrophoneSettings, startDictation, stopDictation } from './dictation.ts'
import { askToUpdate, config, find, nameOf, save, showing, statuses, turnedOn } from './environments.ts'
import { local, managing, me, onLocalChange, peopleHere, retryLocal, serverOf, startLocal, stopLocal } from './local.ts'
import { ASSUME_YES, CATCH_SIGN_INS, FAKE_MICROPHONE, HIDDEN, PRELOAD } from './paths.ts'
import { addPerson, people, removePerson, renamePerson, workingHere } from './people.ts'
import { APP_URL, keepPage, serveInterface } from './protocol.ts'
import { checkForUpdate, installUpdate, onUpdateChange, startUpdates, updateState } from './updates.ts'

let win: BrowserWindow | null = null

// ---- sign-ins in this computer's own browser
// A superpower's sign-in can happen in the browser on this computer, where the person's accounts
// already are. The service then sends that browser back to an openkumi:// address, which the
// computer opens with this app, and the app hands it to the window to pass on to its environment.

/** The way back from a sign-in (the server's APP_RETURN, apps/server/src/mcp.ts). Nothing else opened with this app is acted on. */
const SIGN_IN_RETURN = 'openkumi://sign-in/callback?'
/** This app is what the computer opens that address with. Only an installed app can be. */
let catchesSignIns = CATCH_SIGN_INS
/** A way back that arrived before the window could take it. */
let waitingReturn: string | null = null

function signInReturned(url: string) {
  if (!url.startsWith(SIGN_IN_RETURN)) return
  if (win && !win.isDestroyed() && !win.webContents.isLoading()) win.webContents.send('desktop:sign-in', url)
  else waitingReturn = url
  // The person was in their browser; they carry on here.
  if (win?.isMinimized()) win.restore()
  win?.show()
  app.focus({ steal: true })
}

// ---- whose bots the window shows on this computer
// Each person here has a server of their own (local.ts). The window shows one of them at a time:
// the first person's, which is the local environment's own server, or someone else's, picked at the
// top of the settings or of the sidebar. Anyone at this computer can pick anyone here; their data
// is this computer user's to read in any case.

/**
 * The person picked while they are being renamed: the window waits for their server under the new
 * name, rather than showing the first person's bots meanwhile.
 */
let renaming: string | null = null

/** Whose bots the window shows on this computer: the one picked while they still have bots here, else the first person's. */
function picked(): string {
  const chosen = config.local.person
  return chosen && (chosen === renaming || peopleHere().some((p) => p.name === chosen)) ? chosen : me()
}

/** The server of the person picked, when that is not the first person: found once it has shown it is theirs. */
let theirs: { name: string; port: number; token: string } | null = null
/** Counts the looks for it, so that only the newest one's answer is kept. */
let looks = 0
let lookAgain: ReturnType<typeof setTimeout> | undefined

/** Looks for the server of the person picked, and tells the window. Asked again by itself while it does not answer. */
async function findTheirs() {
  const look = ++looks
  clearTimeout(lookAgain)
  const who = local.state === 'running' ? picked() : ''
  const found = who && who !== me() ? await serverOf(who) : null
  if (look !== looks) return
  const before = JSON.stringify(theirs)
  theirs = found && { name: who, ...found }
  if (JSON.stringify(theirs) !== before) announce()
  // Their server may be starting, or may come back: the window waits for it meanwhile.
  if (who && who !== me() && !found && config.current === 'local') lookAgain = setTimeout(() => void findTheirs(), 3000)
}

// ---- what the window is told

/** How the window reaches the environment it shows, once there is something to reach. */
function connection(): Link | null {
  const id = showing()
  if (id === 'local') {
    if (local.state !== 'running') return null
    const who = picked()
    // A server from before people had names has no list of them.
    const person = peopleHere().length ? who : undefined
    if (who === me()) return { id, name: nameOf(id), addresses: [`http://127.0.0.1:${local.port}`], token: local.token, local: true, person }
    return theirs?.name === who ? { id, name: nameOf(id), addresses: [`http://127.0.0.1:${theirs.port}`], token: theirs.token, local: true, person } : null
  }
  const environment = find(id)
  return environment ? { id: environment.id, name: environment.name, addresses: ordered(environment.addresses), token: environment.token, local: false, serverId: environment.serverId } : null
}

/**
 * What the first person here would be called, while nobody has bots on this computer yet: the
 * name of their account on it, made to fit. Undefined once someone has.
 */
function nobodyYet(): string | undefined {
  if (fs.existsSync(path.join(process.env.OPENKUMI_HOME ?? path.join(os.homedir(), '.openkumi'), 'people.json'))) return undefined
  let name = ''
  try {
    name = os.userInfo().username.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '')
  } catch {
    // An account without a name.
  }
  return name || 'me'
}

/** Who has bots on this computer, whose the window shows, and who came first: known while the local environment runs. */
function whoIsHere(): { people?: string[]; person?: string; first?: string } {
  const everyone = config.local.enabled && local.state === 'running' ? peopleHere().map((p) => p.name) : []
  return everyone.length ? { people: everyone, person: picked(), first: me() } : {}
}

function state(): DesktopState {
  return {
    version: app.getVersion(),
    update: updateState(),
    platform: process.platform,
    fullScreen: !!win?.isFullScreen(),
    local: { enabled: config.local.enabled, state: config.local.enabled ? local.state : 'off', error: local.error, startedHere: !!local.child, nobodyYet: local.state === 'running' ? undefined : nobodyYet(), ...whoIsHere() },
    environments: config.environments.map(({ id, name, addresses, enabled, person }) => ({ id, name, addresses, enabled, person })),
    current: showing(),
    connection: connection(),
    catchesSignIns,
  }
}

/** Tells the window how things stand now. Called after anything changes. */
function announce() {
  buildMenu()
  if (win && !win.isDestroyed()) win.webContents.send('desktop:state', state())
}

// The person picked may be found, or lost, with any change to the servers here.
onLocalChange(() => (announce(), void findTheirs()))
onUpdateChange(announce)

/** Saves a change to the environments and tells the window. */
function changed() {
  save()
  announce()
}

// ---- changes to the environments

function open(id: string, person?: unknown) {
  if (!turnedOn().includes(id)) return
  config.current = id
  if (id === 'local' && typeof person === 'string' && peopleHere().some((p) => p.name === person)) config.local.person = person === me() ? undefined : person
  changed()
  if (id === 'local') void findTheirs()
}

/** Shows the bots of someone who was just added: the next thing is to pair their devices, or set up their bots. */
async function addSomeone(name: unknown) {
  const before = peopleHere().map((p) => p.name)
  const now = await addPerson(name)
  const added = now.find((p) => !before.includes(p.name))
  if (added) open('local', added.name)
  return now
}

/** Another name for someone here. When the window shows their bots, it goes on showing them under the new name. */
async function renameSomeone(name: unknown, to: unknown) {
  const before = peopleHere().map((p) => p.name)
  if (typeof name === 'string' && config.local.person === name) renaming = name
  let now
  try {
    now = await renamePerson(name, to)
  } finally {
    renaming = null
  }
  const renamed = now.find((p) => !before.includes(p.name))
  if (renamed && config.local.person === name) {
    config.local.person = renamed.name
    changed()
    void findTheirs()
  }
  return now
}

/** Takes someone off this computer, once the person at it has said so. The window goes back to the first person's bots if it showed theirs. */
async function removeSomeone(name: unknown) {
  if (!(await confirmed(`Remove ${shownName(String(name))}?`, 'Their server stops, and the computers and phones paired with it lose it. What it held is kept on this computer.', 'Remove'))) return people()
  const now = await removePerson(name)
  if (config.local.person === name) {
    config.local.person = undefined
    changed()
    void findTheirs()
  }
  return now
}

/**
 * Looks again at the server the window shows on this computer. Someone else's is not started from
 * here: it may be stopped on purpose, for another name, and two servers must never share a folder.
 */
async function retry() {
  await retryLocal()
  await findTheirs()
}

/** Asks the person at the computer, in a dialog of the app itself. */
async function confirmed(message: string, detail: string, action: string) {
  if (ASSUME_YES || !win) return true
  const { response } = await dialog.showMessageBox(win, { type: 'question', buttons: [action, 'Cancel'], defaultId: 0, cancelId: 1, message, detail })
  return response === 0
}

/**
 * Turns the local environment on (the server runs on this computer) or off (it does not). `name`
 * is what the first person here is called, when this start makes them.
 */
async function setLocal(on: boolean, name = '') {
  if (on) {
    config.local.enabled = true
    changed()
    await startLocal(name)
    return
  }
  if (!config.local.enabled) return
  const detail = local.child
    ? 'OpenKumi on this computer stops, and so do the bots that live here, until you turn it on again. Nothing is deleted.'
    : 'This app stops using OpenKumi on this computer. It was started outside this app, so it keeps running.'
  if (!(await confirmed('Turn off the local environment?', detail, 'Turn Off'))) return
  config.local.enabled = false
  changed()
  await stopLocal()
}

async function add(input: { address?: unknown; code?: unknown; name?: unknown }) {
  const url = parseAddress(input?.address)
  const refused = refusal(url)
  if (refused) throw new Error(refused)
  // Listed there by this computer's name, without the network's part ("mac-mini", not "mac-mini.fritz.box").
  const { key, serverId, called } = await pair(url, input?.code, os.hostname().split('.')[0] || 'Computer')
  // Pairing again with a computer that is already listed replaces the key it gave before, and the
  // address is added to the ones it had. An older server has no id: then it is known by the address.
  const listed =
    (serverId && config.environments.find((e) => e.serverId === serverId)) || config.environments.find((e) => !e.serverId && e.addresses.some((a) => a.url === url))
  // Called what the person typed, or what it was called before, or what the server says it is: the computer it is on, and whose it is there.
  const name = String(input?.name ?? '').trim().slice(0, 60) || listed?.name || called || new URL(url).hostname
  const id = listed?.id ?? `remote-${Date.now().toString(36)}`
  const addresses = listed?.addresses.some((a) => a.url === url) ? listed.addresses : [...(listed?.addresses ?? []), { url }]
  config.environments = [...config.environments.filter((e) => e.id !== id), { id, name, addresses, token: key, enabled: true, serverId: serverId ?? listed?.serverId }]
  // With nothing else to look at, the new environment is shown at once.
  if (!showing()) config.current = id
  changed()
}

// ---- an environment's addresses
// Who gets an environment's key is decided by who shows they are its server, not by an address:
// one can be added, or taken away, at any time. An address is only kept once whatever answers
// there has shown it is the environment (or nothing answers yet), and only ever sent the key after.

async function addAddress(id: string, address: unknown) {
  const environment = find(id)
  if (!environment) throw new Error('That environment is not here any more.')
  const url = parseAddress(address)
  if (environment.addresses.some((a) => a.url === url)) return { checked: true }
  const { checked, serverId } = await checkNew(url, environment.token, environment)
  environment.serverId ??= serverId
  environment.addresses = [...environment.addresses, { url }]
  changed()
  return { checked }
}

function removeAddress(id: string, url: string) {
  const environment = find(id)
  if (!environment) return
  const typed = environment.addresses.find((a) => a.url === url && !a.found)
  // The server's own come back by themselves while it reports them.
  if (!typed) throw new Error('That address is one the other computer reports itself, so it stays while it has it.')
  if (environment.addresses.length === 1) throw new Error('This is its only address. Add another first, or remove the environment.')
  environment.addresses = environment.addresses.filter((a) => a !== typed)
  changed()
}

/** What the window learned about an environment: its server's id, the addresses the server reports, and whose bots it holds. */
function learn(id: string, learned: { serverId?: unknown; addresses?: unknown; person?: unknown }) {
  const environment = find(id)
  if (!environment) return
  const before = JSON.stringify(environment)
  if (typeof learned?.serverId === 'string') environment.serverId ??= learned.serverId
  // A name as people have one on a computer: small letters, digits and dashes.
  if (typeof learned?.person === 'string' && /^[a-z0-9][a-z0-9-]{0,29}$/.test(learned.person)) environment.person = learned.person
  if (Array.isArray(learned?.addresses)) environment.addresses = withFound(environment.addresses, learned.addresses)
  if (JSON.stringify(environment) !== before) changed()
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

/** Asks a remote environment that runs an older OpenKumi to update itself. */
async function updateEnvironment(id: string) {
  const environment = find(id)
  if (!environment) throw new Error('That environment is not here any more.')
  return askToUpdate(environment)
}

/** The server this app started is stopped (see the end of this file). */
let stopped = false

/**
 * Puts the downloaded version of the app in place and opens it. Quitting stops the server this
 * app runs, and the bots at work in it, whichever environment the window happens to show: so the
 * person is asked first when there are any, and the server is stopped cleanly, so their work is saved.
 */
async function restartForUpdate() {
  if (updateState().state !== 'ready') return
  const working = await workingHere()
  const asked = working === null ? 'Bots may be working on this computer.' : working ? `${working === 1 ? '1 bot is' : `${working} bots are`} working on this computer.` : ''
  if (asked && !(await confirmed(asked, 'Restarting stops them. What they have done so far is kept.', 'Restart'))) return
  if (managing()) await stopLocal()
  // A look for updates that ran meanwhile may have found a still newer version, which is being
  // fetched now: there is nothing to install yet, so the server is started again and the app stays.
  if (updateState().state !== 'ready') {
    if (config.local.enabled) void startLocal().catch(() => {})
    return
  }
  stopped = true
  installUpdate()
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
answer('desktop:open', (id, person) => open(String(id), person))
answer('desktop:set-local', (on, name) => setLocal(!!on, typeof name === 'string' ? name.slice(0, 60) : ''))
// The people with bots on this computer (people.ts): asked of the app, never of a server over the network.
answer('desktop:people-add', (name) => addSomeone(name))
answer('desktop:people-rename', (name, to) => renameSomeone(name, to))
answer('desktop:people-remove', (name) => removeSomeone(name))
answer('desktop:retry', () => retry())
answer('desktop:add', (input) => add(input))
answer('desktop:update', (id, patch) => update(String(id), patch))
answer('desktop:remove', (id) => remove(String(id)))
answer('desktop:add-address', (id, address) => addAddress(String(id), address))
answer('desktop:remove-address', (id, url) => removeAddress(String(id), String(url)))
answer('desktop:learn', (id, learned) => learn(String(id), learned))
answer('desktop:update-environment', (id) => updateEnvironment(String(id)))
answer('desktop:check-for-update', () => checkForUpdate())
answer('desktop:install-update', () => restartForUpdate())
answer('desktop:can-dictate', () => canDictate())
answer('desktop:dictate-stop', () => stopDictation())
answer('desktop:dictate-cancel', () => cancelDictation())
answer('desktop:microphone-settings', () => openMicrophoneSettings())
// Before a call: the person is asked, the first time, whether the app may use the microphone.
answer('desktop:microphone', () => FAKE_MICROPHONE || microphone())
// What is said goes back to the window that asked to listen.
ipcMain.handle('desktop:dictate', (event, locale) => {
  if (!fromApp(event)) throw new Error('Not allowed.')
  return startDictation(event.sender, typeof locale === 'string' ? locale : undefined)
})
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
    title: 'OpenKumi',
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
  created.webContents.on('did-finish-load', () => {
    if (!waitingReturn) return
    created.webContents.send('desktop:sign-in', waitingReturn)
    waitingReturn = null
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
  // The interface asks for two things: copying to the clipboard, and the microphone for a call
  // (never the camera). Pages in it get nothing.
  pages.session.setPermissionRequestHandler((contents, permission, allow, details) => {
    const own = contents === pages && 'requestingUrl' in details && details.requestingUrl.startsWith(APP_URL)
    const sound = permission === 'media' && 'mediaTypes' in details && details.mediaTypes?.length === 1 && details.mediaTypes[0] === 'audio'
    allow(own && (permission === 'clipboard-sanitized-write' || sound))
  })
  void created.loadURL(APP_URL)
}

/** Sends the window to a page of its settings. */
const goTo = (page: string) => void win?.webContents.executeJavaScript(`location.hash = '/settings/${page}'`).catch(() => {})

function buildMenu() {
  const mac = process.platform === 'darwin'
  const settings: MenuItemConstructorOptions = { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => goTo('general') }
  // What it finds is shown on the About page, so that is where this goes.
  const updates: MenuItemConstructorOptions[] = updateState().state === 'unsupported' ? [] : [{ label: updateState().state === 'ready' ? 'Restart to Update…' : 'Check for Updates…', click: () => (goTo('about'), void checkForUpdate()) }]
  const appMenu: MenuItemConstructorOptions[] = mac
    ? [{ label: app.name, submenu: [{ role: 'about' }, ...updates, { type: 'separator' }, settings, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }]
    : []
  // Whose bots to show: each person on this computer, then the other computers.
  const { people: here = [], person } = whoIsHere()
  const radio = (label: string, checked: boolean, click: () => void): MenuItemConstructorOptions => ({ label, type: 'radio', checked, click })
  const onThisComputer = here.length
    ? here.map((name) => radio(shownName(name), config.current === 'local' && name === person, () => open('local', name)))
    : config.local.enabled ? [radio(nameOf('local'), config.current === 'local', () => open('local'))] : []
  const elsewhere = config.environments.filter((e) => e.enabled).map((e) => radio(e.name, config.current === e.id, () => open(e.id)))
  const groups = [onThisComputer, elsewhere].filter((group) => group.length)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...appMenu,
      {
        label: 'People',
        submenu: [...groups.flatMap((group) => [...group, { type: 'separator' } as const]), { label: 'Manage Environments…', click: () => goTo('environments') }, ...(mac ? [] : [{ type: 'separator' } as const, settings, ...updates])],
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
  // A Mac hands the app the addresses it opens with it; Windows and Linux start it again with one.
  app.on('open-url', (event, url) => {
    event.preventDefault()
    signInReturned(url)
  })
  app.on('second-instance', (_event, argv) => {
    if (win?.isMinimized()) win.restore()
    win?.focus()
    const url = argv.find((arg) => arg.startsWith(SIGN_IN_RETURN))
    if (url) signInReturned(url)
  })
  void app.whenReady().then(() => {
    if (app.isPackaged) catchesSignIns = app.setAsDefaultProtocolClient('openkumi')
    const started = process.argv.find((arg) => arg.startsWith(SIGN_IN_RETURN))
    if (started) waitingReturn = started
    // Tests run the app without a window, so it should not sit in the Dock either.
    if (HIDDEN) app.dock?.hide()
    serveInterface()
    buildMenu()
    // The local environment runs whenever it is turned on, whichever environment the window shows.
    // It starts alongside the window, not after it; the window is told when it is ready.
    if (config.local.enabled) void startLocal().catch(() => {})
    createWindow()
    startUpdates()
    app.on('activate', () => {
      if (!win) createWindow()
    })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  // The servers this app started end with it, everyone's; bots that are still working are stopped cleanly.
  app.on('before-quit', (event) => {
    if (stopped || !managing()) return
    event.preventDefault()
    void stopLocal().then(() => {
      stopped = true
      app.quit()
    })
  })
}
