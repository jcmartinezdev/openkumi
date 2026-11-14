// The agent loop: runs a thread against its bot's model until the model stops calling tools, and
// coordinates subagents (child threads that run concurrently and report back to their parent).
// A bot has one conversation with its owner (see mainThread), which can be started afresh.
// Runs of automations (automations.ts) are threads beneath the conversation too, and report to it.
import type { Bot, Item, ItemData, Partial, Thread } from '@openkumi/shared'
import { attach, toShow, withFiles } from './attachments.ts'
import { getBot, listBots } from './bots.ts'
import { browserFor, retireWindow } from './browser.ts'
import { emit, workspaceDir } from './config.ts'
import * as db from './db.ts'
import { isOverflow, prepare, shorten, tokens, transcript } from './history.ts'
import { masterPrompt } from './prompt.ts'
import { getProvider } from './providers/index.ts'
import type { ModelEvent } from './providers/types.ts'
import { settings } from './settings.ts'
import { superpowerIndex, superpowerNames } from './superpowers.ts'
import { TIME_ZONE, finishRun, isMain } from './automations.ts'
import { openToolEndpoint } from './tool-endpoint.ts'
import { runTool, toolsFor } from './tools.ts'
import { agentsFile, memoryIndex } from './workspace.ts'

interface Run {
  abort: AbortController
  partial: Partial
  /** Settles once the loop has ended and saved what it had. */
  done?: Promise<void>
}

const running = new Map<string, Run>()
/** Set while the server shuts down: nothing new starts. */
let closing = false
/** Callbacks from wait_subagents calls currently blocked on a thread. */
const waiters = new Map<string, Set<() => void>>()

export const isRunning = (threadId: string) => running.has(threadId)
export const partialOf = (threadId: string): Partial => running.get(threadId)?.partial ?? { text: '', reasoning: '' }

export function depthOf(thread: Thread): number {
  let depth = 0
  for (let t: Thread | undefined = thread; t?.parentId; t = db.getThread(t.parentId)) depth++
  return depth
}

/**
 * Who else works for the user and what each is for, a line each. Those lines are the owner's: a bot
 * may word the first one of a bot it creates, but none can change one afterwards, its own included,
 * so a bot that has been talked into something cannot pass it on to the others through how it is
 * described.
 */
function team(bot: Bot): string {
  const bots = listBots()
  const main = bots[0]
  const line = (b: Bot) => {
    const powers = superpowerNames(b.id)
    return (
      `- ${b.emoji} ${b.name} (bot_id: ${b.id})${b.id === main.id ? ', the main assistant' : ''}: ` +
      `${b.description || '(no description yet)'}${powers.length ? ` Superpowers: ${powers.join(', ')}.` : ''}`
    )
  }
  return bots.filter((b) => b.id !== bot.id).map(line).join('\n')
}

/** The system prompt: the master prompt, filled in from the bot's folder on every step so its own edits take effect at once. */
function instructions(bot: Bot, thread: Thread, problems: Record<string, string>): string {
  // Who wrote an automation decides whether it counts as the user's say-so; one deleted since is not taken to be theirs.
  const automation = thread.kind === 'automation' && thread.automationId ? db.getAutomation(thread.automationId) : undefined
  const by = automation?.createdBy ?? ''
  // A subagent may have been handed its task by another bot, rather than split off by this one.
  const from = thread.kind === 'subagent' && thread.parentId ? db.getThread(thread.parentId) : undefined
  const handedBy = from && from.botId !== bot.id ? getBot(from.botId) : undefined
  return masterPrompt({
    bot_name: bot.name,
    today: new Date().toDateString(),
    other_bots: team(bot),
    main: isMain(bot),
    can_hand_over: depthOf(thread) < settings().maxDepth,
    automation: thread.kind === 'automation',
    watch: automation?.trigger.kind === 'watch',
    subagent: thread.kind === 'subagent',
    codex: bot.provider === 'codex',
    rules: bot.rules,
    time_zone: TIME_ZONE,
    instructions_limit: String(settings().instructionsLimit),
    agents_md: agentsFile(bot.id),
    memory: memoryIndex(bot.id).join('\n'),
    superpowers: superpowerIndex(bot.id, problems).join('\n'),
    automation_title: thread.title,
    by_user: by === 'user',
    by_you: by === bot.id,
    by_other: !!by && by !== 'user' && by !== bot.id,
    automation_author: by ? (getBot(by)?.name ?? 'another bot') : '',
    automation_gone: !by,
    handed_by: handedBy?.name ?? '',
  })
}

