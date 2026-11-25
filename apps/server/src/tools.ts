// Function tools the model can call. Each returns a string that goes back to the model.
import crypto from 'node:crypto'
import type { Bot, ItemData, Thread } from '@openkumi/shared'
import * as agent from './agent.ts'
import { createBot, getBot, listBots, updateBot } from './bots.ts'
import { browserFor, byRef, isWebPage, snapshot } from './browser.ts'
import { serverPorts } from './config.ts'
import { settings } from './settings.ts'
import { engineFor } from './models.ts'
import { serviceTools, superpowerOfTool } from './mcp.ts'
import { track, whereOf } from './telemetry.ts'
import * as db from './db.ts'
import { PAGE_GUIDE, makePage } from './pages.ts'
import * as secrets from './secrets.ts'
import * as automations from './automations.ts'
import { htmlText } from './watch.ts'
import * as ws from './workspace.ts'

export interface ToolContext {
  thread: Thread
  bot: Bot
  signal: AbortSignal
  /** Fires when the owner wants the bot to read a message now: a tool that is only waiting gives way to it. */
  hurry: AbortSignal
  /** The call being carried out, as it is in the conversation: what the owner answers there (a secret typed into its card) finds the tool by it. */
  callId?: string
}

export interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown>
  /** Arguments that are not written into the conversation with the call: a value on its way into the vault. */
  hidden?: string[]
  run(args: Record<string, any>, ctx: ToolContext): Promise<string> | string
}

const MAX_OUTPUT = 40_000

const params = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})
const str = (description: string) => ({ type: 'string', description })

/**
 * The page the thread works in, in its own browser window. A tab showing something other than a web
 * page is off limits. Reading is allowed while the owner has control of the window; acting is not.
 */
async function page(ctx: ToolContext, { leaving = false, reading = false } = {}) {
  const tab = await browserFor(ctx.bot.id).pageFor(ctx.thread.id, ctx.bot.headless, !reading)
  if (!leaving && !isWebPage(tab.url())) throw new Error('This tab is not showing a web page, so it cannot be read. Open a web address with browser_navigate.')
  return tab
}

/**
 * A script of a bot's, made to run only in a page of the site that was checked: where it stops
 * otherwise, with `word`, before anything of the bot's has run. The line in front calls nothing
 * and makes nothing: whatever the script declares further down (a function named Error, say)
 * exists by then, but only what is called is run. And `location` cannot be given another meaning
 * by a script: declaring it stops the whole script before its first line.
 */
/** Among the sites a window's scripts ran on: all of them. No host is written like this. */
const EVERY_SITE = '*'

export const onlyOn = (host: string, script: string, word: string) => `if (location.host !== ${JSON.stringify(host)}) throw ${JSON.stringify(word)};\n${script}`

/** How long browser_ask_user waits for the owner: less than the half hour Claude Code, Codex and Grok wait for a tool. */
const ASK_TIMEOUT = 25 * 60_000

/**
 * OpenKumi's own address, or that of anyone else's server on this computer, whose bots are theirs.
 * A bot holds no key to any of them, so it could not use them; it is kept from even trying.
 */
function isOwnServer(url: URL) {
  const host = url.hostname.replace(/\.$/, '').toLowerCase()
  // Every way of writing "this computer", including IPv6 forms of 127.0.0.1.
  const local = host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || /^127\./.test(host) || /^\[(::1?|::ffff:[0-9a-f:.]+)\]$/.test(host)
  return local && serverPorts().includes(Number(url.port || (url.protocol === 'https:' ? '443' : '80')))
}

const botSummary = (b: Bot) => ({
  id: b.id,
  name: b.name,
  emoji: b.emoji,
  description: b.description,
  provider: b.provider,
  model: b.model || '(provider default)',
})

const listBotsTool: Tool = {
  name: 'list_bots',
  description: "List every one of the user's bots in OpenKumi, yourself among them.",
  parameters: params({}),
  run: (_, ctx) => JSON.stringify(listBots().map((b) => ({ ...botSummary(b), you: b.id === ctx.bot.id })), null, 1),
}

