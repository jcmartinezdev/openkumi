// What the desktop app's window and the app behind it say to each other. The window is the
// interface (apps/web); the app behind it (apps/desktop) keeps the list of environments, runs the
// one on this computer, and tells the window which environment to connect to.

/** An Open Bot server on another computer, reached over the network. */
export interface RemoteEnvironment {
  id: string
  name: string
  url: string
  enabled: boolean
}

/** Open Bot on this computer, run by the app in a process of its own while it is turned on. */
export interface LocalEnvironment {
  enabled: boolean
  state: 'off' | 'starting' | 'running' | 'failed'
  /** Why it could not start, when it failed. */
  error: string
  /** False when Open Bot was already running here and the app joined it instead of starting it. */
  startedHere: boolean
}

/** What the window needs to talk to the environment it shows. */
export interface Link {
  /** "local", or the id of a remote environment. */
  id: string
  name: string
  /** The server's address, like http://127.0.0.1:4317. */
  url: string
  /** The key sent with every request: the server's own access code on this computer, or the key this computer was given when it was paired. */
  token: string
  /** The server is on this computer. */
  local: boolean
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

export type EnvironmentStatus = 'connected' | 'unreachable' | 'refused' | 'off'

/** What the window can ask of the app (see apps/desktop/src/preload.ts). */
export interface DesktopBridge {
  /** The state as it was when the window loaded, so the first thing drawn is already right. */
  initial: DesktopState
  /** Called with the new state whenever it changes. Returns a function that stops the calls. */
  onState(listener: (state: DesktopState) => void): () => void
  /** Asks each remote environment whether it is there and still accepts this computer. */
  statuses(): Promise<Record<string, EnvironmentStatus>>
  /** Show another environment. */
  open(id: string): Promise<void>
  /** Turn the local environment on (Open Bot runs on this computer) or off (it does not). */
  setLocal(on: boolean): Promise<void>
  /** Start the local environment again after it failed. */
  retry(): Promise<void>
  /** Pair with Open Bot on another computer, using the code that computer shows, and add it. */
  add(input: { address: string; code: string; name: string }): Promise<void>
  /** Rename a remote environment, or turn it on or off. */
  update(id: string, patch: { name?: string; enabled?: boolean }): Promise<void>
  remove(id: string): Promise<void>
  /**
   * Gives the address of a page to show in a frame (a page a bot showed, wrapped for drawing).
   * The address is a site of its own, so the page cannot reach the window.
   */
  showPage(html: string): Promise<string>
  /**
   * Called with the address a sign-in in this computer's own browser came back to, for the window
   * to pass on to its environment. One that came before anything listened goes to the first listener.
   * Missing from older apps.
   */
  onSignIn?(listener: (url: string) => void): () => void
}
