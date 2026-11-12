// Where the app finds its own parts, and the switches the tests use.
import path from 'node:path'
import { app } from 'electron'

// Tests keep the app's own data out of the user's. This has to happen before anything asks where it is.
if (process.env.OPENBOT_DESKTOP_DATA) app.setPath('userData', process.env.OPENBOT_DESKTOP_DATA)

/** Run from the repository the other apps are beside this one; installed, they are among the app's resources. */
const part = (inRepository: string, installed: string) => (app.isPackaged ? path.join(process.resourcesPath, installed) : path.join(app.getAppPath(), '..', inRepository))

/** The interface, built (apps/web). */
export const WEB = part(path.join('web', 'dist'), 'web')
/** The server's entry (apps/server). It is TypeScript, which the app's own Node runs as it is. */
export const SERVER = part(path.join('server', 'src', 'index.ts'), path.join('server', 'src', 'index.ts'))
export const PRELOAD = path.join(__dirname, 'preload.cjs')
export const USER_DATA = app.getPath('userData')

/** The address of a running Vite server, while developing: the window then gets the interface from it. */
export const DEV_URL = process.env.OPENBOT_DEV_URL || ''
/** Tests run the app without a window on the screen. */
export const HIDDEN = process.env.OPENBOT_DESKTOP_HIDDEN === '1'
/** Tests answer the app's "are you sure?" dialogs with yes. */
export const ASSUME_YES = !!process.env.OPENBOT_DESKTOP_YES
/** Tests have the app say it catches sign-ins, which only an installed app really can. */
export const CATCH_SIGN_INS = process.env.OPENBOT_DESKTOP_CATCH_SIGN_INS === '1'
