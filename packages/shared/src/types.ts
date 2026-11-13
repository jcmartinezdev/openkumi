// Types shared by the server and the web UI. Import with `import type` only.

/** How hard a model should think. Empty leaves it to the model's own default. Which levels a model takes varies. */
export type Effort = '' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** One model a provider offers. The first in a provider's list is the one it uses by default. */
export interface ModelInfo {
  /** What the provider calls it. */
  id: string
  /** Its name for people, with its version when the provider tells it: "Claude Opus 5.5". */
  name: string
  description?: string
  /** The reasoning levels it takes, lightest first. Missing when the provider does not say. */
  efforts?: Exclude<Effort, ''>[]
  /** The level it uses when none is chosen, when the provider tells it. */
  defaultEffort?: Exclude<Effort, ''>
  /** An earlier model of a kind that has a newer one: kept out of the way until asked for. */
  older?: boolean
}

/**
 * A bot is a folder (see server/bots.ts). These fields are what its owner controls: they live in
 * bot.md, next to the list of its superpowers, where the bot itself cannot write.
 * What the bot knows (its instructions, memory and files) lives in its workspace instead.
 */
export interface Bot {
  /** Also the name of the bot's folder. */
  id: string
  name: string
  emoji: string
  /**
   * What the bot is for, in a line. The other bots are told it, so they know when to hand it work.
   * The owner's, like the rules: a bot cannot change how the others see it.
   */
  description: string
  /** Rules from the owner. The bot reads them on every turn and cannot change them. */
  rules: string
  provider: string
  /** Empty string means "use the provider's default model". */
  model: string
  effort: Effort
  webSearch: boolean
  /** Run this bot's browser without a visible window (it is still viewable in the UI). */
  headless: boolean
  /** Ids of the superpowers switched on for this bot. */
  superpowers: string[]
  /** How its mascot looks. The mascot holds a sign with `emoji` on it. */
  look: Look
  /** Set while the bot's model is choosing its look, just after the bot was made. */
  choosingLook?: boolean
  createdAt: number
}

/** The parts a bot's mascot is put together from. Every app draws them the same way (@openkumi/client/mascot). */
export type Creature = 'bear' | 'cat' | 'bunny' | 'blob' | 'bug'
export type BodyColor = 'berry' | 'coral' | 'tangerine' | 'lemon' | 'lime' | 'mint' | 'sky' | 'periwinkle' | 'grape' | 'cocoa' | 'slate' | 'cloud'
export type Hat = 'none' | 'party' | 'beanie' | 'top' | 'crown' | 'chef' | 'cap' | 'grad' | 'wizard' | 'hardhat' | 'headphones' | 'headband' | 'flower'
export type Extra = 'none' | 'glasses' | 'bowtie' | 'scarf'
/** The colour of its hat, bow tie or scarf. None of these names is also a body colour. */
export type ClothesColor = 'navy' | 'red' | 'orange' | 'yellow' | 'forest' | 'teal' | 'purple' | 'pink' | 'white' | 'charcoal'
export interface Look {
  creature: Creature
  color: BodyColor
  hat: Hat
  extra: Extra
  clothes: ClothesColor
}

/**
 * Something a bot can do beyond its own tools, such as working in the user's Notion. Every one ships
 * with OpenKumi, and the owner switches it on for one bot at a time. It brings instructions the bot
 * reads when a task calls for them, a service the bot signs in to and works in, or both.
 */
export interface Superpower {
  id: string
  name: string
  /** Its app icon, as SVG markup on a square, or empty when it has none. Each app rounds its corners. */
  icon: string
  /** The catalog's groups it is in, in the catalog's order. */
  categories: string[]
  tagline: string
  /** Its own page, in Markdown. */
  about: string
  /** What a bot with it is able to do, in plain words. */
  can: string[]
  /** It comes with instructions the bot reads when a task calls for them. */
  instructions: boolean
  /** The files a bot with it can read, by path in its folder, its instructions first. */
  files: string[]
  /** It works in an app the bot signs in to, and is active only once the bot is signed in. */
  signIn: boolean
  /** Where its tools come from, for display ("mcp.notion.com"), when it brings a service. */
  service: string | null
  /** Where the service is on the web. */
  site: string
  /** Ids of the bots it is switched on for. */
  onFor: string[]
}