/** What a bot is told in its conversation right now, for its owner to read. Its services are not checked for it. */
export const systemPrompt = (bot: Bot) => instructions(bot, conversation(bot.id), {})

const isUserMessage = (item: Item) => item.data.type === 'message' && item.data.role === 'user'
/** The files the owner sent with a message. */
const filesOf = (data: ItemData) => (data.type === 'message' && data.role === 'user' ? (data.attachments ?? []) : [])
const said = (items: Item[]) => items.map((i) => (i.data.type === 'message' ? withFiles(i.data.text, filesOf(i.data)) : '')).join('\n\n')

/** Starts the loop for a thread unless it is already running. */
export function run(threadId: string) {
  if (running.has(threadId) || closing) return
  const state: Run = { abort: new AbortController(), partial: { text: '', reasoning: '' } }
  running.set(threadId, state)
  db.updateThread(threadId, { status: 'running' })
  state.done = loop(threadId, state)
}

/**
 * Stops every thread at work, for the server to shut down, and waits until each has saved what it
 * had written (but no longer than `waitMs`, in case an engine does not stop when asked).
 */
export async function stopAll(waitMs = 5000) {
  closing = true
  const runs = [...running.values()]
  for (const id of running.keys()) stop(id)
  let timer: NodeJS.Timeout | undefined
  await Promise.race([Promise.all(runs.map((r) => r.done)), new Promise((resolve) => (timer = setTimeout(resolve, waitMs)))])
  clearTimeout(timer)
}

