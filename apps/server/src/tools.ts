// Function tools the model can call. Each returns a string that goes back to the model.
import type { Bot, ItemData, Thread } from '@openbot/shared'
import * as agent from './agent.ts'
import { createBot, listBots } from './bots.ts'
import { browserFor, byRef, isWebPage, snapshot } from './browser.ts'
import { PORT } from './config.ts'
import { settings } from './settings.ts'
import { serviceTools } from './mcp.ts'
import * as db from './db.ts'
import { PAGE_GUIDE, makePage } from './pages.ts'
import * as tasks from './tasks.ts'
import * as ws from './workspace.ts'

export interface ToolContext {
  thread: Thread
  bot: Bot
  signal: AbortSignal
}

export interface Tool {
  name: string
  description: string
  parameters: Record<string, unknown>
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

/** How long browser_ask_user waits for the owner: less than the half hour Claude Code, Codex and Grok wait for a tool. */
const ASK_TIMEOUT = 25 * 60_000

/** Open Bot's own address. Requests from this computer are trusted like the owner, so a bot must never make one. */
function isOwnServer(url: URL) {
  const host = url.hostname.replace(/\.$/, '').toLowerCase()
  // Every way of writing "this computer", including IPv6 forms of 127.0.0.1.
  const local = host === 'localhost' || host.endsWith('.localhost') || host === '0.0.0.0' || /^127\./.test(host) || /^\[(::1?|::ffff:[0-9a-f:.]+)\]$/.test(host)
  return local && (url.port || (url.protocol === 'https:' ? '443' : '80')) === String(PORT)
}

const botSummary = (b: Bot) => ({
  id: b.id,
  name: b.name,
  emoji: b.emoji,
  description: b.description,
  provider: b.provider,
  model: b.model || '(provider default)',
})

const botTools: Tool[] = [
  {
    name: 'list_bots',
    description: 'List every bot that exists in this Open Bot installation, including yourself.',
    parameters: params({}),
    run: (_, ctx) => JSON.stringify(listBots().map((b) => ({ ...botSummary(b), you: b.id === ctx.bot.id })), null, 1),
  },
  {
    name: 'create_bot',
    description:
      'Create a new bot. It appears in the app sidebar with its own conversation, workspace and browser profile. ' +
      'Use this when the user asks for a new bot or persona.',
    parameters: params(
      {
        name: str('Short display name'),
        description: str('One line saying what the bot is for, e.g. "Plans trips and books travel". Every other bot is told it, to know when to hand it work.'),
        instructions: str('What the bot is for and how it should behave. This starts its own instructions file, which it maintains itself from then on.'),
        emoji: str('A single emoji for the sign its mascot holds. Omit it and the new bot chooses its own look and emoji.'),
        model: str('Model id. Omit to use the provider default.'),
      },
      ['name', 'description', 'instructions'],
    ),
    run: async (a, ctx) => {
      const bot = await createBot({ name: a.name, description: a.description, purpose: a.instructions, emoji: a.emoji, model: a.model, provider: ctx.bot.provider })
      return `Created bot ${JSON.stringify(botSummary(bot))}`
    },
  },
]

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
  data.role === 'assistant' ? 'you' : data.source === 'user' ? 'user' : data.source === 'task' ? 'scheduled task report' : 'subagent report'

/** The bot's own conversation, as far back as it goes: what is no longer in front of the model can be looked up here. */
const historyTools: Tool[] = [
  {
    name: 'search_history',
    description:
      'Search everything that was said between you and the user, including the parts of the conversation you can no ' +
      'longer see (summarised, or set aside when the user started fresh). Returns the messages that contain every ' +
      'word of the query, newest first, each with an id for read_history.',
    parameters: params({ query: str('Words to look for, e.g. "dentist appointment"') }, ['query']),
    run: (a, ctx) => {
      const matches = db.searchMessages(ctx.bot.id, String(a.query ?? ''), 20)
      if (!matches.length) return 'Nothing was found. Try fewer or different words.'
      const from = { bot: 'you', user: 'user', subagent: 'subagent report', task: 'scheduled task report' }
      return matches.map((m) => `[${m.itemId}] ${when(m.createdAt)} UTC, ${from[m.from]}: ${m.snippet}`).join('\n')
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
    'The subagent has the same tools as you but none of this conversation, so the task must be fully self-contained. ' +
    'Pass bot_id to hand the task to another of the user\'s bots instead: it does it as itself, with its own ' +
    'instructions, files, browser logins and superpowers.',
  parameters: params(
    {
      name: str('Short label shown in the UI, e.g. "Compare prices"'),
      task: str('Complete, self-contained instructions, including what to report back'),
      bot_id: str('Hand the task to this bot instead of doing it yourself'),
      model: str('Model id override for this subagent'),
    },
    ['name', 'task'],
  ),
  run: (a, ctx) => {
    const child = agent.spawnSubagent(ctx.thread, { task: String(a.task), name: String(a.name), botId: a.bot_id, model: a.model })
    return JSON.stringify({ id: child.id, name: child.title, status: 'running' })
  },
}

const subagentTools: Tool[] = [
  {
    name: 'wait_subagents',
    description:
      'Block until subagents finish, then return their final reports. With no ids, waits for all of your subagents ' +
      'whose results you have not received. Subagents still running at the timeout keep running.',
    parameters: params({
      ids: { type: 'array', items: { type: 'string' }, description: 'Subagent ids to wait for' },
      timeout_seconds: { type: 'number', description: 'Maximum time to wait (default 300, max 1800)' },
    }),
    run: (a, ctx) => {
      const seconds = Math.min(Math.max(Number(a.timeout_seconds) || 300, 1), 1800)
      return agent.waitSubagents(ctx.thread, a.ids, seconds * 1000, ctx.signal)
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
    description: 'Send a follow-up message to one of your subagents. It keeps its context; if it had finished, it starts working again.',
    parameters: params({ id: str('Subagent id'), message: str('The message') }, ['id', 'message']),
    run: (a, ctx) => {
      const child = agent.ownSubagent(ctx.thread, a.id)
      db.updateThread(child.id, { reported: false })
      agent.postMessage(child.id, String(a.message), 'parent')
      return 'Sent. The subagent is working on it.'
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

// When a task runs: exactly one of these, which makes the four kinds of schedule a bot can ask for.
const runsAt = {
  at: str('Run once, at this local date and time, e.g. "2026-11-14 09:30"'),
  in_minutes: { type: 'number', description: 'Run once, this many minutes from now' },
  time: str('Run at this local time of day, "HH:MM" in 24-hour time: every day, or on the given days'),
  days: {
    type: 'array',
    items: { type: 'string', enum: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] },
    description: 'With time: the days of the week to run on. Omit for every day.',
  },
  // tasks.ts may not have loaded yet when this does (they reach each other through agent.ts), so its MIN_INTERVAL is written out.
  every_minutes: { type: 'number', description: 'Run again and again, this many minutes apart (at least 5)' },
}

/** Scheduled tasks. Who may do what is decided in tasks.ts, not here. */
const taskTools: Tool[] = [
  {
    name: 'list_scheduled_tasks',
    description:
      'List the scheduled tasks you can see: the ones you do and the ones you made (the main assistant sees every ' +
      'task). Also gives the date and time now.',
    parameters: params({}),
    run: (_, ctx) => tasks.listAs(ctx.bot),
  },
  {
    name: 'schedule_task',
    description:
      'Schedule a task: a prompt you will be given at a set time, or again and again. Each run happens in the ' +
      'background, in a thread of its own that sees nothing of this conversation, so the prompt must be ' +
      'self-contained; what came of it is passed to your conversation with the user. Give exactly one of at, ' +
      'in_minutes, time (with days if not every day) or every_minutes. Times are the user\'s local time.',
    parameters: params(
      {
        title: str('A short name, e.g. "Morning news brief"'),
        prompt: str('Complete, self-contained instructions for each run, including what to report'),
        ...runsAt,
        bot_id: str('The main assistant only: the bot that does the task, if not you'),
      },
      ['title', 'prompt'],
    ),
    run: (a, ctx) => tasks.scheduleAs(ctx.bot, a),
  },
  {
    name: 'update_scheduled_task',
    description:
      'Change a scheduled task you made (the main assistant can change any task): its name, its prompt or when it ' +
      'runs, or pause or resume it. Giving one of at, in_minutes, time or every_minutes replaces its schedule.',
    parameters: params(
      {
        id: str('The task id, from list_scheduled_tasks'),
        title: str('A new name'),
        prompt: str('New instructions for each run'),
        paused: { type: 'boolean', description: 'true pauses the task, false resumes it' },
        ...runsAt,
        bot_id: str('The main assistant only: move the task to this bot'),
      },
      ['id'],
    ),
    run: (a, ctx) => tasks.updateAs(ctx.bot, a),
  },
  {
    name: 'delete_scheduled_task',
    description: 'Delete a scheduled task you made (the main assistant can delete any task).',
    parameters: params({ id: str('The task id, from list_scheduled_tasks') }, ['id']),
    run: (a, ctx) => tasks.deleteAs(ctx.bot, a.id),
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
    description: 'Replace the contents of an input, textarea or editable element. Set submit to press Enter afterwards.',
    parameters: params(
      {
        ref: { type: 'number', description: 'Element ref from the latest snapshot' },
        text: str('Text to enter'),
        submit: { type: 'boolean', description: 'Press Enter after typing' },
      },
      ['ref', 'text'],
    ),
    run: async (a, ctx) => {
      const p = await page(ctx)
      const el = byRef(p, a.ref)
      await el.fill(String(a.text), { timeout: 8000 }).catch(async () => {
        await el.click({ timeout: 8000 })
        await p.keyboard.type(String(a.text))
      })
      if (!a.submit) return 'Typed.'
      await el.press('Enter')
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
      const result = await (await page(ctx)).evaluate(String(a.expression))
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

const webTools: Tool[] = [
  {
    name: 'web_fetch',
    description:
      'Fetch a URL over plain HTTP (no browser, no logins) and return its text. Faster than the browser for public ' +
      'pages and APIs; use the browser for sites that need JavaScript or a login.',
    parameters: params({ url: str('Absolute http(s) URL') }, ['url']),
    run: async (a, ctx) => {
      const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(30_000)])
      const headers = { 'User-Agent': 'Mozilla/5.0 (compatible; OpenBot/0.1)', Accept: 'text/html,application/json,text/plain,*/*' }
      // Redirects are followed by hand so that none of them can lead to Open Bot's own address.
      let url = new URL(String(a.url))
      let res: Response
      for (let hops = 0; ; hops++) {
        if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https addresses can be fetched.')
        if (isOwnServer(url)) throw new Error('That address is Open Bot itself, which is not available to you.')
        res = await fetch(url, { signal, headers, redirect: 'manual' })
        const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
        if (!next) break
        if (hops >= 8) throw new Error('Too many redirects.')
        url = new URL(next, url)
      }
      let text = await res.text()
      if ((res.headers.get('content-type') ?? '').includes('html')) {
        text = text
          .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
          .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>|<br\s*\/?>/gi, '\n')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
          .replace(/[ \t]+/g, ' ')
          .replace(/\s*\n\s*/g, '\n')
      }
      return `HTTP ${res.status} ${url}\n\n${text.trim()}`
    },
  },
]

/** Everything a thread's bot can call right now, and why any of its superpowers' services cannot be used. */
export async function toolsFor(thread: Thread): Promise<{ tools: Tool[]; problems: Record<string, string> }> {
  const canSpawn = agent.depthOf(thread) < settings().maxDepth
  const services = await serviceTools(thread.botId)
  // Nobody watches a scheduled run, so there is nobody to ask to take over its browser.
  const browsing = thread.kind === 'task' ? browserTools.filter((t) => t.name !== 'browser_ask_user') : browserTools
  const own = [...botTools, ...fileTools, ...historyTools, ...(canSpawn ? [spawnTool, ...subagentTools] : []), ...taskTools, ...browsing, ...webTools, pageTool]
  return { tools: [...own, ...services.tools], problems: services.problems }
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
  try {
    const output = await tool.run(args, ctx)
    return output.length > MAX_OUTPUT ? output.slice(0, MAX_OUTPUT) + '\n… [output truncated]' : output
  } catch (e: any) {
    if (ctx.signal.aborted) return 'Error: stopped by the user.'
    return `Error: ${String(e?.message ?? e).split('\n').slice(0, 4).join('\n')}`
  }
}
