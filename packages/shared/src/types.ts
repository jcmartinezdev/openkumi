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
 * What a bot, or a single run, works on: a provider, one of its models (empty for the provider's
 * default, so it follows that if it changes) and how hard the model thinks.
 */
export interface RunsOn {
  provider: string
  model: string
  effort: Effort
}

/**
 * A bot is a folder (see server/bots.ts). These fields are what its owner controls: they live in
 * bot.md, next to the list of its superpowers, where the bot itself cannot write.
 * What the bot knows (its instructions, memory and files) lives in its workspace instead.
 */
export interface Bot {
  /**
   * Also the name of the bot's folder. Made from the name the bot was given first, and changed only
   * when its owner changes it (POST /api/bots/:id/move).
   */
  id: string
  /**
   * The ids it had before, the latest first. They still reach it: other bots' notes, automations and
   * links from before name it that way. Missing from servers from before ids could change.
   */
  formerIds?: string[]
  name: string
  emoji: string
  /**
   * What the bot is for, in a line. The other bots are told it, so they know what to pass on to it.
   * The owner's, like the rules: no bot can change how the others see it, but the main assistant
   * when the owner asks it to (update_bot).
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
  /** The voice it speaks with on a call (see Call), by name. Empty means the usual one. */
  voice: string
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
  /** The bot signs in to it only inside its own browser: the app refuses any other way back. */
  botBrowserOnly: boolean
  /** Where its tools come from, for display ("mcp.notion.com", "T3 Code on this computer"), when it brings a service. */
  service: string | null
  /** Where the service is on the web. */
  site: string
  /** Ids of the bots it is switched on for. */
  onFor: string[]
  /** Its app can call OpenKumi when something happens there (a webhook): what it can call about, and how the owner sets that up in the app. */
  hooks: { events: { id: string; name: string }[]; setup: string[] } | null
}

/**
 * A webhook: the way one bot's app (a superpower) calls OpenKumi the moment something happens
 * there. The owner sets it up once, in the app, with the address OpenKumi gives and the secret the
 * app signs its calls with; automations of that bot can then start on its calls.
 */
export interface Hook {
  /** Also the end of its address, which nobody can guess. */
  id: string
  botId: string
  /** The superpower whose app calls. */
  power: string
  /** The secret has been given: until then every call is refused. It is never sent to an app. */
  secret: boolean
  createdAt: number
  /** When the app last called, and how often it has. */
  lastCallAt: number | null
  calls: number
  /** When a call was last refused because it was not signed with the secret. */
  refusedAt: number | null
}

/** Where the key that a person's secrets are encrypted with is kept: the Mac's keychain, the Linux desktop's keyring, Windows' protection for the account, or a file only the account can read. */
export type VaultKeeper = 'keychain' | 'keyring' | 'windows' | 'file'

/**
 * A secret in a bot's vault (an API key, a password, a token), as the apps are shown it: never
 * its value. The bot uses it by name and does not see the value either; the server puts it in as
 * a request leaves, and only to the sites the secret is for.
 */
export interface Secret {
  name: string
  /** What it is, in a few words: "Plausible API key". */
  what: string
  /** The sites it may be sent to: each a host, with its port when that is not the usual one. */
  sites: string[]
  /** Who put it there: the owner, or the bot itself (a key a page showed it, a password it had made up). */
  by: 'owner' | 'bot'
  createdAt: number
  /** When its value was last given. */
  changedAt: number
  usedAt: number | null
  /** Why it cannot be read right now, when it cannot: its key is not on this computer, or cannot be had. */
  problem?: string
  /**
   * With a user name it is a login: an account on its site, whose password is the value. The bot
   * signs in with it by itself (browser_sign_in), and is told the user name, never the password.
   */
  user?: string
  /** A login's sign-in page, when it is known. */
  page?: string
}

/**
 * What the owner typed into a sign-in form in a bot's browser window while they had control of
 * it, offered to be kept as that bot's login. The password stays on the server until they say yes.
 */
export interface LoginOffer {
  id: string
  /** The site the form was on, as a login names it: its host. */
  site: string
  /** The user name as it was read from the form: empty when none was found, and the owner's to correct. */
  user: string
  /** The login it would give a new password, when the bot has one for this account. */
  replaces?: string
}