async function loop(threadId: string, state: Run) {
  const { signal } = state.abort
  let status: Thread['status'] = 'idle'
  /** The conversation was already cut down once in this run because the model refused its length. */
  let squeezed = false
  try {
    for (let step = 0; ; step++) {
      const thread = db.getThread(threadId)
      const bot = thread && getBot(thread.botId)
      if (!thread || !bot) return
      const { maxSteps, disabledProviders } = settings()
      if (step >= maxSteps) throw new Error(`Stopped after ${maxSteps} steps without finishing. The limit is in Settings, under Advanced.`)

      const provider = getProvider(bot.provider)
      if (disabledProviders.includes(provider.id)) throw new Error(`${provider.info().name} is switched off in Settings.`)
      const model = thread.model || bot.model || (await provider.models())[0]?.id
      if (!model) throw new Error(`No model is available from ${provider.info().name}. Check Settings.`)
      const { tools, problems } = await toolsFor(thread)
      signal.throwIfAborted()
      let items = db.listItems(threadId)
      const seen = items.at(-1)?.id ?? 0

      const calls: Extract<ItemData, { type: 'function_call' }>[] = []
      /** Stores a finished item, or passes streaming text on to whoever is watching. */
      const record = (ev: ModelEvent) => {
        if (ev.type === 'item') {
          if (ev.item.type === 'message') state.partial.text = ''
          if (ev.item.type === 'reasoning') state.partial.reasoning = ''
          db.addItem(threadId, ev.item)
          if (ev.item.type === 'function_call') calls.push(ev.item)
        } else if (ev.type !== 'session') {
          const kind = ev.type === 'text_delta' ? 'text' : 'reasoning'
          state.partial[kind] += ev.delta
          emit({ type: 'stream.delta', threadId, kind, delta: ev.delta })
        }
      }

      if (provider.turn) {
        // An engine keeps the conversation itself, so it is told only what was said since it last
        // ran, and it calls the bot's tools through an address that exists for this turn alone.
        const kept = db.getSession(threadId)
        const session = kept?.provider === provider.id ? kept : null
        // Without a conversation of its own to continue (a new thread, or one that ran on something
        // else until now), what is new is whatever came after the last reply.
        const lastReply = items.findLast((i) => i.data.type === 'message' && i.data.role === 'assistant')?.id ?? 0
        const told = session ? session.upTo : Math.max(kept?.upTo ?? 0, lastReply)
        const fresh = items.filter((i) => i.id > told && isUserMessage(i))
        if (!fresh.length) break
        const input = session ? said(fresh) : transcript(items.filter((i) => i.id < fresh[0].id)) + said(fresh)
        const endpoint = openToolEndpoint({ thread, bot, tools, signal })
        let sessionId = session?.id ?? null
        let produced = false
        try {
          const events = provider.turn({
            model,
            instructions: instructions(bot, thread, problems),
            input,
            // What came with the messages it has not seen yet; earlier files are named in what it is told, and kept in the workspace.
            files: toShow(bot.id, threadId, fresh.flatMap((i) => filesOf(i.data)), provider.sees),
            session: sessionId,
            cwd: workspaceDir(bot.id),
            toolsUrl: endpoint.url,
            effort: bot.effort,
            webSearch: bot.webSearch,
            signal,
          })
          for await (const ev of events) {
            if (ev.type === 'session') sessionId = ev.id
            else produced = true
            record(ev)
          }
        } catch (e) {
          // The engine may have lost its record of the conversation. Start a new one, once, from what was said.
          if (session && !produced && !signal.aborted) {
            sessionId = null
            db.setSession(threadId, null)
            continue
          }
          throw e
        } finally {
          endpoint.close()
          // Whatever happened, the engine has now been told everything up to here.
          if (sessionId) db.setSession(threadId, { provider: provider.id, id: sessionId, upTo: seen })
        }
      } else {
        // An engine that ran this thread earlier has missed what happens from here on, so its
        // conversation is dropped; if the thread goes back to it, it starts again from what was said.
        if (db.getSession(threadId)) db.setSession(threadId, null)
        const system = instructions(bot, thread, problems)
        // The conversation is sent whole each time, so it is kept within what the model can take.
        const room = Math.max(1000, settings().historyLimit - Math.ceil(system.length / 4))
        if (await shorten(threadId, room, { provider, model, signal })) items = db.listItems(threadId)
        try {
          const stream = provider.stream!({
            model,
            instructions: system,
            items: prepare(items),
            tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
            effort: bot.effort,
            webSearch: bot.webSearch,
            sessionId: threadId,
            signal,
            show: (attachments) => toShow(bot.id, threadId, attachments, provider.sees),
          })
          for await (const ev of stream) record(ev)
        } catch (e) {
          // The model's window turned out smaller than the limit in Settings: halve what it is sent and ask again, once.
          if (squeezed || signal.aborted || !isOverflow(e)) throw e
          squeezed = true
          if (!(await shorten(threadId, Math.floor(tokens(prepare(items)) / 2), { provider, model, signal }))) throw e
          continue
        }
      }
      signal.throwIfAborted()

      if (calls.length) {
        // Results are stored as each call finishes; prepare() restores call/output order.
        await Promise.all(
          calls.map(async (call) => {
            const output = await runTool(tools, call, { thread, bot, signal })
            db.addItem(threadId, { type: 'function_call_output', call_id: call.call_id, output })
          }),
        )
        signal.throwIfAborted()
        continue
      }
      // Finished, unless a message arrived while the model was answering (the user typed again, or a
      // subagent reported in): then take another turn so it is not left unanswered.
      const arrived = db.listItems(threadId).some((i) => i.id > seen && i.data.type === 'message' && i.data.role === 'user')
      if (!arrived) break
    }
  } catch (e: any) {
    // What had been written of a reply is kept as it stood, for the owner to read and the bot to see.
    if (state.partial.text.trim()) db.addItem(threadId, { type: 'message', role: 'assistant', text: state.partial.text, stopped: true })
    state.partial = { text: '', reasoning: '' }
    if (signal.aborted) {
      db.addItem(threadId, { type: 'notice', level: 'info', text: 'Stopped.' })
    } else {
      status = 'error'
      db.addItem(threadId, { type: 'notice', level: 'error', text: String(e?.message ?? e) })
    }
  } finally {
    running.delete(threadId)
    const thread = db.updateThread(threadId, { status })
    if (thread) finished(thread)
  }
}

