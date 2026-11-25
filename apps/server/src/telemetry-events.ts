// Everything the server can tell OpenKumi's makers, and nothing else: the events, when each is
// recorded, and what each carries. telemetry.ts records and sends them and checks every value
// against this list; the page in the docs is written from it (apps/docs/scripts/telemetry.mjs),
// which is why nothing else is in this file and it starts nothing.

/**
 * What a value may be: one of the choices listed; a whole number; yes or no; a version of
 * OpenKumi; a name from OpenKumi's own code or catalog (never one a person chose); or several such names.
 */
export type Kind = readonly string[] | 'count' | 'flag' | 'version' | 'name' | 'names'
export interface Carried {
  is: Kind
  what: string
}
export interface Spec {
  when: string
  carries: Record<string, Carried>
  /**
   * Recorded by an app about itself, and handed to the server it is connected to, which checks it
   * like any other event and sends it. The apps send nothing on their own.
   */
  from?: 'app'
}

export const ENGINES = ['codex', 'claude-code', 'grok', 'local', 'openai-compatible', 'other'] as const
/** What starts an automation: the clock, a change in something it watches, or a webhook. */
const TRIGGERS = ['time', 'watch', 'hook'] as const

/**
 * The screens of the two apps, by the names they have in the code: the desktop app's welcome,
 * chat, automations, browser and pages of settings, and the phone app's routes (apps/mobile/app,
 * where "[botId]" stands for whichever bot: the bot itself is never named).
 */
export const SCREENS = [
  'welcome', 'chat', 'automations', 'usage', 'browser',
  ...['profile', 'general', 'appearance', 'chat', 'providers', 'bots', 'superpowers', 'prompt', 'browser', 'environments', 'advanced', 'privacy', 'about'].map((page) => `settings/${page}`),
  'home', 'pair', 'scan', 'telemetry', 'picture', 'call', 'chat/[id]', 'browser/[botId]', 'model/[botId]', 'automations/[id]', 'automations/prompt',
  'settings', 'settings/server', 'settings/new-bots', 'settings/usage','settings/bot/[botId]', 'settings/look/[botId]', 'settings/voice/[botId]',
  'superpowers/[botId]', 'superpowers/[botId]/[id]', 'superpowers/[botId]/[id]/file', 'superpowers/[botId]/[id]/files', 'superpowers/[botId]/[id]/problem', 'superpowers/[botId]/[id]/sign-in',
  'workspace/[botId]', 'workspace/[botId]/change', 'workspace/[botId]/changes', 'workspace/[botId]/file', 'workspace/[botId]/folder',
  'other',
] as const

/** Sent with every event an app recorded, besides what is sent with every event. */
export const FROM_APP = {
  app: { is: ['desktop', 'iphone', 'other'], what: 'Which app.' },
  app_version: { is: 'version', what: 'The version of the app.' },
  app_os: { is: ['macos', 'windows', 'linux', 'ios', 'android', 'other'], what: 'What the app runs on.' },
} as const satisfies Record<string, Carried>

/** Sent with every event. */
export const ALWAYS = {
  version: { is: 'version', what: 'The version of OpenKumi the server is.' },
  how: { is: ['app', 'installed', 'source'], what: 'How the server runs: inside the desktop app, installed on its own, or from its source.' },
  os: { is: ['darwin', 'linux', 'win32', 'other'], what: 'The kind of computer: a Mac, Linux or Windows.' },
  arch: { is: ['arm64', 'x64', 'other'], what: 'The kind of processor.' },
} as const satisfies Record<string, Carried>

