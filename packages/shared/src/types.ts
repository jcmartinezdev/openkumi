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
  createdAt: number
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
  /** Set for subagent threads: the thread that spawned this one. */
  parentId: string | null
  title: string
  kind: 'chat' | 'subagent'
  /** When the owner started fresh and left this conversation behind; null for the current one. Archived ones are read-only. */
  archivedAt: number | null
  status: ThreadStatus
  /** Model override for this thread (subagents may run on a different model). */
  model: string | null
  /** Subagents only: whether the latest result has been delivered to the parent. */
  reported: boolean
  createdAt: number
  updatedAt: number
}

export type ItemData =
  | { type: 'message'; role: 'user'; text: string; source: 'user' | 'parent' | 'subagent' }
  | { type: 'message'; role: 'assistant'; text: string }
  | { type: 'reasoning'; summary: string; encrypted?: string | null; model?: string }
  | { type: 'function_call'; name: string; arguments: string; call_id: string }
  | { type: 'function_call_output'; call_id: string; output: string }
  | { type: 'web_search_call'; action: unknown; status?: string }
  | { type: 'notice'; level: 'info' | 'error'; text: string }
  /** Stands in, for the model, for every item of the thread up to and including item `upTo`. */
  | { type: 'summary'; text: string; upTo: number }

export interface Item {
  id: number
  threadId: string
  data: ItemData
  createdAt: number
}

/** A message found by searching a bot's conversations, the current one and the archived ones. */
export interface HistoryMatch {
  threadId: string
  itemId: number
  /** Who said it: the owner, the bot, or a subagent reporting back. */
  from: 'user' | 'bot' | 'subagent'
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
  | { type: 'item.add'; item: Item }
  | { type: 'stream.delta'; threadId: string; kind: 'text' | 'reasoning'; delta: string }
  | { type: 'providers'; providers: ProviderInfo[] }
  | { type: 'settings'; settings: Settings }
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
  about: About
}