/** A bot's secrets, and where the key they are encrypted with is kept (null before the first one). */
export interface Secrets {
  secrets: Secret[]
  kept: VaultKeeper | null
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
 * A file sent with a message, by the owner or by another bot: a photo, a PDF, anything. The
 * conversation keeps it, and the bot gets a copy of its own in files/inbox/, which it may file
 * away, rename or delete. Pictures and PDFs are also shown to its model with the message, when the
 * model can take them.
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
 * What a bot raised on its conversation to reach its owner (notify_user, ask_user), put there when its turn
 * was over. 'answer': it cannot go on without their answer, decision or go-ahead, and it stays
 * until they write to the bot or clear it. 'read': it told them something that should not wait
 * until they next look, and it goes once they have read up to it.
 */
export interface Flag {
  kind: 'answer' | 'read'
  /** What it is about, in the bot's few words, to show beside its name. */
  reason: string
  /**
   * What the bot asked with ask_user, for the owner to answer by choosing: the apps show them over
   * the composer for as long as this stands, and the answers go to the bot as a message from the
   * owner, which clears it like anything they write. Missing when the bot only said it needs them.
   */
  questions?: Question[]
  /** The last thing the bot had said when it raised it (see Thread.told). */
  item: number
  at: number
}

/**
 * One thing a bot asks its owner with ask_user: a question and the answers it offers. The owner
 * chooses among them, or writes an answer of their own, which is always possible; a question with
 * no options is answered in writing only.
 */
export interface Question {
  /** What it is about, in a word or two ("Flight"), shown over the question. Empty when the bot gave none. */
  header: string
  question: string
  options: { label: string; /** What choosing it means, when the label does not say it all. May be empty. */ description: string }[]
  /** More than one of the options may be chosen. */
  multiple: boolean
}

/**
 * A call: the owner talks with a bot, out loud, and it talks back at once. The voice on the line
 * is a speech model of the owner's ChatGPT plan, reached through Codex; it speaks as the bot and
 * makes small talk itself. Whatever needs the bot (its tools, its memory, its accounts) it passes
 * to the bot's own conversation as a message, and it reads the bot's answer out when it comes.
 * Sound goes between the device and the speech model directly, never through the OpenKumi server.
 * There is one call at a time.
 */
export interface Call {
  id: string
  botId: string
  /** 'connecting' until the voice is on the line. */
  state: 'connecting' | 'live'
  startedAt: number
  /** How many things the owner asked for on the call are still being worked on: by the bot, or by a subagent it started for one. */
  working: number
}

/** Whether bots can be called, and why not when they cannot. */
export interface CallsInfo {
  available: boolean
  /** What is missing, when calls are not available. */
  reason: string
}

/**
 * A bot has one conversation with its owner: the thread of kind 'chat' that is not archived.
 * Starting fresh archives it and begins an empty one. Subagents work in threads beneath it.
 */
export interface Thread {
  id: string
  botId: string
  /** Set for subagent threads and runs of automations: the thread they belong under. */
  parentId: string | null
  title: string
  /** 'automation' is one run of an automation, beneath the bot's conversation. */
  kind: 'chat' | 'subagent' | 'automation'
  /** For a run of an automation: which one. */
  automationId: string | null
  /** When the owner started fresh and left this conversation behind; null for the current one. Archived ones are read-only. */
  archivedAt: number | null
  status: ThreadStatus
  /**
   * The provider this thread runs on, when that was chosen for it rather than left to its bot: a
   * run of an automation with a model of its own, and the subagents of such a run. `model` and
   * `effort` are then that provider's, an empty model being its default.
   */
  provider: string | null
  /** The model this thread runs on. Without `provider`, one of the bot's provider that a subagent was given in place of the bot's. */
  model: string | null
  /** How hard the model thinks, when `provider` is set. */
  effort: Effort | null
  /** Subagents and runs of automations: whether the latest result has been delivered. */
  reported: boolean
  /**
   * The messages waiting for the bot in this thread (see Queued) are held back: it was stopped, or
   * failed, while they waited. They go in once the owner writes to it or lets them go.
   */
  held: boolean
  /**
   * A bot's conversation: the id of the last thing the bot said to its owner in it (a reply, or a
   * page it showed), as of when it last finished. With `readTo` it says whether there is something
   * new to read. Missing from older servers, like the two below.
   */
  told?: number
  /** A bot's conversation: how far its owner has read, on any device. The id of an item, 0 when they have read nothing. */
  readTo?: number
  /** A bot's conversation: what the bot raised to reach its owner, until that is dealt with. */
  flag?: Flag | null
  /**
   * How often something that was already in the thread was rewritten (a secret taken out of it).
   * An app that holds items of the thread from before a rewrite fetches them afresh. Missing from older servers.
   */
  rewrites?: number
  createdAt: number
  updatedAt: number
}

/** A bot as a message names it: its name is kept as it was, for when the bot is gone. */
export interface BotRef {
  id: string
  name: string
}

/**
 * Something said to a bot. Who it is from: the owner; the thread above, handing a subagent its
 * task; a subagent reporting back; an automation handing a run its prompt ('trigger'); a run of
 * one reporting back to the bot's conversation ('automation'); or another bot ('bot').
 */
export interface Said {
  type: 'message'
  role: 'user'
  text: string
  source: 'user' | 'parent' | 'subagent' | 'trigger' | 'automation' | 'bot'
  attachments?: Attachment[]
  /** From another bot: which one. */
  bot?: BotRef
  /** From another bot: it asked to be written back to. Only then may this bot message it in answer. */
  replyWanted?: boolean
  /** From another bot: what this message and the sender's record of it (a 'sent' item) have in common, to find one from the other. */
  key?: string
  /** From another bot: how many messages between bots in a row led to this one, the owner having said nothing in between. */
  chain?: number
  /** From another bot: the `key` of the message it answers, when that message asked this bot for a reply. */
  answers?: string
  /** The owner said it on a call (see Call), and the bot's answer is read out to them. */
  via?: 'call'
  /** Said on a call: what was said on the call just before, for the bot to understand the request. Not shown as part of the message. */
  before?: string
}

/** One thing said on a call, by the owner or by the bot's voice. */
export interface CallLine {
  role: 'user' | 'assistant'
  text: string
}

export type ItemData =
  | Said
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
  /**
   * A message this bot sent to another bot with message_bot, for the owner to read here. It went to
   * the conversation `threadId`, where the message with the same `key` is. `attachments` are the
   * files that went with it: that conversation's copies, each with the `path` it had in this bot's workspace.
   */
  | { type: 'sent'; to: BotRef; threadId: string; text: string; replyWanted: boolean; key: string; attachments?: Attachment[] }
  /**
   * The record of a call that ended, for the owner to read: how long it lasted and what was said.
   * What the owner asked the bot to do on it is in the conversation as messages of its own.
   */
  | { type: 'call'; seconds: number; lines: CallLine[] }

/**
 * A message waiting for a bot. Everything said to a bot (by the owner, another bot, a subagent or a
 * run of an automation reporting back) waits in its thread's queue, and the server lets one in at a time:
 * the bot answers it in a turn of its own before the next goes in.
 */
export interface Queued {
  id: number
  threadId: string
  /** The message as it will go into the conversation. Its files have no path until then: the bot gets its copies when it reads the message. */
  message: Said
  /** The owner asked for it to be read now, ahead of the others, by the bot as it works. */
  now: boolean
  createdAt: number
}

export interface Item {
  id: number
  threadId: string
  data: ItemData
  createdAt: number
}

/**
 * When an automation that goes by the clock runs. Times of day are in the time zone of the computer running OpenKumi.
 * 'daily' runs at `time` ("HH:MM") on the days of the week in `days` (0 is Sunday), every day when it is empty.
 */
export type Schedule =
  | { type: 'once'; at: number }
  | { type: 'daily'; time: string; days: number[] }
  | { type: 'interval'; minutes: number }

/**
 * What an automation that runs "when something changes" looks at. OpenKumi itself, not a model,
 * looks every `every` minutes and starts a run only when what it finds differs from last time.
 * `track` is for a result in JSON that lists items: the objects in a list that have the first field
 * are the items, that field tells them apart, and the others are what counts as an item changing.
 * The run is then told which items are new, updated or gone. Without it, any change counts.
 */
export type Watch = { every: number; track: string[] } & (
  /** One of the bot's superpower tools that only reads, called with the same arguments each time. `app` is the service it belongs to, for display. */
  | { on: 'tool'; tool: string; arguments: Record<string, unknown>; app: string }
  /** A public web address, fetched without a sign-in. */
  | { on: 'page'; url: string }
)

/**
 * What starts an automation: the clock, a change in something it watches, or a call from one of
 * the bot's apps (its webhook) about one of `events`, or about anything when none is named. `app`
 * is the superpower's name, for display.
 */
export type Trigger =
  | { kind: 'time'; schedule: Schedule }
  | { kind: 'watch'; watch: Watch }
  | { kind: 'hook'; hook: { power: string; app: string; events: string[] } }

/** How a watch's latest look went. 'baseline' is a look that only noted where things stand. */
export interface WatchCheck {
  at: number
  outcome: 'baseline' | 'unchanged' | 'changed' | 'failed'
  /** What changed, or why the look failed. */
  detail: string | null
}

/**
 * A prompt a bot is given without being asked: at set times, or when something it watches changes.
 * Each run happens in the background, in a thread of its own beneath the bot's conversation, and
 * what came of it is passed to the conversation for the bot to tell the user. The owner makes
 * automations in the app; bots make them with their tools.
 */
export interface Automation {
  id: string
  /** The bot that does it. */
  botId: string
  title: string
  prompt: string
  trigger: Trigger
  /**
   * What its runs work on, when that is not what its bot runs on. Null follows the bot: whatever
   * the bot runs on at the time.
   */
  runsOn: RunsOn | null
  /** Paused when false. */
  enabled: boolean
  /** Who made it: 'user' for the owner, or the id of the bot that made it. */
  createdBy: string
  /** When it runs next, or for a watch when it looks next. Null when it is paused, will not run again, or waits for its app to call. */
  nextRunAt: number | null
  lastRunAt: number | null
  /** How the last run went. 'missed' when the computer was off or asleep at the time it was due. */
  lastStatus: 'running' | 'completed' | 'failed' | 'stopped' | 'missed' | null
  lastError: string | null
  /** The thread of the last run. */
  lastThreadId: string | null
  /** For a watch: how its latest look went. */
  lastCheck: WatchCheck | null
  createdAt: number
  updatedAt: number
}

/** A message found by searching a bot's conversations, the current one and the archived ones. */
export interface HistoryMatch {
  /** The bot whose conversation it is in. Missing from older servers. */
  botId?: string
  threadId: string
  itemId: number
  /** Who said it: the owner, the bot, a subagent reporting back, a run of an automation reporting back, or another bot (named in `name`). */
  from: 'user' | 'bot' | 'subagent' | 'automation' | 'other'
  /** The other bot's name. */
  name?: string
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
  /** What a new bot runs on. Empty means what the main assistant runs on, model and effort too. */
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
  /** Bots may send each other messages (message_bot), and a new bot may be given a first one. */
  botMessages: boolean
  /** Where the internet reaches this computer's webhook port, such as "https://my-mac.example.ts.net". Empty until the owner gives it. */
  hookAddress: string
  /** How much of a bot's AGENTS.md is loaded into each conversation, in characters. */
  instructionsLimit: number
  /**
   * How long a conversation may get, in tokens (roughly), before its older part is replaced by a
   * summary. For bots on an API or a local model; Claude Code, Codex and Grok look after this themselves.
   */
  historyLimit: number
  /** Write everything Claude Code, Codex and Grok print to the server log. */
  debugEngines: boolean
  /**
   * A server installed on its own fetches a new version by itself and starts it once no bot is
   * working. Off, it only updates when asked. One inside the desktop app updates with the app.
   */
  autoUpdate: boolean
  /**
   * Whether this server tells OpenKumi's makers how it is used and what goes wrong in it
   * (apps/server/src/telemetry.ts). Null until its owner has been asked: nothing is sent before.
   */
  telemetry: boolean | null
  /**
   * The order the bots are listed in, in the sidebar and on the phone: as they were made, the one
   * last talked with first, or the owner's own order (`botOrder`). The same on every device.
   */
  botSort: BotSort
  /** The owner's own order, as bot ids. A bot that is not in it comes after the ones that are, as they were made. */
  botOrder: string[]
}

export type BotSort = 'created' | 'recent' | 'manual'

/** One thing a server sent to OpenKumi's makers, as it was sent. */
export interface TelemetryEvent {
  event: string
  /** When it happened, as an ISO date. */
  at: string
  properties: Record<string, unknown>
}

/** What a server shows its owner about what it sends: its id (null while it sends nothing), what went last (newest first), and how much waits. */
export interface TelemetryReport {
  id: string | null
  sent: TelemetryEvent[]
  waiting: number
}

/** What an app says about itself when it connects, for the server to count which apps are in use. */
export interface AppInfo {
  app: 'desktop' | 'iphone'
  version: string
  os: 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'other'
}

/**
 * What an app records about itself, for the server it is connected to to send (never what a
 * screen shows, only that it was opened). The server has the list of what each may carry
 * (apps/server/src/telemetry-events.ts) and leaves out anything else; a test holds the two together.
 */
export type AppEvent =
  | { event: 'app opened'; first: boolean }
  | { event: 'welcome answered'; choice: 'local' | 'pair' }
  | { event: 'screen opened'; screen: string }
  | { event: 'dictation started' }
  | { event: 'palette used'; picked: PalettePick; typed: boolean }
  | { event: 'bot opened by number' }
  | { event: 'app error'; type: string; position: string }

/** What kind of thing was picked in the desktop app's search (⌘K): never which one. */
export type PalettePick = 'bot' | 'action' | 'place' | 'command' | 'setting' | 'superpower' | 'automation' | 'conversation' | 'message' | 'person'

/** How a server stands with its own updates (apps/server/src/update.ts). */
export interface ServerUpdate {
  /**
   * How this server gets a new version:
   * - `installed`: it was installed on its own (openkumi.ai/install.sh) and can update itself;
   * - `app`: it runs inside the desktop app and is updated with it: asked to update, it has the
   *   app fetch its new version and restart into it, when that app can update itself (`updatable`);
   * - `source`: it runs from the repository, where a new version is fetched with git.
   */
  how: 'installed' | 'app' | 'source'
  /**
   * Whether asking it to update (POST /api/update) does anything: always for one installed on its
   * own, and for one inside a desktop app that updates itself. Missing from older servers, of which
   * only an installed one could be asked.
   */
  updatable?: boolean
  /** The newest version there is, once it has been looked up. The same as the server's own when it is up to date. */
  latest: string | null
  /**
   * The version that is in place and is started next, when that is newer than the one running.
   * Not always `latest`: a newer one still may have come out since, and not have been fetched.
   * Missing from older servers.
   */
  staged?: string | null
  /**
   * - `idle`: nothing is going on;
   * - `checking`: looking up the newest version;
   * - `downloading`: fetching it;
   * - `ready`: the new version is in place, and the server starts it as soon as no bot is working
   *   (inside the desktop app: the app has it, and was asked to restart into it);
   * - `failed`: see `error`.
   */
  state: 'idle' | 'checking' | 'downloading' | 'ready' | 'failed'
  error: string
  /** When the newest version was last looked up, in milliseconds, or 0. */
  checkedAt: number
  /**
   * How many conversations, subagents and runs are at work right now: what a restart would cut off.
   * Inside the desktop app, that is the bots of every server the app runs, since it restarts them all.
   */
  working: number
}

/** Facts about this installation, for the About and Access pages. */
export interface About {
  version: string
  node: string
  platform: string
  port: number
  /** Started with --lan, so the network setting cannot be switched off from the app. */
  lanForced: boolean
  /** The time zone automations keep to, such as "Europe/Berlin". */
  timeZone: string
  /** The port, on this computer only, that takes the calls of webhooks: what a tunnel from the internet points at. */
  hooksPort: number
  /** The number the apps compare with their own (packages/shared/src/protocol.ts). */
  protocol: number
  /**
   * The person whose server this is, by the name they have on its computer ("juan-cruz"): each
   * person there has a server of their own. Missing from servers from before people had names.
   */
  person?: string
  /** The name of the computer it runs on ("mac-mini"), without the network's part. Missing from older servers. */
  computer?: string
  /**
   * Whether this server would send anything to OpenKumi's makers if its owner agreed, and why not
   * when it would not (it runs from its source, say). Only a server that can is asked about.
   * A server from before there was any of this says nothing here.
   */
  telemetry?: { can: boolean; why: string }
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

/**
 * What the bots' models used in one stretch of time, on one provider and model, for one bot. The
 * server counts it as each model reports it (apps/server/src/usage.ts).
 */
export interface UsageRow {
  /** Which stretch of time: its place in `Usage.starts`. */
  at: number
  /** The bot it was for. It may have been deleted since. */
  botId: string
  provider: string
  /** The model as whatever ran it names it ("claude-opus-5-5"), or "default" when it did not say. */
  model: string
  /** The tokens the model was sent, of which `cached` were read from a cache, and the tokens it wrote. */
  input: number
  cached: number
  output: number
  /**
   * What that would have cost at the API's list prices, in US dollars: as the program that ran the
   * model says, or else worked out from a public list of prices. Null when there is no price to go
   * by: a model on this computer, or one the list does not have.
   */
  cost: number | null
}

/** What the bots' models used over the last hours or days: how many tokens, and what they would have cost as API calls. */
export interface Usage {
  /** Divided by the day, or for the last 24 hours by the hour. */
  step: 'hour' | 'day'
  /**
   * Where each stretch begins, oldest first. A day is a date on the calendar of the computer that
   * runs the bots ("2026-11-23"); an hour is a moment ("2026-11-23T14:00:00.000Z").
   */
  starts: string[]
  rows: UsageRow[]
  /** When this server began to count: what was used before is not known. Null when nothing has been counted yet. */
  since: number | null
  /** When the list of prices was last fetched, or null when there is none to go by (the server could not reach it). */
  pricedAt: number | null
}

/** One allowance of a plan: how much of it is used up, and when it starts over. */
export interface UsageLimit {
  /** What it covers, for people: "5-hour session", "Week", "Week, Opus only". */
  label: string
  /** How much of it is used, from 0 to 100. */
  used: number
  /** When it starts over, or null when the provider does not say. */
  resetsAt: number | null
}

/** The limits of the plan a provider is signed in with, as its own program reports them. */
export interface ProviderLimits {
  provider: string
  /** The plan, as far as the program names it: "Max plan". Empty otherwise. */
  plan: string
  limits: UsageLimit[]
  /** Why there are none, when there are none, for people. Empty otherwise. */
  note: string
  checkedAt: number
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
 * A window of a bot's browser. Every thread that browses (the conversation, a subagent, a run of an
 * automation) has one of its own, so sessions running at once never get in each other's way, while all of
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
  /** A login the owner typed in it, which they are asked whether to keep. Not sent by servers from before logins. */
  offer?: LoginOffer | null
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
  /**
   * A bot's id changed from `from` to `bot.id`: the same bot, in the same place in the list. Apps
   * from before this event are sent a bot.delete and a bot.upsert after it, which say as much to them.
   */
  | { type: 'bot.move'; from: string; bot: Bot }
  /** `seq`: the number of the change, from one count for every thread (see AppState.seq). */
  | { type: 'thread.upsert'; thread: Thread; seq: number }
  | { type: 'thread.delete'; id: string; seq: number }
  | { type: 'automation.upsert'; automation: Automation }
  | { type: 'automation.delete'; id: string }
  | { type: 'hook.upsert'; hook: Hook }
  | { type: 'hook.delete'; id: string }
  | { type: 'item.add'; item: Item }
  /** Something already in a conversation was rewritten: a secret that had been written out in it was taken out. */
  | { type: 'item.change'; item: Item }
  /** A message began to wait for a bot, or one that waits changed. */
  | { type: 'queue.upsert'; message: Queued }
  /** A waiting message went into its conversation, or was taken back. */
  | { type: 'queue.remove'; id: number }
  | { type: 'stream.delta'; threadId: string; kind: 'text' | 'reasoning'; delta: string }
  /** `calls` is sent along because whether bots can be called depends on the providers. */
  | { type: 'providers'; providers: ProviderInfo[]; calls: CallsInfo }
  /** The call under way began, changed or ended (null). `error` is why it ended, when it was not hung up. */
  | { type: 'call'; call: Call | null; error?: string }
  /** Something was said on the call: `text` is the next few words, or with `done` the whole of what was just said. */
  | { type: 'call.words'; callId: string; role: 'user' | 'assistant'; text: string; done: boolean }
  | { type: 'settings'; settings: Settings }
  | { type: 'update'; update: ServerUpdate }
  | { type: 'superpowers'; superpowers: Superpower[]; categories: string[] }
  | { type: 'superpower.status'; botId: string; id: string; status: SuperpowerStatus | null }
  | { type: 'files.changed'; botId: string }
  /** A bot's secrets changed: one was added, replaced or removed. */
  | { type: 'secrets.changed'; botId: string }
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
  /**
   * The threads an app keeps a list of: every conversation, and the subagents and runs that are
   * at work or changed in the last hour. Any other is fetched when it is opened.
   */
  threads: Thread[]
  /** The id of the server's database. Change numbers from another database (one started afresh) mean nothing here. */
  database: string
  /** The number of the latest change to any thread. Asked for with `?since=` and this database's id, only what changed after it is sent. */
  seq: number
  /**
   * Present in the answer to `?since=`: `threads` then holds only the threads of the list that
   * changed after that change, and these are the ones removed since.
   */
  removed?: string[]
  automations: Automation[]
  /** The webhooks that are set up, for every bot. */
  hooks: Hook[]
  /** Every message that waits for a bot, oldest first. */
  queue: Queued[]
  providers: ProviderInfo[]
  /** Whether bots can be called. */
  calls: CallsInfo
  /** The call under way, if there is one. */
  call: Call | null
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
  about: About
  update: ServerUpdate
}

