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
 * bot.md, next to the skill links and connection list, where the bot itself cannot write.
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
  /** Names of the catalog skills switched on for this bot. */
  skills: string[]
  /** Names of the catalog connections switched on for this bot. */
  connections: string[]
  /** Ids of the plugins installed for this bot. */
  plugins: string[]
  /** How its mascot looks. The mascot holds a sign with `emoji` on it. */
  look: Look
  /** Set while the bot's model is choosing its look, just after the bot was made. */
  choosingLook?: boolean
  createdAt: number
}

/** The parts a bot's mascot is put together from. Every app draws them the same way (@openbot/client/mascot). */
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

/** A skill in the shared catalog: a folder with a SKILL.md the bot reads when the task calls for it. */
export interface Skill {
  /** Folder name; what a bot's skill link points at. */
  name: string
  title: string
  description: string
  /** Ships with Open Bot, as opposed to one the user added to the catalog. */
  bundled: boolean
}

/** A ready-made ability that can be installed for one bot: its skills, and usually a connection to a service. */
export interface Plugin {
  id: string
  name: string
  /** An emoji, shown on a tile of `color`. */
  icon: string
  color: string
  category: string
  publisher: string
  tagline: string
  /** The plugin's own page, in Markdown. */
  description: string
  /** What a bot with the plugin is able to do, in plain words. */
  can: string[]
  /** Names of the catalog skills it switches on. */
  skills: string[]
  /** The connection it switches on, and the service it leads to. */
  connection: { name: string; host: string } | null
  /** Where the service is on the web. */
  site: string
  /** Something the owner provides once before the connection can be used. Secrets are never sent back. */
  setup: { id: string; title: string; fields: { key: string; label: string; secret?: boolean }[]; done: boolean; values: Record<string, string> } | null
  /** Ids of the bots it is installed for. */
  installedOn: string[]
}

/** An MCP server in the shared catalog. Secrets (headers, environment) never leave the server. */
export interface Connection {
  name: string
  kind: 'url' | 'command'
  /** The URL, or the command line, for display. */
  target: string
}

export interface ConnectionStatus {
  state: 'connecting' | 'connected' | 'needs-login' | 'error'
  /** How many tools the server offers, once connected. */
  tools: number
  /** This bot has an account saved for the server (so it can be signed out). */
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
  | { type: 'message'; role: 'user'; text: string; source: 'user' | 'parent' | 'subagent' | 'schedule' | 'task' }
  | { type: 'message'; role: 'assistant'; text: string }
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
 * When a scheduled task runs. Times of day are in the time zone of the computer running Open Bot.
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
  /** Let other devices on the local network use Open Bot (they need the access code). */
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
  /** 'cli' is an agent program installed on this computer (Claude Code, Codex) that Open Bot drives. */
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
  threadId: string | null
}

export interface BrowserState {
  running: boolean
  headless: boolean
  tabs: BrowserTab[]
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
  | { type: 'skills'; skills: Skill[] }
  | { type: 'connections'; connections: Connection[] }
  | { type: 'plugins'; plugins: Plugin[] }
  | { type: 'connection.status'; botId: string; name: string; status: ConnectionStatus | null }
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
  | { type: 'browser.input'; botId: string; tabId: string; input: BrowserInput }

export interface AppState {
  bots: Bot[]
  threads: Thread[]
  tasks: ScheduledTask[]
  providers: ProviderInfo[]
  browsers: Record<string, BrowserState>
  skills: Skill[]
  connections: Connection[]
  plugins: Plugin[]
  /** Live state of each bot's switched-on connections, by bot id then connection name. */
  connectionStatus: Record<string, Record<string, ConnectionStatus>>
  /** Where everything is stored, for display (e.g. "~/.openbot"). */
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
  /** The owner has written their own, instead of the ones Open Bot comes with. */
  custom: boolean
  /** The ones Open Bot comes with, for "restore default". */
  default: string
}