/** How a message to another bot stands, as the bot that sent it is told. */
function delivered({ place, held, bot, sent }: ReturnType<typeof agent.messageBot>, replyWanted: boolean): string {
  const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`
  const where = held
    ? `Delivered, but ${bot.name} was stopped and what waits for it is held back until the user lets it go on. Tell the user.`
    : place
      ? `Delivered. ${bot.name} is busy: your message is ${ordinal(place)} in its queue, and it will read it in turn.`
      : `Delivered. ${bot.name} has started on it.`
  const files = sent.length ? ` When it reads the message, ${bot.name} gets its own copy of ${sent.map((file) => file.path).join(', ')} in its files/inbox/.` : ''
  return `${where}${files} ${replyWanted ? 'Its reply will arrive here as a message from it, which wakes you: end your turn rather than wait.' : `It answers the user in its own conversation, not you.`}`
}

/** Messaging another bot: offered in a bot's own conversation, while the owner has it switched on. Who may be written to when is decided in agent.ts. */
const messageBotTool: Tool = {
  name: 'message_bot',
  description:
    'Send a message to another of the user\'s bots. It goes into that bot\'s own conversation with the user, where the ' +
    'bot reads it in its turn and does what it asks as itself, with its own instructions, files, logins and ' +
    'superpowers. It sees nothing of your conversation and cannot open your files, so the message must stand on its ' +
    'own: send along the files it needs. The user sees it in both conversations.',
  parameters: params(
    {
      bot_id: str('The bot to write to, from the list of the other bots or list_bots'),
      message: str('What you ask of it or tell it, complete in itself'),
      reply_wanted: {
        type: 'boolean',
        description: 'Set it when you need what comes of this: the bot then writes back to you. Without it, it answers the user in its own conversation.',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Files from your workspace to send with the message, by path, e.g. ["files/report.pdf"]: at most 10, 100 MB together. ' +
          'The bot gets a copy of each in its files/inbox/; yours stay as they are.',
      },
    },
    ['bot_id', 'message'],
  ),
  run: (a, ctx) => {
    try {
      return delivered(agent.messageBot(ctx.thread, ctx.bot, a.bot_id, a.message, a.reply_wanted === true, a.files), a.reply_wanted === true)
    } catch (e) {
      if (e instanceof agent.Busy) throw new Error(`${e.message} Try again later, or tell the user.`)
      throw e
    }
  },
}

/**
 * Reaching the owner when they are not looking: offered in a bot's own conversation. What it raises
 * is put on the conversation when the turn is over (agent.raise), and the apps show it beside the bot.
 */
const notifyTool: Tool = {
  name: 'notify_user',
  description:
    'Reach the user about what you say in this turn. They are often not looking when you write: your reply then waits in ' +
    'the conversation, marked as new, until they next look. Call this only when that is not enough, before you ' +
    'write your reply. kind "answer": you cannot go on without their answer, decision or go-ahead, and your reply ' +
    'asks for it; it stays beside your name until they write to you (when what you need is a choice among a few ' +
    'answers, ask with ask_user instead, which tells them by itself). kind "read": there is nothing to answer, but ' +
    'waiting until they next look would cost them something (a meeting moved to this afternoon, a payment that ' +
    'failed, a deadline today). Either way they get a notification with your reason. Never for a routine result, ' +
    'a summary or anything that can wait: a notification sent too often is one they stop reading.',
  parameters: params(
    {
      kind: { type: 'string', enum: ['answer', 'read'], description: '"answer" when you need something from them to go on, "read" when they only need to read it soon' },
      reason: str('What it is about, in a few words, as it shows beside your name and in the notification, e.g. "Which flight to book" or "Design review moved to 3 pm"'),
    },
    ['kind', 'reason'],
  ),
  run: (a, ctx) => {
    if (agent.raise(ctx.thread, a.kind, a.reason).asked) return 'Noted. You asked the user with ask_user in this turn, which already tells them that you need them, with your question.'
    return a.kind === 'answer'
      ? 'Noted. When this turn is over the user is told that you need them, with that reason. Now write your reply, which asks them for it.'
      : 'Noted. When this turn is over the user is told to read what you wrote, with that reason. Now write your reply.'
  },
}

/**
 * Asking the owner something they answer by choosing: offered in a bot's own conversation. The
 * questions are put on the conversation when the turn is over (agent.askOwner), where the apps show
 * them as a card with the options, and the answers come back as the owner's next message.
 */
const askTool: Tool = {
  name: 'ask_user',
  description:
    'Ask the user one to four questions that each have a few likely answers, when you cannot go on, or would have to ' +
    'guess, without their choice: which of several ways to do it, a go-ahead before something that cannot be undone, ' +
    'a detail only they know. They see each question as a card with your options to pick from, can always write an ' +
    'answer of their own, and are told that you need them. Ask everything you need in one call. Asking ends your ' +
    'work for now: after it, end your turn with at most a line saying what you wait for, without repeating the ' +
    'questions, and their answers arrive as their next message. Not for what you can look up or sensibly decide ' +
    'yourself, and not for something to talk over, which you ask in your reply.',
  parameters: params(
    {
      questions: {
        type: 'array',
        description: 'One to four questions, most important first',
        items: {
          type: 'object',
          properties: {
            question: str('The question, complete in itself, e.g. "Which flight should I book?"'),
            header: str('What it is about, in a word or two, shown over the question, e.g. "Flight"'),
            options: {
              type: 'array',
              description:
                'Up to six answers to choose from, each different from the others, the one you would recommend first. ' +
                'Leave out "Other": the user can always write their own. Give none for a question that is only answered in writing, such as a name or a date.',
              items: {
                type: 'object',
                properties: {
                  label: str('The answer in a few words, e.g. "Lufthansa, 9:40"'),
                  description: str('What choosing it means, when the label does not say it all, e.g. "Direct, 212 €, lands 11:05"'),
                },
                required: ['label'],
                additionalProperties: false,
              },
            },
            multiple: { type: 'boolean', description: 'Set it when more than one of the options may be chosen' },
          },
          required: ['question'],
          additionalProperties: false,
        },
      },
    },
    ['questions'],
  ),
  run: (a, ctx) => {
    const all = agent.askOwner(ctx.thread, a.questions)
    const several = all.length > 1
    return (
      `Asked. When this turn is over the user sees your ${several ? `${all.length} questions` : 'question'} as a card with the options, and is told that you need them. ` +
      `End your turn now, with at most a line saying what you wait for: do not repeat the question${several ? 's' : ''} or the options. ` +
      'What they answer arrives as their next message.'
    )
  },
}

/**
 * Creating a bot: the main assistant's, in its conversation, and only on the owner's word. With
 * messages between bots switched on, the new bot can be given a first one to start on.
 */
function createBotTool(firstMessage: boolean): Tool {
  return {
    name: 'create_bot',
    description:
      'Create a new bot. It appears in the app sidebar with its own conversation, workspace and browser profile. ' +
      'Use this only when the user has just asked you for a new bot or persona: it is refused at any other time.' +
      (firstMessage ? ' Give first_message to start the new bot on its work at once.' : ''),
    parameters: params(
      {
        name: str('Short display name'),
        description: str('One line saying what the bot is for, e.g. "Plans trips and books travel". Every other bot is told it, to know what to pass on to it.'),
        instructions: str('What the bot is for and how it should behave. This starts its own instructions file, which it maintains itself from then on.'),
        emoji: str('A single emoji for the sign its mascot holds. Omit it and the new bot chooses its own look and emoji.'),
        ...(firstMessage
          ? {
              first_message: str(
                'A first message to the new bot, which it starts on as soon as it exists, in its own conversation with the user: ' +
                  'what to do first, with everything it needs to know, since it has seen nothing of this conversation. ' +
                  'Omit it and the bot waits for the user.',
              ),
            }
          : {}),
      },
      ['name', 'description', 'instructions'],
    ),
    run: async (a, ctx) => {
      if (!agent.basisOf(ctx.thread).owner) throw new Error('A bot can only be created when the user has just asked you for one. Ask them first.')
      const bot = await createBot({ name: a.name, description: a.description, purpose: a.instructions, emoji: a.emoji }, 'bot')
      const made = `Created bot ${JSON.stringify(botSummary(bot))}`
      const first = firstMessage && typeof a.first_message === 'string' ? a.first_message.trim() : ''
      if (!first) return made
      try {
        agent.messageBot(ctx.thread, ctx.bot, bot.id, first, false)
        return `${made}\nIt has your first message and has started on it, in its own conversation with the user.`
      } catch (e: any) {
        return `${made}\nYour first message did not reach it: ${e?.message ?? e}`
      }
    },
  }
}

/** A bot as it stands after a change: all that update_bot can change. */
const changedSummary = (b: Bot) => ({ ...botSummary(b), effort: b.effort || '(model default)', web_search: b.webSearch, show_browser: !b.headless })

/**
 * Changing a bot, itself among them: the main assistant's, in its conversation, and only on the
 * owner's word, as making one is. Its rules stay the owner's own, and its instructions its own:
 * those it is asked to change with a message.
 */
const updateBotTool: Tool = {
  name: 'update_bot',
  description:
    "Change one of the user's bots, yourself among them: its name, its description, its emoji, the model it runs on and how hard " +
    'that model thinks, its web search, whether its browser window shows. Give only what changes. Use this only when the user has ' +
    'just asked you for the change: it is refused at any other time. How a bot works is in its own instructions, which it keeps ' +
    'itself: to change those, message the bot and ask it to.',
  parameters: params(
    {
      bot_id: str('The bot to change, from the list of the other bots or list_bots; your own id to change yourself'),
      name: str('A new display name'),
      description: str('A new line saying what the bot is for, e.g. "Plans trips and books travel". Every other bot is told it, to know what to pass on to it.'),
      emoji: str('A single emoji for the sign its mascot holds'),
      model: str('The model it is to run on, by name (e.g. "sonnet"), from any engine that is ready. A name that fits no model is answered with the models there are.'),
      effort: str('How hard its model thinks: minimal, low, medium, high, xhigh or max (not every model takes each), or "default" for the model\'s own'),
      web_search: { type: 'boolean', description: "Whether it may use its engine's own web search" },
      show_browser: { type: 'boolean', description: 'Whether its browser window is also shown on the desktop of the computer, from the next time its browser starts' },
    },
    ['bot_id'],
  ),
  run: async (a, ctx) => {
    if (!agent.basisOf(ctx.thread).owner) throw new Error('A bot can only be changed when the user has just asked you to. Ask them first.')
    const bot = getBot(String(a.bot_id ?? ''))
    if (!bot) throw new Error(`No bot with id ${a.bot_id}. Use list_bots to see the bots that exist.`)
    // A model may fill what it does not change with nothing.
    const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
    const patch: Record<string, unknown> = {
      ...(text(a.name) ? { name: text(a.name) } : {}),
      ...(text(a.description) ? { description: text(a.description) } : {}),
      ...(text(a.emoji) ? { emoji: text(a.emoji) } : {}),
      ...(typeof a.web_search === 'boolean' ? { webSearch: a.web_search } : {}),
      ...(typeof a.show_browser === 'boolean' ? { headless: !a.show_browser } : {}),
      ...(await engineFor(bot, a.model, a.effort)),
    }
    // Stopped while the models were being looked up: nothing is changed.
    ctx.signal.throwIfAborted()
    if (!Object.keys(patch).length) throw new Error('Nothing to change: give what changes, such as name or description.')
    const changed = updateBot(bot.id, patch)
    const moved = changed.id === ctx.bot.id && (changed.provider !== bot.provider || changed.model !== bot.model || changed.effort !== bot.effort)
    return `Changed bot ${JSON.stringify(changedSummary(changed))}${moved ? '\nYou work on the new model from your next turn.' : ''}`
  },
}

const filePath = str('Path inside your workspace, e.g. "memory/people.md"')

const fileTools: Tool[] = [
  {
    name: 'list_files',
    description: 'List a folder in your workspace. With no path, lists the top level.',
    parameters: params({
      path: str('Folder to list; omit for the top level'),
      recursive: { type: 'boolean', description: 'Also list everything inside subfolders' },
    }),
    run: (a, ctx) => ws.list(ctx.bot.id, a.path, !!a.recursive),
  },
  {
    name: 'read_file',
    description:
      'Read a text file from your workspace, or the instructions of one of your superpowers (superpowers/<id>/instructions.md). ' +
      'A PDF gives its text, page by page. Long files come back a window of lines at a time.',
    parameters: params(
      {
        path: filePath,
        offset: { type: 'number', description: 'First line to return (default 1)' },
        limit: { type: 'number', description: 'How many lines to return (default 1500)' },
      },
      ['path'],
    ),
    run: (a, ctx) => ws.read(ctx.bot.id, a.path, Number(a.offset) || 1, Number(a.limit) || 1500),
  },
  {
    name: 'write_file',
    description:
      'Create a file in your workspace, or replace one completely. Folders are created as needed. ' +
      'To change part of an existing file, use edit_file.',
    parameters: params({ path: filePath, content: str('The whole content of the file') }, ['path', 'content']),
    run: async (a, ctx) => {
      const path = ws.write(ctx.bot.id, a.path, String(a.content ?? ''))
      await ws.commit(ctx.bot.id, 'bot', `Write ${path}`)
      return `Saved ${path}.`
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace a piece of text in a file in your workspace. old_text must match the file exactly, including ' +
      'whitespace, and appear only once unless replace_all is set.',
    parameters: params(
      {
        path: filePath,
        old_text: str('The exact text to replace'),
        new_text: str('What to put in its place (may be empty)'),
        replace_all: { type: 'boolean', description: 'Replace every occurrence' },
      },
      ['path', 'old_text', 'new_text'],
    ),
    run: async (a, ctx) => {
      const path = ws.edit(ctx.bot.id, a.path, String(a.old_text ?? ''), String(a.new_text ?? ''), !!a.replace_all)
      await ws.commit(ctx.bot.id, 'bot', `Edit ${path}`)
      return `Edited ${path}.`
    },
  },
  {
    name: 'search_files',
    description: 'Find files in your workspace by name or by text they contain (not case-sensitive). Returns matching paths and lines.',
    parameters: params({ query: str('Text to look for'), path: str('Folder to search; omit to search the whole workspace') }, ['query']),
    run: (a, ctx) => ws.search(ctx.bot.id, a.query, a.path),
  },
  {
    name: 'move_file',
    description: 'Move or rename a file or folder in your workspace.',
    parameters: params({ from: str('Current path'), to: str('New path') }, ['from', 'to']),
    run: async (a, ctx) => {
      const moved = ws.move(ctx.bot.id, a.from, a.to)
      await ws.commit(ctx.bot.id, 'bot', `Move ${moved}`)
      return `Moved ${moved}.`
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file, or a folder and everything in it, from your workspace.',
    parameters: params({ path: filePath }, ['path']),
    run: async (a, ctx) => {
      const path = ws.remove(ctx.bot.id, a.path)
      await ws.commit(ctx.bot.id, 'bot', `Delete ${path}`)
      return `Deleted ${path}.`
    },
  },
]

const when = (time: number) => new Date(time).toISOString().slice(0, 16).replace('T', ' ')
const speaker = (data: Extract<ItemData, { type: 'message' }>) =>
  data.role === 'assistant' ? 'you' : data.source === 'user' ? 'user' : data.source === 'automation' ? 'automation report' : data.source === 'bot' ? `message from ${data.bot?.name ?? 'another bot'}` : 'subagent report'

/** The bot's own conversation, as far back as it goes: what is no longer in front of the model can be looked up here. */
const historyTools: Tool[] = [
  {
    name: 'search_history',
    description:
      'Search everything that was said in your conversation with the user (by them, by you, and by other bots that wrote to you), including the parts you can no ' +
      'longer see (summarised, or set aside when the user started fresh). Returns the messages that contain every ' +
      'word of the query, newest first, each with an id for read_history.',
    parameters: params({ query: str('Words to look for, e.g. "dentist appointment"') }, ['query']),
    run: (a, ctx) => {
      const matches = db.searchMessages(ctx.bot.id, String(a.query ?? ''), 20)
      if (!matches.length) return 'Nothing was found. Try fewer or different words.'
      const from = { bot: 'you', user: 'user', subagent: 'subagent report', automation: 'automation report', other: 'another bot' }
      return matches.map((m) => `[${m.itemId}] ${when(m.createdAt)} UTC, ${m.name ? `message from ${m.name}` : from[m.from]}: ${m.snippet}`).join('\n')
    },
  },
  {
    name: 'read_history',
    description: 'Read a stretch of your conversation with the user around one message, by the id search_history gave for it.',
    parameters: params(
      {
        id: { type: 'number', description: 'Message id from search_history' },
        before: { type: 'number', description: 'How many earlier messages to include (default 6, max 30)' },
        after: { type: 'number', description: 'How many later messages to include (default 6, max 30)' },
      },
      ['id'],
    ),
    run: (a, ctx) => {
      const item = db.getItem(Number(a.id))
      const thread = item && db.getThread(item.threadId)
      // Only the bot's own conversations: not another bot's, and not what subagents said among themselves.
      if (!item || !thread || thread.botId !== ctx.bot.id || thread.parentId) throw new Error(`There is no message with id ${a.id} in your conversation. Use search_history.`)
      const count = (v: unknown) => Math.min(Math.max(Number.isFinite(Number(v)) ? Math.round(Number(v)) : 6, 0), 30)
      return db.messagesAround(thread.id, item.id, count(a.before), count(a.after)).flatMap(({ id, data, createdAt }) =>
        data.type === 'message' ? [`[${id}] ${when(createdAt)} UTC, ${speaker(data)}:\n${data.text.slice(0, 6000)}`] : [],
      ).join('\n\n')
    },
  },
]

const spawnTool: Tool = {
  name: 'spawn_subagent',
  description:
    'Start a subagent that works on a task in the background, in parallel with you. Returns immediately with its id. ' +
    'The subagent is you, with the same tools, files and logins, but none of this conversation, so the task must be fully self-contained.',
  parameters: params(
    {
      name: str('Short label shown in the UI, e.g. "Compare prices"'),
      task: str('Complete, self-contained instructions, including what to report back'),
      model: str('Model id override for this subagent'),
    },
    ['name', 'task'],
  ),
  run: (a, ctx) => {
    const child = agent.spawnSubagent(ctx.thread, { task: String(a.task), name: String(a.name), model: a.model })
    return JSON.stringify({ id: child.id, name: child.title, status: 'running' })
  },
}

const subagentTools: Tool[] = [
  {
    name: 'wait_subagents',
    description:
      'Block until subagents finish, then return their final reports. With no ids, waits for all of your subagents ' +
      'whose results you have not received. Subagents still running at the timeout keep running. It also returns ' +
      'early when the user sends a message for you to read now.',
    parameters: params({
      ids: { type: 'array', items: { type: 'string' }, description: 'Subagent ids to wait for' },
      timeout_seconds: { type: 'number', description: 'Maximum time to wait (default 300, max 1800)' },
    }),
    run: (a, ctx) => {
      const seconds = Math.min(Math.max(Number(a.timeout_seconds) || 300, 1), 1800)
      return agent.waitSubagents(ctx.thread, a.ids, seconds * 1000, ctx.signal, ctx.hurry)
    },
  },
  {
    name: 'list_subagents',
    description: 'List the subagents you have spawned in this conversation and their status.',
    parameters: params({}),
    run: (_, ctx) => {
      const children = agent.subagentsOf(ctx.thread)
      if (!children.length) return 'You have not spawned any subagents.'
      return JSON.stringify(children.map((c) => ({ id: c.id, name: c.title, status: agent.subagentStatus(c) })), null, 1)
    },
  },
  {
    name: 'read_subagent',
    description: 'Read the recent activity of one of your subagents (its messages and tool calls) without waiting for it.',
    parameters: params({ id: str('Subagent id') }, ['id']),
    run: (a, ctx) => {
      const child = agent.ownSubagent(ctx.thread, a.id)
      const lines = db.listItems(child.id).slice(-30).flatMap(({ data: d }) => {
        if (d.type === 'message') return [`${d.role}: ${d.text.slice(0, 2000)}`]
        if (d.type === 'function_call') return [`tool call: ${d.name}(${d.arguments.slice(0, 200)})`]
        if (d.type === 'notice') return [`${d.level}: ${d.text}`]
        return []
      })
      return `Status: ${agent.subagentStatus(child)}\n\n${lines.join('\n')}`
    },
  },
  {
    name: 'message_subagent',
    description: 'Send a follow-up message to one of your subagents. It keeps its context; if it had finished, it starts working again, and if it is still at work it reads the message once it is done with what it has.',
    parameters: params({ id: str('Subagent id'), message: str('The message') }, ['id', 'message']),
    run: (a, ctx) => {
      const child = agent.ownSubagent(ctx.thread, a.id)
      const { place } = agent.postMessage(child.id, { source: 'parent', text: String(a.message) })
      db.updateThread(child.id, { reported: false })
      return place ? 'Sent. The subagent reads it once it is done with what it has.' : 'Sent. The subagent is working on it.'
    },
  },
  {
    name: 'cancel_subagent',
    description: 'Stop one of your subagents.',
    parameters: params({ id: str('Subagent id') }, ['id']),
    run: (a, ctx) => {
      const child = agent.ownSubagent(ctx.thread, a.id)
      db.updateThread(child.id, { reported: true })
      agent.stop(child.id)
      return 'Stopped.'
    },
  },
]

// When an automation runs by the clock: exactly one of these, which makes the four kinds of schedule a bot can ask for.
const runsAt = {
  at: str('Run once, at this local date and time, e.g. "2026-11-14 09:30"'),
  in_minutes: { type: 'number', description: 'Run once, this many minutes from now' },
  time: str('Run at this local time of day, "HH:MM" in 24-hour time: every day, or on the given days'),
  days: {
    type: 'array',
    items: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
    description: 'With time: the days of the week to run on. Omit for every day.',
  },
  // automations.ts may not have loaded yet when this does (they reach each other through agent.ts), so its MIN_INTERVAL is written out.
  every_minutes: { type: 'number', description: 'Run again and again, this many minutes apart (at least 5)' },
}

// Or when something changes (a watch), or when one of the bot's apps calls (a hook), in place of a time.
const startsOn = {
  ...runsAt,
  hook: {
    type: 'object',
    description:
      'Instead of a time: run the moment one of your apps calls OpenKumi about something that happened there. Only for an app the user ' +
      'has set a webhook up for; list_automations names those, and what each calls about.',
    properties: {
      app: str('The app, by its superpower id, e.g. "linear"'),
      events: { type: 'array', items: { type: 'string' }, description: 'What to run on, e.g. ["issue.created"]. Omit to run on everything the app calls about.' },
    },
  },
  watch: {
    type: 'object',
    description:
      'Instead of a time: run only when something changes. OpenKumi looks at it every few minutes without you, and starts a run when ' +
      'what it finds differs from the last look. Give tool (with arguments) or url, not both.',
    properties: {
      tool: str('One of your superpower tools that only reads, by its full name, e.g. "mcp__linear__list_issues"'),
      arguments: { type: 'object', description: 'With tool: the arguments to call it with at every look' },
      url: str('A public https address to look at, without a sign-in'),
      track: {
        type: 'array',
        items: { type: 'string' },
        description:
          'When what comes back is JSON that lists items: the field that tells items apart, then up to four fields whose change matters, ' +
          'e.g. ["id", "status"]. The run is then told which items are new, updated or gone. Without it, any change at all starts a run.',
      },
      every_minutes: { type: 'number', description: 'How many minutes apart to look (at least 5; 15 when left out)' },
    },
  },
}

/** Automations. Who may do what is decided in automations.ts, not here. */
const automationTools: Tool[] = [
  {
    name: 'list_automations',
    description:
      'List the automations you can see: the ones you do and the ones you made (the main assistant sees every ' +
      'one). Also gives the date and time now.',
    parameters: params({}),
    run: (_, ctx) => automations.listAs(ctx.bot),
  },
  {
    name: 'create_automation',
    description:
      'Make an automation: a prompt you will be given at a set time, again and again, whenever something you watch ' +
      'changes, or when one of your apps calls. Each run happens in the background, in a thread of its own that sees nothing of this conversation, so ' +
      'the prompt must be self-contained; what came of it is passed to your conversation with the user. Give exactly ' +
      'one of at, in_minutes, time (with days if not every day), every_minutes, watch or hook. Times are the user\'s local time.',
    parameters: params(
      {
        title: str('A short name, e.g. "Morning news brief"'),
        prompt: str('Complete, self-contained instructions for each run, including what to report'),
        ...startsOn,
        model: str(
          'The model each run works on, by name (e.g. "haiku"), when it should not be the model of the bot that does it: a lighter one ' +
            'for a simple check that runs often, a stronger one for hard work, or the one the user asked for. Leave it out and it runs on ' +
            'what that bot runs on, whatever that is at the time. A name that fits no model is answered with the models there are.',
        ),
        effort: str('With model: how hard that model thinks (minimal, low, medium, high, xhigh or max; not every model takes each). Leave it out for the model\'s own.'),
        bot_id: str('The main assistant only: the bot that does it, if not you'),
      },
      ['title', 'prompt'],
    ),
    run: (a, ctx) => automations.createAs(ctx.bot, a),
  },
  {
    name: 'update_automation',
    description:
      'Change an automation you made (the main assistant can change any): its name, its prompt, what starts it or the model it runs on, ' +
      'or pause or resume it. Giving one of at, in_minutes, time, every_minutes, watch or hook replaces what starts it.',
    parameters: params(
      {
        id: str('The automation id, from list_automations'),
        title: str('A new name'),
        prompt: str('New instructions for each run'),
        paused: { type: 'boolean', description: 'true pauses it, false resumes it' },
        ...startsOn,
        model: str('A model for its runs, by name, or "same" to go back to the model of the bot that does it'),
        effort: str('How hard its own model thinks: minimal, low, medium, high, xhigh or max'),
        bot_id: str('The main assistant only: move it to this bot'),
      },
      ['id'],
    ),
    run: (a, ctx) => automations.updateAs(ctx.bot, a),
  },
  {
    name: 'delete_automation',
    description: 'Delete an automation you made (the main assistant can delete any).',
    parameters: params({ id: str('The automation id, from list_automations') }, ['id']),
    run: (a, ctx) => automations.deleteAs(ctx.bot, a.id),
  },
]

/** Puts what the owner did with the bot's window since it last looked before each browser tool's result. */
function withNews(tools: Tool[]): Tool[] {
  return tools.map((tool) => ({
    ...tool,
    run: async (a, ctx) => {
      const output = await tool.run(a, ctx)
      const news = browserFor(ctx.bot.id).news(ctx.thread.id)
      return news ? `${news}\n\n${output}` : output
    },
  }))
}

const browserTools: Tool[] = withNews([
  {
    name: 'browser_navigate',
    description: 'Open a URL in your browser window and return a snapshot of the page.',
    parameters: params({ url: str('Absolute URL') }, ['url']),
    run: async (a, ctx) => {
      const url = /^[a-z][a-z0-9+.-]*:/i.test(a.url) ? String(a.url) : `https://${a.url}`
      if (!isWebPage(url)) throw new Error('Only web addresses (http or https) can be opened.')
      const p = await page(ctx, { leaving: true })
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      return snapshot(p)
    },
  },
  {
    name: 'browser_snapshot',
    description:
      'Return a text outline of the current page. Interactive elements are numbered like [12]; pass that number as ' +
      '`ref` to browser_click / browser_type. Take a fresh snapshot after the page changes.',
    parameters: params({}),
    run: async (_, ctx) => snapshot(await page(ctx, { reading: true })),
  },
  {
    name: 'browser_click',
    description: 'Click an element by its [ref] number from the latest snapshot. Returns a new snapshot.',
    parameters: params({ ref: { type: 'number', description: 'Element ref from the latest snapshot' } }, ['ref']),
    run: async (a, ctx) => {
      const p = await page(ctx)
      await byRef(p, a.ref).click({ timeout: 8000 })
      await p.waitForTimeout(600)
      // A click may have opened a popup, which is where the work goes on.
      return snapshot(await page(ctx, { reading: true }))
    },
  },
  {
    name: 'browser_type',
    description:
      'Replace the contents of an input, textarea or editable element. Set submit to press Enter afterwards. ' +
      'For a password or a key, give secret instead of text: the name of one of your secrets, which is typed without you seeing it.',
    parameters: params(
      {
        ref: { type: 'number', description: 'Element ref from the latest snapshot' },
        text: str('Text to enter'),
        secret: str('Instead of text: the name of one of your secrets. Its value is typed for you, and only into a page of the site the secret is for.'),
        submit: { type: 'boolean', description: 'Press Enter after typing' },
      },
      ['ref'],
    ),
    run: async (a, ctx) => {
      const p = await page(ctx)
      const el = byRef(p, a.ref)
      const bySecret = a.secret != null && a.secret !== ''
      if (bySecret && a.text != null && a.text !== '') throw new Error('Give text or secret, not both.')
      if (!bySecret && a.text == null) throw new Error('Give the text to type, or the name of a secret.')
      if (bySecret) {
        // A secret goes into the very field that was found, in the document whose site was checked. The
        // field is held on to first: if the page goes elsewhere meanwhile, the field is gone and nothing
        // is put anywhere. And the value is set in the field itself, not typed at whatever has the
        // focus: something else on the page (an advertisement in a frame of its own) could take the
        // focus in the moment between.
        const field = await el.elementHandle({ timeout: 8000 })
        const frame = await field.ownerFrame()
        if (!frame) throw new Error('That field is no longer on the page. Take a new snapshot.')
        const where = new URL(frame.url())
        // A script of the bot's that ran on this site in this window may still be there, in this page or in the
        // one that opened it, and would read what is put in.
        const marks = browserFor(ctx.bot.id).marks(ctx.thread.id)
        if (marks.scripted.has(where.host) || marks.scripted.has(EVERY_SITE)) {
          throw new Error(`You ran a script of your own on ${where.host} in this browser window, or in a page that may belong to it, and it could read what is put into the page. A secret is only typed where no script of yours has run: have a subagent do this step, in a window of its own.`)
        }
        const value = await secrets.use(ctx.bot.id, String(a.secret), where)
        // From here on the window has held this secret on this site, whatever becomes of the secret.
        marks.secrets.add(where.host)
        const put = await field
          .evaluate((el, value) => {
            const plain = ['text', 'password', 'email', 'search', 'tel', 'url', 'number']
            if (el instanceof HTMLInputElement && plain.includes(el.type) && !el.disabled && !el.readOnly) Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value)
            else if (el instanceof HTMLTextAreaElement && !el.disabled && !el.readOnly) Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value)
            else if (el instanceof HTMLElement && el.isContentEditable) el.textContent = value
            else return false
            // A field that did not take it as it is (one for numbers, given letters) holds something else now, or nothing.
            if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.value !== value) return false
            el.focus()
            // As if it had been typed: the page hears of it the way it hears of typing.
            el.dispatchEvent(new Event('input', { bubbles: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
            return true
          }, value)
          .catch(() => false)
        if (!put) throw new Error('The secret was not typed: that is not a field text can be put into, or it is no longer on the page.')
        if (!a.submit) return `Typed the secret "${a.secret}".`
        await field.press('Enter')
      } else {
        const text = String(a.text)
        await el.fill(text, { timeout: 8000 }).catch(async () => {
          await el.click({ timeout: 8000 })
          await p.keyboard.type(text)
        })
        if (!a.submit) return 'Typed.'
        await el.press('Enter')
      }
      await p.waitForTimeout(800)
      return snapshot(p)
    },
  },
  {
    name: 'browser_select',
    description: 'Choose an option in a <select> dropdown by its visible label.',
    parameters: params({ ref: { type: 'number', description: 'Ref of the select element' }, option: str('Visible option label') }, ['ref', 'option']),
    run: async (a, ctx) => {
      await byRef(await page(ctx), a.ref).selectOption({ label: String(a.option) }, { timeout: 8000 })
      return 'Selected.'
    },
  },
  {
    name: 'browser_upload',
    description: 'Attach a file from your workspace to a file input on the page (an element shown as input:file in the snapshot).',
    parameters: params({ ref: { type: 'number', description: 'Ref of the file input' }, path: filePath }, ['ref', 'path']),
    run: async (a, ctx) => {
      await byRef(await page(ctx), a.ref).setInputFiles(ws.resolve(ctx.bot.id, a.path).abs, { timeout: 8000 })
      return 'Attached.'
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a key or chord in the page, e.g. "Enter", "Escape", "ArrowDown", "Control+A".',
    parameters: params({ key: str('Key name') }, ['key']),
    run: async (a, ctx) => {
      await (await page(ctx)).keyboard.press(String(a.key))
      return 'Pressed.'
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page up or down, then return a new snapshot.',
    parameters: params({ direction: { type: 'string', enum: ['up', 'down'] }, pages: { type: 'number', description: 'How many screens to scroll (default 1)' } }, ['direction']),
    run: async (a, ctx) => {
      const p = await page(ctx)
      const amount = 700 * (Number(a.pages) || 1) * (a.direction === 'up' ? -1 : 1)
      await p.mouse.move(640, 400)
      await p.mouse.wheel(0, amount)
      await p.waitForTimeout(400)
      return snapshot(p)
    },
  },
  {
    name: 'browser_back',
    description: 'Go back one page in history and return a new snapshot.',
    parameters: params({}),
    run: async (_, ctx) => {
      const p = await page(ctx)
      await p.goBack({ waitUntil: 'domcontentloaded', timeout: 15_000 })
      return snapshot(p)
    },
  },
  {
    name: 'browser_read',
    description: 'Return the full readable text of the current page (no element refs). Best for articles and long documents.',
    parameters: params({}),
    run: async (_, ctx) => {
      const p = await page(ctx, { reading: true })
      const text = await p.evaluate(() => document.body.innerText)
      return `Page: ${await p.title()}\nURL: ${p.url()}\n\n${text.replace(/\n{3,}/g, '\n\n')}`
    },
  },
  {
    name: 'browser_eval',
    description: 'Evaluate a JavaScript expression in the current page and return its JSON-serialised result. For extracting data the snapshot does not show.',
    parameters: params({ expression: str('JavaScript expression') }, ['expression']),
    run: async (a, ctx) => {
      const p = await page(ctx)
      // A script of the bot's own could read a secret out of a page and give it back in another shape, or send it
      // to another site. So none is run on a site one of its secrets is for, nor on one where a secret was put
      // into a page of this window (its owner may have removed it since, and the field still holds it). Nothing
      // of a secret is asked of the page to decide that, only where the page is.
      const where = new URL(p.url())
      const host = where.host
      const marks = browserFor(ctx.bot.id).marks(ctx.thread.id)
      // A page with no address of its own (a blank one another page opened, or one a page made up) counts as the
      // page's that made it: a script in it reaches into that page, and reads that site as one of its own pages
      // would, whichever site it is. So a bot that has secrets, or a window one was put into, runs none there. A
      // data: page is all its own.
      const noAddress = !/^(https?|data):$/.test(where.protocol)
      if (noAddress && (secrets.any(ctx.bot.id) || marks.secrets.size)) {
        throw new Error('This page has no address of its own, so it may belong to a site one of your secrets is for, and no script is run in it. Carry on in it with browser_navigate, or read it with browser_snapshot.')
      }
      if (secrets.anyFor(ctx.bot.id, host) || marks.secrets.has(host)) {
        throw new Error(`One of your secrets is for ${host}, and a script could read it out of a page there, so none is run on that site. Read the page with browser_snapshot or browser_read.`)
      }
      // A script in a page that may be any site's has run on every site, as far as this window can tell.
      marks.scripted.add(noAddress ? EVERY_SITE : host)
      // Where the page is was asked a moment ago, and it may have gone on to another site since (it does so by
      // itself, if a script told it to earlier). So the page says where it is in the same breath as it runs the
      // script, and runs nothing if that is not the site that was checked.
      const moved = `moved-${crypto.randomBytes(9).toString('base64url')}`
      const result = await p.evaluate(onlyOn(host, String(a.expression), moved)).catch((e) => {
        if (String(e?.message ?? e).includes(moved)) throw new Error('The page went on to another address just as the script was to run, so it was not run. Take a new snapshot and try again.')
        throw e
      })
      return JSON.stringify(result, null, 1) ?? 'undefined'
    },
  },
  {
    name: 'browser_ask_user',
    description:
      'Ask the user to take over your browser window for a step only they can do, such as signing in, a CAPTCHA or a ' +
      'two-factor code, and wait until they hand it back. Open the page first, so they start in the right place, and ' +
      'say exactly what you need, e.g. "Sign in to LinkedIn". Returns once they are done or say no.',
    parameters: params({ request: str('What the user should do, in a few words') }, ['request']),
    run: async (a, ctx) => {
      const browser = browserFor(ctx.bot.id)
      const text = String(a.request ?? '').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Help with the browser'
      const outcome = await browser.ask(ctx.thread.id, ctx.bot.headless, text, ctx.signal, ASK_TIMEOUT)
      switch (outcome) {
        case 'done':
          return `The user handed the browser back.\n\n${await snapshot(await page(ctx, { reading: true }))}`
        case 'declined':
          return 'The user said no. Do not ask again for the same thing now; go on without it, or tell them what you needed.'
        case 'left':
          return 'The user took over, then left without handing back (their app closed or lost its connection). Check the page with browser_snapshot before going on.'
        case 'closed':
          return 'The browser window was closed before the user handed it back.'
        case 'timeout':
          return `Nothing came of it in ${ASK_TIMEOUT / 60_000} minutes. End your turn and tell the user what you need; they can take control of your browser in the app.`
        case 'stopped':
          throw new Error('Stopped')
      }
    },
  },
])