/** How a bot's connection to a superpower's service stands. */
export interface SuperpowerStatus {
  state: 'connecting' | 'connected' | 'needs-login' | 'error'
  /** How many tools the service offers, once connected. */
  tools: number
  /** This bot has an account saved for the service (so it can be signed out). */
  signedIn?: boolean
  error?: string
}

export interface FileEntry {
  /** Path inside the bot's workspace, with forward slashes. */
  path: string
  dir: boolean
  size: number
  modified: number
}

/** One recorded change to a bot's workspace. */
export interface HistoryEntry {
  id: string
  time: number
  author: 'bot' | 'you' | 'system'
  message: string
  files: string[]
}

/**
 * A file the owner sent with a message: a photo, a PDF, anything. The conversation keeps it, and the
 * bot gets a copy of its own in files/inbox/, which it may file away, rename or delete. Pictures and
 * PDFs are also shown to its model with the message, when the model can take them.
 */
export interface Attachment {
  /** The conversation's copy, at /api/threads/<thread>/attachments/<id>. */
  id: string
  /** Its name, as it was sent. */
  name: string
  /** Where the bot's copy was put ("files/inbox/receipt.jpg"). It may have moved it since. */
  path: string
  /** Its media type ("image/jpeg", "application/pdf"); "application/octet-stream" when it is not known. */
  type: string
  size: number
}

export type ThreadStatus = 'idle' | 'running' | 'error'

/**
 * A bot has one conversation with its owner: the thread of kind 'chat' that is not archived.
 * Starting fresh archives it and begins an empty one. Subagents work in threads beneath it.
 */
export interface Thread {
  id: string
  botId: string
  /** Set for subagent threads and scheduled runs: the thread they belong under. */
  parentId: string | null
  title: string
  /** 'task' is one run of a scheduled task, beneath the bot's conversation. */
  kind: 'chat' | 'subagent' | 'task'
  /** For a run of a scheduled task: which task. */
  taskId: string | null
  /** When the owner started fresh and left this conversation behind; null for the current one. Archived ones are read-only. */
  archivedAt: number | null
  status: ThreadStatus
  /** Model override for this thread (subagents may run on a different model). */
  model: string | null
  /** Subagents and scheduled runs: whether the latest result has been delivered. */
  reported: boolean
  createdAt: number
  updatedAt: number
}