export const EVENTS = {
  'server started': {
    when: 'Each time the server starts.',
    carries: {
      updated_from: { is: 'version', what: 'The version it ran as before, when this start is the first of a new one.' },
    },
  },
  'daily summary': {
    when: 'Once a day, and when the server starts on a day it has not sent one.',
    carries: {
      bots: { is: 'count', what: 'How many bots there are.' },
      conversations: { is: 'count', what: 'How many conversations there are.' },
      automations_time: { is: 'count', what: 'How many automations run at set times.' },
      automations_watch: { is: 'count', what: 'How many automations watch something.' },
      automations_hook: { is: 'count', what: 'How many automations are started by a webhook.' },
      superpowers: { is: 'names', what: 'Which superpowers of the catalog are switched on for at least one bot.' },
      engines: { is: 'names', what: 'Which engines the bots run on.' },
      paired: { is: 'count', what: 'How many other computers and phones are paired.' },
      lan: { is: 'flag', what: 'Whether other computers on the network may connect.' },
      public_address: { is: 'flag', what: 'Whether an address for webhooks has been set. The address itself is not sent.' },
    },
  },
  'app connected': {
    when: 'When an app connects, at most once a day for each app.',
    carries: {
      app: { is: ['desktop', 'iphone', 'other'], what: 'Which app.' },
      app_version: { is: 'version', what: 'The version of the app.' },
      app_os: { is: ['macos', 'windows', 'linux', 'ios', 'android', 'other'], what: 'What the app runs on.' },
      local: { is: 'flag', what: 'Whether the app is on the same computer as the server.' },
    },
  },
  'message sent': {
    when: 'When a bot is given something to read.',
    carries: {
      from: { is: ['user', 'parent', 'subagent', 'trigger', 'automation', 'bot'], what: 'Who it is from: you, a bot handing work to a subagent, a subagent reporting back, an automation starting or reporting, or another bot.' },
      engine: { is: ENGINES, what: 'The engine the bot runs on.' },
      attachments: { is: 'count', what: 'How many files came with it.' },
      on_call: { is: 'flag', what: 'Whether it was said on a call.' },
    },
  },
  'run finished': {
    when: 'When a bot has worked through what was waiting for it.',
    carries: {
      engine: { is: ENGINES, what: 'The engine the bot runs on.' },
      outcome: { is: ['done', 'stopped', 'failed'], what: 'Whether it finished, was stopped, or failed.' },
      seconds: { is: 'count', what: 'How long it took.' },
      steps: { is: 'count', what: 'How many times the model was asked.' },
      error: { is: 'name', what: 'When it failed: the place in OpenKumi’s code where it did, such as “src/agent.ts:turn”.' },
    },
  },
  'tokens used': {
    when: 'When a bot has worked through what was waiting for it, once for each model it used.',
    carries: {
      engine: { is: ENGINES, what: 'The engine the bot runs on.' },
      model: { is: 'name', what: 'The model, as its maker names it, such as “claude-opus-5-5”. For a local model, or one reached at an address you gave, only “local” or “other”: what such a model is called is yours.' },
      input_tokens: { is: 'count', what: 'How many tokens the model was sent, as whatever runs it counts them.' },
      cached_tokens: { is: 'count', what: 'How many of those were read from a cache.' },
      output_tokens: { is: 'count', what: 'How many tokens the model wrote.' },
      total_tokens: { is: 'count', what: 'The two together: what it was sent and what it wrote.' },
    },
  },
  'tool failed': {
    when: 'When a tool a bot called came back with an error.',
    carries: {
      tool: { is: 'name', what: 'The tool, when it is one of OpenKumi’s own. For a tool of a superpower, only “service”.' },
      superpower: { is: 'name', what: 'For a tool of a superpower: which superpower of the catalog.' },
      error: { is: 'name', what: 'The place in OpenKumi’s code where it failed.' },
    },
  },
  'bot created': {
    when: 'When a bot is made.',
    carries: {
      by: { is: ['user', 'bot', 'server'], what: 'Whether you made it, a bot did, or it is the first bot, which the server makes itself.' },
      engine: { is: ENGINES, what: 'The engine it runs on.' },
    },
  },
  'bot deleted': { when: 'When a bot is deleted.', carries: {} },
  'superpower switched': {
    when: 'When a superpower is switched on or off for a bot.',
    carries: {
      superpower: { is: 'name', what: 'Which superpower of the catalog.' },
      on: { is: 'flag', what: 'On or off.' },
    },
  },
  'automation created': {
    when: 'When an automation is made.',
    carries: {
      trigger: { is: TRIGGERS, what: 'What starts it: the clock (“time”), a change in something it watches, or a webhook (“hook”).' },
      by: { is: ['user', 'bot'], what: 'Whether you made it or a bot did.' },
    },
  },
  'automation ran': {
    when: 'When a run of an automation is over.',
    carries: {
      trigger: { is: TRIGGERS, what: 'What started it: the clock (“time”), a change in something it watches, or a webhook (“hook”).' },
      outcome: { is: ['done', 'failed'], what: 'Whether it finished or failed.' },
    },
  },
  'call ended': {
    when: 'When a call with a bot is over.',
    carries: {
      seconds: { is: 'count', what: 'How long it lasted.' },
      failed: { is: 'flag', what: 'Whether it ended because something went wrong.' },
    },
  },
  'browser taken over': { when: 'When you take control of a bot’s browser window.', carries: {} },
  'app opened': {
    from: 'app',
    when: 'When an app is opened, once it has reached a server.',
    carries: {
      first: { is: 'flag', what: 'Whether it is the first time the app was opened on that computer or phone.' },
    },
  },
  'welcome answered': {
    from: 'app',
    when: 'When a way to start is chosen on the app’s welcome.',
    carries: {
      choice: { is: ['local', 'pair'], what: 'Running the bots on this computer, or pairing with another one.' },
    },
  },
  'screen opened': {
    from: 'app',
    when: 'The first time a screen is opened each time the app runs.',
    carries: {
      screen: { is: SCREENS, what: 'Which screen, by its name in the code. Never which bot or conversation it shows.' },
    },
  },
  'dictation started': { from: 'app', when: 'When the microphone is pressed to dictate a message. What is said stays on the device.', carries: {} },
  'palette used': {
    from: 'app',
    when: 'When something is picked in the desktop app’s search (⌘K).',
    carries: {
      picked: { is: ['bot', 'action', 'place', 'command', 'setting', 'superpower', 'automation', 'conversation', 'message', 'person'], what: 'What kind of thing was picked. Never which one, nor what was typed.' },
      typed: { is: 'flag', what: 'Whether something was typed to find it.' },
    },
  },
  'bot opened by number': { from: 'app', when: 'When ⌘1–9 (Ctrl+1–9) opens one of the first nine bots in the desktop app.', carries: {} },
  'app error': {
    from: 'app',
    when: 'When something goes wrong in an app, at most ten times each time the app runs.',
    carries: {
      type: { is: 'name', what: 'The kind of error, such as “TypeError”.' },
      position: { is: 'name', what: 'Where in the app’s own program it happened: the file, line and column, such as “index-B7xk.js:12:3401”. Not the error’s message.' },
    },
  },
  $exception: {
    when: 'When something goes wrong in the server: a run fails, something in the background fails, or the server crashes (sent the next time it starts).',
    carries: {
      where: { is: ['run', 'background', 'crash'], what: 'What failed: a bot’s run, something the server does in the background, or the server itself.' },
      error: { is: 'name', what: 'The place in OpenKumi’s code where it failed.' },
      type: { is: 'name', what: 'The kind of error, such as “TypeError”.' },
      frames: { is: 'names', what: 'The trail through OpenKumi’s own code that led there: file, function and line. Not the error’s message, and nothing from outside OpenKumi’s code.' },
    },
  },
} as const satisfies Record<string, Spec>
