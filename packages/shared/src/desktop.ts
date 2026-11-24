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
  /** Whose bots it holds, by the name they have on that computer, once it has said. */
  person?: string
}

/** OpenKumi on this computer, run by the app in a process of its own while it is turned on. */
export interface LocalEnvironment {
  enabled: boolean
  state: 'off' | 'starting' | 'running' | 'failed'
  /** Why it could not start, when it failed. */
  error: string
  /** False when OpenKumi was already running here and the app joined it instead of starting it. */
  startedHere: boolean
  /**
   * Nobody has bots on this computer yet. Whoever turns the local environment on is the first
   * person here, and this is what they are called unless they give another name: the name of
   * their account on the computer. Missing once someone has, and from older apps.
   */
  nobodyYet?: string
  /**
   * Who has bots on this computer, the first person first. Each one's bots are shown in this app
   * by picking them. Known only while the local environment runs.
   */
  people?: string[]
  /** Whose bots the window shows when it shows this computer: one of `people`. */
  person?: string
  /** The first person here, whose server the local environment is: it starts the others', and cannot be removed. */
  first?: string
}

/**
 * Someone with bots on this computer. Each person has a server of their own here, apart from the
 * others' (apps/server/src/people.ts); the local environment is the first person's.
 */
export interface PersonHere {
  /** What they are called here, which is also their folder's name: small letters, digits and dashes. */
  name: string
  /** The port their server listens on. */
  port: number
  /** The person the local environment is: whoever sits at this app. */
  me: boolean
  running: boolean
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
  /**
   * Whose bots these are, when the server is on this computer: each person there has a server of
   * their own, so another person here is another environment to the window.
   */
  person?: string
}

/** How the app stands with its own updates (apps/desktop/src/updates.ts). */
export interface AppUpdate {
  /**
   * - `none`: nothing newer is known;
   * - `checking`: looking for a newer version;
   * - `downloading`: fetching it, `progress` percent done;
   * - `ready`: it is downloaded, and takes this version's place when the app next quits or is restarted for it;
   * - `failed`: see `error`;
   * - `unsupported`: this copy cannot update itself (it runs from the repository, or was installed as a package the system updates).
   */
  state: 'none' | 'checking' | 'downloading' | 'ready' | 'failed' | 'unsupported'
  /** The newer version, once one is found. */
  version: string | null
  progress: number
  error: string
  /** When it last looked, in milliseconds, or 0. */
  checkedAt: number
}

export interface DesktopState {
  version: string
  /** Missing from older apps. */
  update?: AppUpdate
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

export type EnvironmentStatus = 'connected' | 'unreachable' | 'refused' | 'outdated' | 'newer' | 'off'

/** How a remote environment stands, and what each of its addresses said (see `Answer` in packages/client/src/addresses.ts). */
export interface EnvironmentReport {
  status: EnvironmentStatus
  addresses: Record<string, 'ok' | 'refused' | 'other' | 'outdated' | 'newer' | 'unreachable' | 'blocked'>
  /** The version of OpenKumi there, when it said. */
  version?: string
  /** It runs an older OpenKumi but showed it is the paired computer, so it can be asked to update itself (`updateEnvironment`). */
  canUpdate?: boolean
}

/** What the window can ask of the app (see apps/desktop/src/preload.ts). */
export interface DesktopBridge {
  /** The state as it was when the window loaded, so the first thing drawn is already right. */
  initial: DesktopState
  /** Called with the new state whenever it changes. Returns a function that stops the calls. */
  onState(listener: (state: DesktopState) => void): () => void
  /** Asks each remote environment, at each of its addresses, whether it is there and still accepts this computer. */
  statuses(): Promise<Record<string, EnvironmentReport>>
  /** Show another environment. On this computer ("local"), `person` picks whose bots it shows. */
  open(id: string, person?: string): Promise<void>
  /**
   * Turn the local environment on (OpenKumi runs on this computer) or off (it does not). `name` is
   * what the first person here is called, when nobody has bots here yet (`nobodyYet`).
   */
  setLocal(on: boolean, name?: string): Promise<void>
  /**
   * The people with bots on this computer, looked after from here: only the app on the computer
   * that runs the bots can, never one connected from elsewhere. Every change resolves with the
   * list as it is then, and needs the local environment to have been started by this app.
   * Missing from older apps.
   */
  people?: {
    /** Bots of their own for someone else: their server is started, and the window shows them. */
    add(name: string): Promise<PersonHere[]>
    rename(name: string, to: string): Promise<PersonHere[]>
    /** Stops their server. What it held is kept. The window goes back to the first person's bots if it showed theirs. */
    remove(name: string): Promise<PersonHere[]>
  }
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
  /** Keeps what the window learned about the environment it shows: its server's id, the addresses the server reports, and whose bots it holds. */
  learn(id: string, learned: { serverId?: string; addresses?: string[]; person?: string }): Promise<void>
  /**
   * Asks a remote environment that runs an older OpenKumi to update itself. Its key only goes to
   * an address that has shown it is that environment. Resolves with what it said it will do.
   * Missing from older apps.
   */
  updateEnvironment?(id: string): Promise<string>
  /** Looks for a newer version of this app now. Missing from older apps. */
  checkForUpdate?(): Promise<void>
  /** Quits, puts the downloaded version in place and opens it. The local environment is stopped first. Missing from older apps. */
  installUpdate?(): Promise<void>
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
   * Asks the person, the first time, whether the app may use the microphone, for a call. Resolves
   * with whether it may. Missing from older apps.
   */
  microphone?(): Promise<boolean>
  /**
   * Called with the address a sign-in in this computer's own browser came back to, for the window
   * to pass on to its environment. One that came before anything listened goes to the first listener.
   * Missing from older apps.
   */
  onSignIn?(listener: (url: string) => void): () => void
}
