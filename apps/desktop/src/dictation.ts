// Speaking instead of typing. What is said is written down on this computer by a small program of
// the app's own (packages/dictation/macos), with the Mac's speech models, and the window puts the
// words into the message being written. No sound leaves the computer; this process only starts the
// program and passes its lines to the window, so it still does no work of its own.
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import readline from 'node:readline'
import { type WebContents, shell, systemPreferences } from 'electron'
import type { DictationEvent } from '@openkumi/shared/dictation'
import { DICTATION, RECORDING } from './paths.ts'

let checked: Promise<boolean> | null = null

/** Whether this computer can take dictation: a Mac with macOS 26 or later, with the program built. */
export function canDictate() {
  checked ??= new Promise((resolve) => {
    if (process.platform !== 'darwin' || !fs.existsSync(DICTATION)) return resolve(false)
    execFile(DICTATION, ['--check'], { timeout: 10_000 }, (_error, stdout) => resolve(/"available":\s*true/.test(stdout)))
  })
  return checked
}

interface Session {
  to: WebContents
  child?: ChildProcess
  /** Given up: nothing more it says is passed on. */
  cancelled?: boolean
  /** It said its last (done, or failed). */
  ended?: boolean
}

let session: Session | null = null

function tell(s: Session, event: DictationEvent) {
  if (s.cancelled || s.ended) return
  if (event.type === 'done' || event.type === 'failed') s.ended = true
  if (!s.to.isDestroyed()) s.to.send('desktop:dictation', event)
}

/** Asks the person, the first time, whether the app may use the microphone. */
async function microphone() {
  if (process.platform !== 'darwin') return true
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'not-determined') return systemPreferences.askForMediaAccess('microphone')
  return status === 'granted'
}

export async function startDictation(to: WebContents, locale?: string) {
  cancelDictation()
  const s: Session = { to }
  session = s
  if (!(await canDictate())) return tell(s, { type: 'failed', code: 'unavailable', message: 'Dictation needs a Mac with macOS 26 or later.' })
  if (!RECORDING && !(await microphone())) return tell(s, { type: 'failed', code: 'denied', message: 'OpenKumi is not allowed to use the microphone.' })
  // Stopped or given up while the person was asked.
  if (session !== s) return

  const child = spawn(DICTATION, locale ? [locale] : [], { stdio: ['pipe', 'pipe', 'ignore'] })
  s.child = child
  readline.createInterface({ input: child.stdout! }).on('line', (line) => {
    try {
      tell(s, JSON.parse(line))
    } catch {
      // Not one of its events.
    }
  })
  child.stdin!.on('error', () => {})
  // The window went away, or loaded again: nothing is listening for the words any more.
  const leave = () => session === s && cancelDictation()
  to.on('destroyed', leave)
  to.on('did-start-loading', leave)
  const gone = () => {
    if (session === s) session = null
    to.off('destroyed', leave)
    to.off('did-start-loading', leave)
    tell(s, { type: 'failed', code: 'failed', message: 'Dictation stopped unexpectedly.' })
  }
  // Once its output is all read, so its last words are passed on first.
  child.on('close', gone)
  child.on('error', gone)
}

export function stopDictation() {
  const s = session
  if (!s) return
  if (s.child) s.child.stdin!.write('stop\n')
  else {
    // Still asking for the microphone: nothing was heard.
    session = null
    tell(s, { type: 'done', text: '' })
  }
}

export function cancelDictation() {
  const s = session
  if (!s) return
  session = null
  s.cancelled = true
  const child = s.child
  if (!child) return
  child.stdin!.end('cancel\n')
  setTimeout(() => child.exitCode === null && child.kill(), 2000).unref()
}

/** Opens the place in System Settings where the app can be allowed to use the microphone. */
export const openMicrophoneSettings = () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