const pageTool: Tool = {
  name: 'show_page',
  description: PAGE_GUIDE,
  parameters: params(
    {
      title: str('A short name for the page, e.g. "Spending by month"'),
      html: str('The page: a whole HTML document, or just its body'),
      path: str('Instead of html: an .html file in your workspace'),
      height: { type: 'number', description: 'Roughly how tall the page is in px at 720px wide (it is measured when shown)' },
    },
    ['title'],
  ),
  run: (a, ctx) => {
    const page = makePage(ctx.bot.id, a)
    db.addItem(ctx.thread.id, { type: 'page', title: page.title, html: page.html, height: page.height })
    const missing = page.missing.length ? `\nThese pictures could not be put in (not in your workspace, or too large): ${page.missing.join(', ')}` : ''
    return `Shown “${page.title}” to the user, above your reply. Do not repeat in words what it shows.${missing}`
  },
}

/** The ways web_fetch can ask. */
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
/** Headers a request sets for itself, or that would have it go somewhere other than its address says. */
const NOT_SET = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'expect', 'te', 'trailer', 'keep-alive', 'proxy-authorization', 'proxy-connection'])
/** Headers that say who is asking: they do not follow the request to another site. */
const PERSONAL = new Set(['authorization', 'cookie'])

const webTools: Tool[] = [
  {
    name: 'web_fetch',
    description:
      'Make an HTTP request (no browser) and return what comes back as text: a GET unless you give a method. Faster than the browser for public ' +
      'pages and APIs; use the browser for sites that need JavaScript or a login in a page. For an API that takes a key, write {{secret:name}} ' +
      'where the key goes (in a header, the address or the body), with the name of one of your secrets: its value is put in as the request ' +
      'leaves, and only for the site that secret is for.',
    parameters: params(
      {
        url: str('Absolute http(s) URL'),
        method: { type: 'string', enum: METHODS, description: 'GET unless given' },
        headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Headers to send, such as {"Authorization": "Bearer {{secret:plausible}}"}' },
        body: str('What to send with a POST, PUT or PATCH, as text. For JSON, the JSON itself: it is sent as application/json unless you say otherwise.'),
      },
      ['url'],
    ),
    run: async (a, ctx) => {
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)])
      let method = String(a.method || 'GET').toUpperCase()
      if (!METHODS.includes(method)) throw new Error(`The method is one of ${METHODS.join(', ')}.`)
      const given = a.headers && typeof a.headers === 'object' && !Array.isArray(a.headers) ? Object.entries(a.headers as Record<string, unknown>).map(([name, value]) => [name, String(value ?? '')] as const) : []
      for (const [name] of given) if (NOT_SET.has(name.toLowerCase()) || !/^[\w!#$%&'*+.^`|~-]+$/.test(name)) throw new Error(`The header "${name}" cannot be set.`)
      // A model may give the body as the object it means instead of as text.
      let body = a.body == null || a.body === '' ? undefined : typeof a.body === 'string' ? a.body : JSON.stringify(a.body)
      if (body !== undefined && method === 'GET') throw new Error('A GET sends no body. Give the method, such as POST.')
      const isJson = (text: string) => {
        try {
          return typeof JSON.parse(text) === 'object'
        } catch {
          return false
        }
      }

      // Redirects are followed by hand so that none of them can lead to OpenKumi's own address, or take a secret to a site it is not for.
      let address = String(a.url)
      /** The request left the site it was made to: what says who is asking stays behind. */
      let away = false
      /** A redirect turned the request into one that only reads: what said what its body was goes with the body. */
      let bodiless = false
      let res: Response
      /** The secrets the request has carried so far. An answer may repeat one in the address it sends the request on to, where no name stands for it any more. */
      const used = new Set<string>()
      // In JSON a value is written as JSON writes text, and in a form as a form does, so that one with a quote or an "&" in it arrives whole.
      const kind = (given.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '').toLowerCase()
      const inBody = body !== undefined && (kind.includes('json') || (!kind && isJson(body))) ? (value: string) => JSON.stringify(value).slice(1, -1) : kind.includes('x-www-form-urlencoded') ? encodeURIComponent : undefined
      for (let hops = 0; ; hops++) {
        // Where it goes is read before any secret is in it, and each secret is given for that site only.
        const url = new URL(secrets.withoutPlaces(address))
        if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https addresses can be fetched.')
        if (isOwnServer(url)) throw new Error('That address is OpenKumi itself, which is not available to you.')
        const put = async (text: string, as?: (value: string) => string) => {
          const filled = await secrets.fill(ctx.bot.id, text, url, as)
          for (const name of filled.used) used.add(name)
          return filled.text
        }
        const target = new URL(await put(address, encodeURIComponent))
        if (target.host !== url.host || target.protocol !== url.protocol) throw new Error('A secret cannot be part of the name of the site.')
        const headers = new Headers({ 'User-Agent': 'Mozilla/5.0 (compatible; OpenKumi/0.1)', Accept: 'text/html,application/json,text/plain,*/*' })
        for (const [name, value] of given) {
          const lower = name.toLowerCase()
          if ((away && PERSONAL.has(lower)) || (bodiless && lower === 'content-type')) continue
          const filled = await put(value)
          // Said here, without the value: what fetch says of a header it cannot send repeats the header.
          if (/[^\t\x20-\x7e\x80-\xff]/.test(filled)) throw new Error(`The header "${name}" cannot be sent: its value has a line break or a character a header cannot hold.`)
          headers.set(name, filled)
        }
        const sent = body === undefined ? undefined : await put(body, inBody)
        if (sent !== undefined && !headers.has('content-type') && isJson(sent)) headers.set('Content-Type', 'application/json')
        res = await fetch(target, { method, headers, body: sent, signal, redirect: 'manual' })
        const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
        if (!next) break
        if (hops >= 8) throw new Error('Too many redirects.')
        const to = new URL(next, target)
        // Only the bot names a secret, in what it wrote itself. An answer that sends the request on to an address
        // with a secret's name in it would have that secret put in where the bot never asked for it.
        if (secrets.withoutPlaces(to.href) !== to.href) throw new Error(`${target.host} sent the request on to an address that names one of your secrets, which only you do, so it was not followed.`)
        const leaves = to.host !== target.host || to.protocol !== target.protocol
        // A secret goes to the site it is for and no further, whatever that site answers.
        if (used.size && leaves) {
          throw new Error(`${target.host} sent the request on to ${to.host}, which ${[...used].map((name) => `"${name}"`).join(' and ')} ${used.size > 1 ? 'are' : 'is'} not for, so it was not followed.`)
        }
        away ||= leaves
        // As a browser does: after "see other", and after a POST that was moved, the next request only reads.
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
          method = 'GET'
          bodiless = body !== undefined
          body = undefined
        }
        address = to.href
      }
      let text = await res.text()
      if ((res.headers.get('content-type') ?? '').includes('html')) text = htmlText(text)
      // The address as the bot wrote it: with the names of its secrets, not their values.
      return `HTTP ${res.status} ${address}\n\n${text.trim()}`
    },
  },
]