function finished(thread: Thread) {
  // A subagent's or an automation's run's browser window is closed a little after its work is done.
  if (thread.kind !== 'chat') retireWindow(thread.botId, thread.id)
  if (thread.kind === 'automation') return finishRun(thread)
  if (thread.kind !== 'subagent' || !thread.parentId) return
  const blocked = waiters.get(thread.id)
  if (blocked?.size) {
    // A wait_subagents call is waiting on this thread and will deliver the result itself.
    blocked.forEach((wake) => wake())
    return
  }
  const parent = db.getThread(thread.parentId)
  if (thread.reported || !parent) return
  db.updateThread(thread.id, { reported: true })
  // Nobody is listening in a conversation that was set aside.
  if (parent.archivedAt) return
  postMessage(thread.parentId, `<subagent_notification>\n${describeSubagent(thread)}\n</subagent_notification>`, 'subagent')
}

/**
 * Adds a user-role message to a thread and makes sure the thread runs to answer it. `files` are the
 * ids of files the owner sent with it, waiting to go (see attachments.ts).
 */
export function postMessage(threadId: string, text: string, source: Extract<ItemData, { role: 'user' }>['source'], files: string[] = []) {
  const thread = db.getThread(threadId)
  if (!thread) throw new Error('No such thread')
  if (thread.archivedAt) throw new Error('This is an earlier conversation, which can only be read. Continue it to write in it again.')
  const attachments = files.length ? attach(thread.botId, thread.id, files) : []
  // A conversation is named after what it began with, which is how it is found again once archived.
  if (source === 'user' && thread.kind === 'chat' && thread.title === db.UNTITLED) {
    const title = text.replace(/\s+/g, ' ').trim() || attachments.map((a) => a.name).join(', ')
    db.updateThread(threadId, { title: title.length > 60 ? title.slice(0, 57) + '…' : title || db.UNTITLED })
  }
  db.addItem(threadId, { type: 'message', role: 'user', text, source, ...(attachments.length ? { attachments } : {}) })
  run(threadId)
}

// ---- a bot's one conversation

/** The bot's conversation, begun now if nothing has been said yet. */
export function conversation(botId: string): Thread {
  return db.mainThread(botId) ?? db.createThread({ botId })
}

/**
 * Whether a thread or any thread beneath it is at work. Found from the threads that are running,
 * which are few, rather than from every thread beneath it: a conversation keeps all its runs.
 */
function busy(thread: Thread): boolean {
  for (const id of running.keys()) {
    for (let t = db.getThread(id); t; t = t.parentId ? db.getThread(t.parentId) : undefined) if (t.id === thread.id) return true
  }
  return false
}

/**
 * Sets the bot's conversation aside and begins an empty one. The old one is kept, read-only, and
 * what the bot knows (AGENTS.md, memory/, files/) is untouched: only what is in front of it goes.
 */
export function startFresh(botId: string): Thread {
  const current = db.mainThread(botId)
  // An empty conversation is already a fresh one.
  if (!current || !db.hasItems(current.id)) return current ?? db.createThread({ botId })
  if (busy(current)) throw new Error('The bot is still working. Stop it first, or wait until it is done.')
  db.updateThread(current.id, { archivedAt: Date.now() })
  const next = db.createThread({ botId })
  // The bot carries on in the browser window it was using.
  browserFor(botId).handOver(current.id, next.id)
  return next
}

/** Makes an archived conversation the bot's current one again; the one that was current is archived in its place. */
export function resume(thread: Thread): Thread {
  if (!thread.archivedAt || thread.parentId) throw new Error('Only an earlier conversation can be continued.')
  const current = db.mainThread(thread.botId)
  if (current) {
    if (busy(current)) throw new Error('The bot is still working. Stop it first, or wait until it is done.')
    if (db.hasItems(current.id)) db.updateThread(current.id, { archivedAt: Date.now() })
    else db.deleteThread(current.id)
    browserFor(thread.botId).handOver(current.id, thread.id)
  }
  return db.updateThread(thread.id, { archivedAt: null })!
}

/** Stops a thread and every subagent (and run of an automation) beneath it. */
export function stop(threadId: string) {
  for (const child of db.childrenOf(threadId)) {
    // The parent is being stopped too, so there is nobody to report to.
    if (!child.reported) db.updateThread(child.id, { reported: true })
    if (busy(child)) stop(child.id)
  }
  running.get(threadId)?.abort.abort(new Error('Stopped'))
}

// ---- subagents