export type ItemData =
  /**
   * Who a user-role message is from: the owner; the thread above, handing a subagent its task; a
   * subagent reporting back; a scheduled task handing a run its prompt ('schedule'); or a scheduled
   * run reporting back to the bot's conversation ('task').
   */
  | { type: 'message'; role: 'user'; text: string; source: 'user' | 'parent' | 'subagent' | 'schedule' | 'task'; attachments?: Attachment[] }
  /** `stopped`: cut off before it was finished (stopped, failed, or the server shut down); `text` is what had been written. */
  | { type: 'message'; role: 'assistant'; text: string; stopped?: true }
  | { type: 'reasoning'; summary: string; encrypted?: string | null; model?: string }
  | { type: 'function_call'; name: string; arguments: string; call_id: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | { type: 'web_search_call'; action: unknown; status?: string }
  | { type: 'notice'; level: 'info' | 'error'; text: string }
  /**
   * A page the bot showed with show_page (a chart, a dashboard, a diagram), drawn in the
   * conversation. Self-contained HTML; `height` is the bot's guess, until the page is measured.
   */
  | { type: 'page'; title: string; html: string; height: number }
  /** Stands in, for the model, for every item of the thread up to and including item `upTo`. */
  | { type: 'summary'; text: string; upTo: number }

export interface Item {
  id: number
  threadId: string
  data: ItemData
  createdAt: number
}

/**
 * When a scheduled task runs. Times of day are in the time zone of the computer running OpenKumi.
 * 'daily' runs at `time` ("HH:MM") on the days of the week in `days` (0 is Sunday), every day when it is empty.
 */
export type Schedule =
  | { type: 'once'; at: number }
  | { type: 'daily'; time: string; days: number[] }
  | { type: 'interval'; minutes: number }

/**
 * A prompt a bot is given at set times. Each run happens in the background, in a thread of its own
 * beneath the bot's conversation, and what came of it is passed to the conversation for the bot to
 * tell the user. The owner makes tasks in Settings; bots make them with their tools.
 */
export interface ScheduledTask {
  id: string
  /** The bot that does the task. */
  botId: string
  title: string
  prompt: string
  schedule: Schedule
  /** Paused when false. */
  enabled: boolean
  /** Who made it: 'user' for the owner, or the id of the bot that scheduled it. */
  createdBy: string
  /** When it runs next. Null when it is paused, or will not run again. */
  nextRunAt: number | null
  lastRunAt: number | null
  /** How the last run went. 'missed' when the computer was off or asleep at the time it was due. */
  lastStatus: 'running' | 'completed' | 'failed' | 'stopped' | 'missed' | null
  lastError: string | null
  /** The thread of the last run. */
  lastThreadId: string | null
  createdAt: number
  updatedAt: number
}

/** A message found by searching a bot's conversations, the current one and the archived ones. */
export interface HistoryMatch {
  threadId: string
  itemId: number
  /** Who said it: the owner, the bot, a subagent reporting back, or a scheduled task's run reporting back. */
  from: 'user' | 'bot' | 'subagent' | 'task'
  /** The part of the message around the first word that matched. */
  snippet: string
  createdAt: number
}

/** Settings for the whole app, stored on the server. Things that belong to one device (theme, text size) are kept in the browser instead. */
export interface Settings {
  /** Let other devices on the local network use OpenKumi (they need the access code). */
  lan: boolean
  /** Which browser program the bots drive. "chromium" is the one that comes with Playwright. */
  browserChannel: 'chrome' | 'msedge' | 'chromium'
  /** What a new bot runs on. Empty means the first provider that is connected. */
  defaultProvider: string
  defaultWebSearch: boolean
  defaultShowBrowser: boolean
  /** Providers switched off: they are not offered for bots. */
  disabledProviders: string[]
  /** Where the Claude Code, Codex and Grok programs are, when they should not be looked up. */
  claudePath: string
  codexPath: string
  grokPath: string
  /** The address of a local model server, when it is not Ollama or LM Studio at their usual place. */
  localUrl: string
  /** How many model steps one turn may take before it is stopped. */
  maxSteps: number
  /** How many subagents of one chat may run at the same time. */
  maxSubagents: number
  /** How many levels of subagents may spawn subagents. 0 switches subagents off. */
  maxDepth: number
  /** How much of a bot's AGENTS.md is loaded into each conversation, in characters. */
  instructionsLimit: number
  /**
   * How long a conversation may get, in tokens (roughly), before its older part is replaced by a
   * summary. For bots on an API or a local model; Claude Code, Codex and Grok look after this themselves.
   */
  historyLimit: number
  /** Write everything Claude Code, Codex and Grok print to the server log. */
  debugEngines: boolean
}

/** Facts about this installation, for the About and Access pages. */
export interface About {
  version: string
  node: string
  platform: string
  port: number
  /** Started with --lan, so the network setting cannot be switched off from the app. */
  lanForced: boolean
  /** The time zone scheduled tasks keep to, such as "Europe/Berlin". */
  timeZone: string
}

export interface ProviderInfo {
  id: string
  name: string
  /** 'cli' is an agent program installed on this computer (Claude Code, Codex) that OpenKumi drives. */
  kind: 'apikey' | 'cli' | 'local'
  connected: boolean
  detail: string
  /** What to do to connect it, when it is not connected. */
  hint?: string
  /** Switched off in Settings: not offered for bots. Missing means switched on. */
  enabled?: boolean
  /** For a program on this computer: where it was found, and which version it is. */
  path?: string
  version?: string
  baseUrl?: string
}

export interface BrowserTab {
  id: string
  url: string
  title: string
  /** The thread whose window the tab is in (the window says so too; kept for older apps). */
  threadId: string | null
  windowId: string
}

/**
 * A window of a bot's browser. Every thread that browses (the conversation, a subagent, a scheduled
 * run) has one of its own, so sessions running at once never get in each other's way, while all of
 * them share the bot's profile: its cookies and logins.
 */
export interface BrowserWindow {
  id: string
  /** The thread that works in it; null for the window the browser starts with, until a thread needs one. */
  threadId: string | null
  /** The tab the bot works in. */
  activeTab: string | null
  /**
   * The view of an app that has taken control of it (each app view makes up an id of its own), or
   * null while the bot has it. Only that view can use the page; the bot can then only read it.
   */
  controller: string | null
  /** What the bot asked the owner to do in it, such as signing in, while it waits for them. */
  request: string | null
  /** When the bot last used it. */
  usedAt: number
}

export interface BrowserState {
  running: boolean
  headless: boolean
  tabs: BrowserTab[]
  windows: BrowserWindow[]
}

export interface Partial {
  text: string
  reasoning: string
}

export type ServerEvent =
  | { type: 'bot.upsert'; bot: Bot }
  | { type: 'bot.delete'; id: string }
  | { type: 'thread.upsert'; thread: Thread }
  | { type: 'thread.delete'; id: string }
  | { type: 'task.upsert'; task: ScheduledTask }
  | { type: 'task.delete'; id: string }
  | { type: 'item.add'; item: Item }
  | { type: 'stream.delta'; threadId: string; kind: 'text' | 'reasoning'; delta: string }
  | { type: 'providers'; providers: ProviderInfo[] }
  | { type: 'settings'; settings: Settings }
  | { type: 'principles'; principles: Principles }
  | { type: 'superpowers'; superpowers: Superpower[]; categories: string[] }
  | { type: 'superpower.status'; botId: string; id: string; status: SuperpowerStatus | null }
  | { type: 'files.changed'; botId: string }
  | { type: 'browser.state'; botId: string; state: BrowserState }

/** Another computer that was paired with this server and may use it. */
export interface PairedComputer {
  id: string
  name: string
  pairedAt: number
  lastSeenAt: number
}

export type BrowserInput =
  | { kind: 'move' | 'down' | 'up'; x: number; y: number; button?: 'left' | 'right' | 'middle' }
  | { kind: 'wheel'; x: number; y: number; dx: number; dy: number }
  | { kind: 'keydown' | 'keyup'; key: string }
  | { kind: 'text'; text: string }

export type ClientEvent =
  | { type: 'browser.subscribe'; botId: string; tabId: string }
  | { type: 'browser.unsubscribe'; botId: string; tabId: string }
  /** Only reaches the page from the connection whose view has control of the tab's window. */
  | { type: 'browser.input'; botId: string; tabId: string; input: BrowserInput }
  /**
   * Taking control of a window for the view `viewer`, handing it back to the bot, or saying no to
   * what the bot asked. Control goes back to the bot by itself when the connection closes.
   */
  | { type: 'browser.control'; botId: string; windowId: string; viewer: string; action: 'take' | 'give' | 'decline' }

export interface AppState {
  bots: Bot[]
  threads: Thread[]
  tasks: ScheduledTask[]
  providers: ProviderInfo[]
  browsers: Record<string, BrowserState>
  superpowers: Superpower[]
  /** The groups the superpower catalog shows, in its order. */
  superpowerCategories: string[]
  /** How each bot's superpowers with a service stand, by bot id then superpower id. */
  superpowerStatus: Record<string, Record<string, SuperpowerStatus>>
  /** Where everything is stored, for display (e.g. "~/.openkumi"). */
  home: string
  settings: Settings
  /** What every setting is when nothing has been changed, for "reset to default". */
  defaults: Settings
  principles: Principles
  about: About
}

/**
 * What every bot is told before anything else: how to behave, and how to work with the other bots.
 * Set by the owner for all bots at once; a bot cannot change them.
 */
export interface Principles {
  text: string
  /** The owner has written their own, instead of the ones OpenKumi comes with. */
  custom: boolean
  /** The ones OpenKumi comes with, for "restore default". */
  default: string
}