/** How ask_secret and save_secret take a name and a site: as they will be kept, so that the card the owner sees says what is kept. */
function named(a: Record<string, any>): { name: string; site: string; what: string } {
  const name = secrets.nameOf(a.name)
  if (name !== a.name) throw new Error(`Give the name as it will be kept: "${name}".`)
  const site = secrets.siteOf(a.site)
  if (site !== a.site) throw new Error(`Give the site as its host alone: "${site}".`)
  const what = String(a.what ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (!what) throw new Error('Say what it is, in a few words, such as "Plausible API key".')
  return { name, site, what }
}

const SECRET_PARAMS = {
  name: str('A short name to use it by: lower-case letters, digits and "-", such as "plausible" or "github-password"'),
  site: str('The one site it is for, as its host: "plausible.io". It is never sent anywhere else, and only the user can change that.'),
  what: str('What it is, in a few words: "Plausible API key"'),
}

/** Only in the bot's conversation with its owner, who reads it: nobody watches a subagent or a run of an automation. */
const askSecretTool: Tool = {
  name: 'ask_secret',
  description:
    'Ask the user for a secret you need and do not have: an API key, a password, a token. They type it into a private card in the conversation. ' +
    'It goes straight into your vault, encrypted, without passing through this conversation, and you do not see it: afterwards you use it by its name. ' +
    'Say what you need and where they find it. It waits until they have entered it or said no. Never ask for a secret to be written in a message.',
  parameters: params(
    {
      ...SECRET_PARAMS,
      where: str('A web address where the user makes or finds it, if you know one: the card links to it'),
      replace: { type: 'boolean', description: 'Set it to ask again for one you have, because it no longer works: what the user types takes its place, and the card says so' },
    },
    ['name', 'site', 'what'],
  ),
  run: async (a, ctx) => {
    const { name, site, what } = named(a)
    if (a.where != null && a.where !== '' && !/^https?:\/\//i.test(String(a.where))) throw new Error('where is a web address that begins with https://, or is left out.')
    if (!ctx.callId) throw new Error('This cannot be asked from here.')
    // What the user types would take the place of the one there is, which may be kept nowhere else: only when that is meant, and said on the card.
    if (a.replace !== true && secrets.has(ctx.bot.id, name)) {
      throw new Error(`You already have a secret named "${name}". Use it, or pick another name. If it no longer works, ask again with replace set to true: what the user types then takes its place.`)
    }
    if (a.replace === true && !secrets.has(ctx.bot.id, name, true)) throw new Error(`You have no secret named "${name}" to replace. Ask for it without replace.`)
    const outcome = await secrets.ask(ctx.callId, { botId: ctx.bot.id, name, site, what, replace: a.replace === true }, ctx.signal, ctx.hurry, ASK_TIMEOUT)
    switch (outcome) {
      case 'saved':
        return `Saved as "${name}", for ${site}. Use it by name: {{secret:${name}}} in web_fetch, or secret: "${name}" in browser_type.`
      case 'declined':
        return 'The user said no. Do not ask again for the same thing now; go on without it, or tell them what you needed.'
      case 'hurried':
        return 'Not entered: the user sent a message for you to read now instead. Read it, and ask again only if it is still needed.'
      case 'timeout':
        return `Nothing was entered in ${ASK_TIMEOUT / 60_000} minutes. End your turn and tell the user what you need; they can add it themselves in your settings, under Secrets, or you can ask again when they are back.`
      case 'stopped':
        throw new Error('Stopped')
    }
  },
}

const saveSecretTool: Tool = {
  name: 'save_secret',
  description:
    'Keep a secret in your vault, encrypted, to use later by its name. Give value for one you have in front of you, such as a key a page showed you. ' +
    'Leave value out to have a strong password made up that you never see, for signing up somewhere: type it with browser_type and its name. ' +
    'For a secret only the user has, use ask_secret. You cannot replace or delete a secret: the user does that, in your settings.',
  parameters: params(
    {
      ...SECRET_PARAMS,
      value: str('The value to keep. Leave it out to have a password made up.'),
      length: { type: 'number', description: 'For a made-up password: how many characters, 24 unless the site wants otherwise' },
    },
    ['name', 'site', 'what'],
  ),
  hidden: ['value'],
  run: (a, ctx) => {
    const { name, site } = named(a)
    const made = a.value == null || a.value === ''
    const value = made ? secrets.generate(a.length) : String(a.value)
    try {
      // What it is said to be goes as the bot wrote it: the value is taken out of it before it is tidied up.
      secrets.save(ctx.bot.id, { name, sites: [site], value, what: a.what, by: 'bot' })
    } catch (e: any) {
      if (/already a secret/.test(String(e?.message))) throw new Error(`${e.message} Pick another name: only the user replaces or removes one, in your settings under Secrets.`)
      throw e
    }
    if (made) return `Made up a password and kept it as "${name}", for ${site}. Type it with browser_type and secret: "${name}". The user can see it in your settings, under Secrets.`
    // Where it was written out before now (a page that showed it, a message it was pasted into), it is taken out:
    // in this thread, and in the ones above it, since a subagent is told what it knows by the conversation it works for.
    const { heads, take } = secrets.eraser(value, name)
    let rewritten = 0
    for (let thread: Thread | undefined = ctx.thread; thread; thread = thread.parentId ? db.getThread(thread.parentId) : undefined) rewritten += db.rewriteItems(thread.id, heads, take)
    return (
      `Kept as "${name}", for ${site}. From now on use it by name ({{secret:${name}}} in web_fetch, secret: "${name}" in browser_type) and do not write the value anywhere.` +
      (rewritten ? ' Where it stood earlier in this conversation, its name stands now.' : '')
    )
  },
}

/**
 * What a bot has when it answers something asked on a call (see calls.ts), out of what it has
 * otherwise. On a call a bot only passes work on, so that the call stays free and nothing is done
 * on the strength of a few spoken words alone: to another bot, to a subagent of its own, which
 * works in the background with all its tools, or to a later time, as an automation. It reads no
 * file, opens no page and uses none of its apps there. Waiting for a subagent is left out too:
 * its result comes back by itself, and is said on the call then.
 */
const ON_A_CALL = new Set([
  'list_bots', 'message_bot', 'create_bot', 'update_bot',
  'spawn_subagent', 'list_subagents', 'read_subagent', 'message_subagent', 'cancel_subagent',
  'list_automations', 'create_automation', 'update_automation', 'delete_automation',
])

/**
 * What bots passed on from turns that answered a call, and when: a subagent or an automation by
 * its id, a message to another bot as "message:<its key>". A call says only what comes back from
 * these (calls.ts), so that nothing else that reaches a conversation meanwhile is said, or sent
 * to the speech model.
 */
const passedOn = new Map<string, number>()
/** When it was passed on, or 0 if it was not. */
export const passedOnAt = (what: string) => passedOn.get(what) ?? 0

function note(what: string) {
  const now = Date.now()
  // No call lasts a day.
  for (const [key, at] of passedOn) if (now - at > 24 * 3600_000) passedOn.delete(key)
  passedOn.set(what, now)
}

/**
 * The tools a bot has for a turn that answers a call, out of all of its tools, each noting what
 * it passes on. An automation made or changed there is one that starts at a time: setting up a
 * watch, or turning one on again or moving it, looks at a page or calls one of the bot's apps
 * then and there, and one that starts when an app calls is tied to that app. Those are work for
 * a subagent.
 */
export function onACall(tools: Tool[]): Tool[] {
  return tools
    .filter((tool) => ON_A_CALL.has(tool.name))
    .map((tool) => ({
      ...tool,
      run: async (a, ctx) => {
        const automation = tool.name === 'create_automation' || tool.name === 'update_automation'
        if (automation) {
          const existing = tool.name === 'update_automation' ? db.getAutomation(String(a.id)) : undefined
          // Given as automations.ts takes it: a model may fill what it does not use with nothing.
          const given = (value: unknown) => value != null && value !== ''
          if (given(a.watch) || given(a.hook) || (existing && existing.trigger.kind !== 'time')) {
            throw new Error('On a call an automation can only be made or changed when it starts at a time. Have a subagent see to one that starts on a watch or when an app calls.')
          }
        }
        const running = tool.run(a, ctx)
        // message_bot has done its work by the time it returns, so the newest record of a message in the conversation
        // is this one's, whatever else is called in the same moment. The reply will name its key.
        const sent = tool.name === 'message_bot' ? db.pageOf(ctx.thread.id).items.findLast(({ data }) => data.type === 'sent')?.data : undefined
        const output = await running
        if (tool.name === 'spawn_subagent') note(String(JSON.parse(output).id))
        // One that had finished starts again, and reports again.
        else if (tool.name === 'message_subagent') note(String(a.id))
        else if (sent?.type === 'sent') note(`message:${sent.key}`)
        else if (automation) {
          const id = tool.name === 'update_automation' ? String(a.id) : /"id":\s*"([^"]+)"/.exec(output)?.[1]
          if (id) note(id)
        }
        return output
      },
    }))
}

