// Where the app finds its own parts, and the switches the tests use.
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

// Tests keep the app's own data out of the user's. This has to happen before anything asks where it is.
if (process.env.OPENKUMI_DESKTOP_DATA) app.setPath('userData', process.env.OPENKUMI_DESKTOP_DATA)
else moveFromOpenBot()

/**
 * The app was called Open Bot, and its data folder was named after it. That folder becomes this
 * app's the first time it starts, unless Open Bot is still running with it: then it is used where
 * it is until a start after that app has quit.
 */
function moveFromOpenBot() {
  const now = app.getPath('userData')
  const before = path.join(app.getPath('appData'), 'Open Bot')
  if (fs.existsSync(now) || !fs.existsSync(before)) return
  // Chromium's mark that an app has the folder: a link to "<computer>-<process id>", left behind if it crashed.
  let holder = 0
  try {
    holder = Number(fs.readlinkSync(path.join(before, 'SingletonLock')).split('-').pop())
  } catch {
    // Not running.
  }
  if (holder && running(holder)) app.setPath('userData', before)
  else fs.renameSync(before, now)
}

function running(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Run from the repository the other apps are beside this one; installed, they are among the app's resources. */
const part = (inRepository: string, installed: string) => (app.isPackaged ? path.join(process.resourcesPath, installed) : path.join(app.getAppPath(), '..', inRepository))

/** The interface, built (apps/web). */
export const WEB = part(path.join('web', 'dist'), 'web')
/** The server's entry (apps/server). It is TypeScript, which the app's own Node runs as it is. */
export const SERVER = part(path.join('server', 'src', 'index.ts'), path.join('server', 'src', 'index.ts'))
export const PRELOAD = path.join(__dirname, 'preload.cjs')
/** The program that takes dictation on a Mac (packages/dictation/macos), built beside the app's own. Installed, it is among the resources, outside the archive. */
export const DICTATION = app.isPackaged ? path.join(process.resourcesPath, 'dictation') : path.join(__dirname, 'dictation')
export const USER_DATA = app.getPath('userData')

/** The address of a running Vite server, while developing: the window then gets the interface from it. */
export const DEV_URL = process.env.OPENKUMI_DEV_URL || ''
/** Tests run the app without a window on the screen. */
export const HIDDEN = process.env.OPENKUMI_DESKTOP_HIDDEN === '1'
/** Tests answer the app's "are you sure?" dialogs with yes. */
export const ASSUME_YES = !!process.env.OPENKUMI_DESKTOP_YES
/** Tests have dictation hear a recording instead of the microphone (the program reads it from its environment). */
export const RECORDING = !!process.env.OPENKUMI_DICTATION_RECORDING
/** Tests have the app say it catches sign-ins, which only an installed app really can. */
export const CATCH_SIGN_INS = process.env.OPENKUMI_DESKTOP_CATCH_SIGN_INS === '1'
