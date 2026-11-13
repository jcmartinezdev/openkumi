// What the desktop app's window and the app behind it say to each other. The window is the
// interface (apps/web); the app behind it (apps/desktop) keeps the list of environments, runs the
// one on this computer, and tells the window which environment to connect to.
import type { Listener } from './dictation'

/** An OpenKumi server on another computer, reached over the network. */
export interface RemoteEnvironment {
  id: string
  name: string
  /** Where it can be reached. `found` ones were reported by the server; the others were put in by hand. */
  addresses: { url: string; found?: boolean }[]
  enabled: boolean
}

/** OpenKumi on this computer, run by the app in a process of its own while it is turned on. */
export interface LocalEnvironment {
  enabled: boolean
  state: 'off' | 'starting' | 'running' | 'failed'
  /** Why it could not start, when it failed. */
  error: string
  /** False when OpenKumi was already running here and the app joined it instead of starting it. */
  startedHere: boolean
}

/** What the window needs to talk to the environment it shows. */
export interface Link {
  /** "local", or the id of a remote environment. */
  id: string
  name: string
  /**
   * The server's addresses, like http://192.168.1.20:4317, in the order they are tried. A remote
   * one is only sent the key once it has shown it is the server (packages/client/src/addresses.ts).
   */
  addresses: string[]
  /** The key sent with every request: the server's own access code on this computer, or the key this computer was given when it was paired. */
  token: string
  /** The server is on this computer. */
  local: boolean
  /** The server's own id, once known: another server answering at one of the addresses is not it. */
  serverId?: string
}

export interface DesktopState {
  version: string
  platform: string
  fullScreen: boolean
  local: LocalEnvironment
  environments: RemoteEnvironment[]
  /** The environment the window shows ("local" or a remote one's id), or null when none is turned on. */
  current: string | null
  /** Null while there is nothing to connect to: no environment turned on, or the local one still starting. */
  connection: Link | null
  /**
   * This app is what the computer opens the way back from a sign-in in its own browser with, so a
   * superpower's sign-in can happen there. Only an installed app can be. Missing from older apps.
   */
  catchesSignIns?: boolean
}

export type EnvironmentStatus = 'connected' | 'unreachable' | 'refused' | 'outdated' | 'off'

/** How a remote environment stands, and what each of its addresses said (see `Answer` in packages/client/src/addresses.ts). */
export interface EnvironmentReport {
  status: EnvironmentStatus
  addresses: Record<string, 'ok' | 'refused' | 'other' | 'outdated' | 'unreachable' | 'blocked'>
}

/** What the window can ask of the app (see apps/desktop/src/preload.ts). */
export interface DesktopBridge {
  /** The state as it was when the window loaded, so the first thing drawn is already right. */
  initial: DesktopState
  /** Called with the new state whenever it changes. Returns a function that stops the calls. */
  onState(listener: (state: DesktopState) => void): () => void
  /** Asks each remote environment, at each of its addresses, whether it is there and still accepts this computer. */
  statuses(): Promise<Record<string, EnvironmentReport>>
  /** Show another environment. */
  open(id: string): Promise<void>
  /** Turn the local environment on (OpenKumi runs on this computer) or off (it does not). */
  setLocal(on: boolean): Promise<void>
  /** Start the local environment again after it failed. */
  retry(): Promise<void>
  /** Pair with OpenKumi on another computer, using the code that computer shows, and add it. */
  add(input: { address: string; code: string; name: string }): Promise<void>
  /** Rename a remote environment, or turn it on or off. */
  update(id: string, patch: { name?: string; enabled?: boolean }): Promise<void>
  remove(id: string): Promise<void>
  /**
   * Adds an address to a remote environment, once whatever answers there has shown it is that
   * environment (or nothing answers yet). `checked` says whether it answered.
   */
  addAddress(id: string, address: string): Promise<{ checked: boolean }>
  /** Forgets an address that was put in by hand. */
  removeAddress(id: string, url: string): Promise<void>
  /** Keeps what the window learned about the environment it shows: its server's id and the addresses the server reports. */
  learn(id: string, learned: { serverId?: string; addresses?: string[] }): Promise<void>
  /**
   * Gives the address of a page to show in a frame (a page a bot showed, wrapped for drawing).
   * The address is a site of its own, so the page cannot reach the window.
   */
  showPage(html: string): Promise<string>
  /**
   * Dictation on this computer: what is said is written down here, with the Mac's speech models,
   * and only the words reach the window. Missing from older apps.
   */
  dictation?: Listener & {
    /** Whether this computer can take dictation: a Mac with macOS 26 or later. */
    available(): Promise<boolean>
    /** Opens the place in System Settings where the app can be allowed to use the microphone. */
    openMicrophoneSettings(): Promise<void>
  }
  /**
   * Called with the address a sign-in in this computer's own browser came back to, for the window
   * to pass on to its environment. One that came before anything listened goes to the first listener.
   * Missing from older apps.
   */
  onSignIn?(listener: (url: string) => void): () => void
}