/** Everything a thread's bot can call right now, and why any of its superpowers' services cannot be used. */
export async function toolsFor(thread: Thread): Promise<{ tools: Tool[]; problems: Record<string, string> }> {
  const canSpawn = agent.depthOf(thread) < settings().maxDepth
  const services = await serviceTools(thread.botId)
  // Nobody watches a run of an automation, so there is nobody to ask to take over its browser.
  const browsing = thread.kind === 'automation' ? browserTools.filter((t) => t.name !== 'browser_ask_user') : browserTools
  const bot = getBot(thread.botId)
  const botTools = [
    listBotsTool,
    // Only the main assistant makes and changes bots, and only in its conversation with the owner: never from a subagent or a run of an automation.
    ...(bot && thread.kind === 'chat' && automations.isMain(bot) ? [createBotTool(settings().botMessages), updateBotTool] : []),
    ...(agent.canMessage(thread) ? [messageBotTool] : []),
  ]
  // Only its own conversation is the owner's to read: a subagent and a run of an automation report to it.
  const reaching = thread.kind === 'chat' ? [notifyTool, askTool] : []
  const secretTools = [...(thread.kind === 'chat' ? [askSecretTool] : []), saveSecretTool]
  const own = [...botTools, ...fileTools, ...historyTools, ...(canSpawn ? [spawnTool, ...subagentTools] : []), ...automationTools, ...browsing, ...webTools, ...secretTools, pageTool, ...reaching]
  return { tools: [...own, ...services.tools], problems: services.problems }
}