export function spawnSubagent(parent: Thread, opts: { task: string; name: string; botId?: string; model?: string }): Thread {
  const botId = opts.botId ?? parent.botId
  if (!getBot(botId)) throw new Error(`No bot with id ${botId}. Use list_bots to see the bots that exist.`)
  const { maxDepth, maxSubagents } = settings()
  if (depthOf(parent) >= maxDepth) throw new Error('Subagents at this depth cannot spawn further subagents.')
  if (subagentsOf(parent).filter((c) => isRunning(c.id)).length >= maxSubagents) {
    throw new Error(`At most ${maxSubagents} subagents can run at once. Wait for some to finish.`)
  }
  const child = db.createThread({
    botId,
    parentId: parent.id,
    kind: 'subagent',
    title: opts.name.slice(0, 60) || 'Subagent',
    model: opts.model || null,
  })
  postMessage(child.id, opts.task, 'parent')
  return child
}

/** The subagents a thread has spawned. Runs of automations beneath a conversation are not among them. */
export const subagentsOf = (parent: Thread) => db.childrenOf(parent.id).filter((c) => c.kind === 'subagent')

/** The child of `parent` with this id; agents may only control subagents they spawned themselves. */
export function ownSubagent(parent: Thread, id: unknown): Thread {
  const child = typeof id === 'string' ? db.getThread(id) : undefined
  if (!child || child.parentId !== parent.id || child.kind !== 'subagent') throw new Error(`You have no subagent with id ${id}. Use list_subagents.`)
  return child
}

export function subagentStatus(thread: Thread): 'running' | 'completed' | 'failed' | 'stopped' {
  if (isRunning(thread.id)) return 'running'
  if (thread.status === 'error') return 'failed'
  const last = db.listItems(thread.id).at(-1)?.data
  return last?.type === 'notice' ? 'stopped' : 'completed'
}

/** How the work of a subagent (or a run of an automation) ended, and what it came to: its last message, or what went wrong. */
export function outcome(thread: Thread): { status: ReturnType<typeof subagentStatus>; body: string } {
  const status = subagentStatus(thread)
  const items = db.listItems(thread.id)
  const lastAsk = items.findLastIndex((i) => i.data.type === 'message' && i.data.role === 'user')
  const turn = items.slice(lastAsk + 1).map((i) => i.data)
  const answer = turn.findLast((d) => d.type === 'message')
  const notice = turn.findLast((d) => d.type === 'notice')
  let body: string
  if (status === 'running') body = '(still working)'
  else if (status === 'failed') body = `Error: ${notice?.type === 'notice' ? notice.text : 'unknown error'}`
  else if (answer?.type === 'message') body = answer.role === 'assistant' && answer.stopped ? `${answer.text}\n(cut off here)` : answer.text
  else body = status === 'stopped' ? '(stopped before producing a result)' : '(finished without a final message)'
  return { status, body }
}

export function describeSubagent(thread: Thread): string {
  const { status, body } = outcome(thread)
  return `Subagent "${thread.title}" (id: ${thread.id}) — ${status}\n${body}`
}

/** Blocks until the given subagents are no longer running, the timeout passes, or the caller is stopped. */
export async function waitSubagents(parent: Thread, ids: string[] | undefined, timeoutMs: number, signal: AbortSignal): Promise<string> {
  const targets = ids?.length ? ids.map((id) => ownSubagent(parent, id)) : subagentsOf(parent).filter((c) => !c.reported)
  if (!targets.length) return 'There are no subagents to wait for.'

  const cleanup: (() => void)[] = []
  const all = Promise.all(
    targets.map(
      (t) =>
        new Promise<void>((resolve) => {
          if (!isRunning(t.id)) return resolve()
          const set = waiters.get(t.id) ?? new Set()
          waiters.set(t.id, set)
          set.add(resolve)
          cleanup.push(() => set.delete(resolve))
        }),
    ),
  )
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))
  const aborted = new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
  await Promise.race([all, timeout, aborted])
  clearTimeout(timer)
  cleanup.forEach((fn) => fn())

  return targets
    .map((t) => {
      const fresh = db.getThread(t.id)
      if (!fresh) return `Subagent ${t.id} was deleted.`
      if (!isRunning(fresh.id)) db.updateThread(fresh.id, { reported: true })
      return describeSubagent(fresh)
    })
    .join('\n\n---\n\n')
}