/**
 * A call as it is written into the conversation: without the arguments its tool keeps out of it
 * (`hidden`). The tool itself is given the call as the model made it.
 */
export function asRecorded<T extends { name: string; arguments: string }>(tools: Tool[], call: T): T {
  const hidden = tools.find((t) => t.name === call.name)?.hidden
  if (!hidden?.length) return call
  let args: Record<string, unknown>
  try {
    args = JSON.parse(call.arguments || '{}')
  } catch {
    // Not read as arguments, so what is in it cannot be told apart: none of it is kept.
    return { ...call, arguments: '{}' }
  }
  if (!args || typeof args !== 'object' || !hidden.some((name) => args[name] != null && args[name] !== '')) return call
  for (const name of hidden) if (args[name] != null && args[name] !== '') args[name] = '[not written here]'
  return { ...call, arguments: JSON.stringify(args) }
}

export async function runTool(tools: Tool[], call: Extract<ItemData, { type: 'function_call' }>, ctx: ToolContext): Promise<string> {
  const tool = tools.find((t) => t.name === call.name)
  if (!tool) return `Error: there is no tool named "${call.name}".`
  let args: Record<string, any>
  try {
    args = JSON.parse(call.arguments || '{}')
  } catch {
    return 'Error: the tool arguments were not valid JSON.'
  }
  // Whatever goes back to the bot, and so into the conversation, has the values of its secrets taken out: a
  // page that shows the key it was sent, a field that still holds a password, an error that repeats one.
  try {
    const output = secrets.scrub(ctx.bot.id, await tool.run(args, { ...ctx, callId: call.call_id }))
    return output.length > MAX_OUTPUT ? output.slice(0, MAX_OUTPUT) + '\n… [output truncated]' : output
  } catch (e: any) {
    if (ctx.signal.aborted) return 'Error: stopped by the user.'
    // Which tool, and where in the code: a superpower's tool is named only by its superpower.
    const superpower = superpowerOfTool(ctx.bot.id, tool.name)
    track('tool failed', superpower ? { tool: 'service', superpower, error: whereOf(e) } : { tool: tool.name, error: whereOf(e) })
    return secrets.scrub(ctx.bot.id, `Error: ${String(e?.message ?? e).split('\n').slice(0, 4).join('\n')}`)
  }
}
