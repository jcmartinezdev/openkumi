// The agent loop: runs a thread against its bot's model until the model stops calling tools, and
// coordinates subagents (child threads that run concurrently and report back to their parent).
// A bot has one conversation with its owner (see mainThread), which can be started afresh.
// Runs of automations (automations.ts) are threads beneath the conversation too, and report to it.
//
// Everything said to a thread (by the owner, another bot, a subagent or a run of an automation
// reporting back) waits in the thread's queue and is let in one message at a time: the bot answers each in a
// turn of its own. The owner can have a waiting message read at once, by the bot as it works.
import crypto from 'node:crypto'
import type { Attachment, Bot, Item, ItemData, Partial, Queued, RunsOn, Said, Thread } from '@openkumi/shared'
import { attach, discard, handOver, outgoing, stageCopy, toShow, unstage, withFiles } from './attachments.ts'
import { getBot, listBots } from './bots.ts'
import { browserFor, retireWindow } from './browser.ts'
import { emit, sharedComputer, workspaceDir } from './config.ts'
import * as db from './db.ts'
import { heard, isOverflow, prepare, shorten, tokens, transcript } from './history.ts'
import { masterPrompt } from './prompt.ts'
import { getProvider, learnModels, modelName } from './providers/index.ts'
import type { ModelEvent, Steering } from './providers/types.ts'
import { settings } from './settings.ts'
import { superpowerIndex, superpowerNames } from './superpowers.ts'
import { failed, modelSent, track, whereOf } from './telemetry.ts'
import { count as countUsage } from './usage.ts'
import { TIME_ZONE, finishRun, isMain } from './automations.ts'
import { type ToolEndpoint, openToolEndpoint } from './tool-endpoint.ts'
import { onACall, runTool, toolsFor } from './tools.ts'
import { agentsFile, memoryIndex } from './workspace.ts'

/** An engine's turn while it runs, for a message to be given to it as it works. */
interface EngineTurn {
  steering: Steering
  endpoint: ToolEndpoint
  /** Cuts the turn short, leaving the run going: the message it was cut for is read next. */
  cut: AbortController
  /** The messages the engine was given as it worked: it has seen everything up to the last of them. */
  given: number[]
}

interface Run {
  abort: AbortController
  partial: Partial
  /** Settles once the loop has ended and saved what it had. */
  done?: Promise<void>
  /** What the turn under way is the answer to: the message let in for it, and any the owner had it read since. */
  asked: Item[]
  engine?: EngineTurn
  /** The turn before was cut short for the message that is read next; the engine is told so with it. */
  cutShort: boolean
  /** Fires when the owner wants a message read now, so that a tool that only waits gives way. A new one is made each time. */
  hurry: AbortController
  /** When the loop began, and how many times the model was asked in it: what is said of the run when it is over (telemetry.ts). */
  startedAt: number
  steps: number
  /** The tokens the run used so far, by model as the engine names it ('' for the model the bot was set to). */
  used: Map<string, { input: number; cached: number; output: number }>
}

const running = new Map<string, Run>()
/** Set while the server shuts down: nothing new starts. */
let closing = false
/** Callbacks from wait_subagents calls currently blocked on a thread. */
const waiters = new Map<string, Set<() => void>>()

export const isRunning = (threadId: string) => running.has(threadId)
/** How many conversations, subagents and runs are at work: what stopping the server now would cut off. */
export const working = () => running.size
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

/**
 * What a thread runs on. A run of an automation that was given a model of its own, and every
 * subagent of such a run, is on exactly that from start to end; any other thread is on what its
 * bot runs on now, a subagent with the model it was started on in place of the bot's.
 */
export function runsOn(thread: Pick<Thread, 'provider' | 'model' | 'effort'>, bot: Bot): RunsOn {
  if (thread.provider) return { provider: thread.provider, model: thread.model ?? '', effort: thread.effort ?? '' }
  return { provider: bot.provider, model: thread.model || bot.model, effort: bot.effort }
}

/** Whether a thread's bot can message the other bots from it: from its own conversation, while that is switched on. */
export const canMessage = (thread: Thread) => thread.kind === 'chat' && settings().botMessages

/**
 * The system prompt: the master prompt, filled in from the bot's folder on every step so its own edits take effect at once.
 * `on` is what the turn runs on, which a change to the bot while it works does not move.
 */
function instructions(bot: Bot, thread: Thread, problems: Record<string, string>, call = false, on = runsOn(thread, bot)): string {
  // Who wrote an automation decides whether it counts as the user's say-so; one deleted since is not taken to be theirs.
  const automation = thread.kind === 'automation' && thread.automationId ? db.getAutomation(thread.automationId) : undefined
  const by = automation?.createdBy ?? ''
  return masterPrompt({
    bot_name: bot.name,
    model: modelName(on),
    today: new Date().toDateString(),
    other_bots: team(bot),
    main: isMain(bot),
    chat: thread.kind === 'chat',
    can_message: canMessage(thread),
    automation: thread.kind === 'automation',
    watch: automation?.trigger.kind === 'watch',
    hook: automation?.trigger.kind === 'hook',
    subagent: thread.kind === 'subagent',
    call,
    shared: sharedComputer(),
    codex: on.provider === 'codex',
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
  })
}

/** What a bot is told in its conversation right now, for its owner to read. Its services are not checked for it. */
export const systemPrompt = (bot: Bot) => instructions(bot, conversation(bot.id), {})

const isUserMessage = (item: Item) => item.data.type === 'message' && item.data.role === 'user'
/** Asked on a call (calls.ts). */
const onCall = (item: Item) => item.data.type === 'message' && item.data.role === 'user' && item.data.via === 'call'
/** The files that came with a message: the owner's, or another bot's. */
const filesOf = (data: ItemData) => (data.type === 'message' && data.role === 'user' ? (data.attachments ?? []) : [])
/** What was said to the bot, for an engine to read: each message with the files that came with it. */
const told = (messages: ItemData[]) => messages.map((d) => (d.type === 'message' && d.role === 'user' ? withFiles(heard(d), d) : '')).join('\n\n')
/** What an engine is told with a message its turn was cut short for. */
const CUT_SHORT =
  '[You were at work on what came before when the user had this put in front of you, and what you were writing ' +
  'was cut off. Read it, take it into account, and carry on with that work unless this says otherwise.]\n\n'

// ---- the queue: what waits for a bot, and when it goes in

/** How many messages may wait for a bot. Whoever sends one more is told the bot is busy. */
export const MAX_WAITING = 10

/** The message that goes in next: the oldest, or the one the owner asked to be read now. Of a queue that is held back, only such a one goes in. */
function next(thread: Thread): Queued | undefined {
  const waiting = db.queueOf(thread.id)
  return thread.held ? waiting.find((w) => w.now) : waiting[0]
}

/** Makes the bot's copies of a waiting message's files, once, so that the message can name them. */
function withCopies(waiting: Queued, thread: Thread): Queued {
  const files = waiting.message.attachments
  if (!files?.some((a) => !a.path)) return waiting
  return db.updateQueued(waiting.id, { message: { ...waiting.message, attachments: handOver(thread.botId, thread.id, files) } })!
}

/**
 * Someone waiting to hear what the bot answers to one message: a call, where the answer is read
 * out to the owner (calls.ts). Settled once, when the turn that answers the message is over.
 */
export interface Answer {
  /** `also` is what else the turn that answered it was the answer to. */
  resolve: (text: string, also: Said[]) => void
  reject: (error: Error) => void
}
/** Those waiting, by the message's place in the queue while it waits there (and the thread it waits in), */
const awaited = new Map<number, Answer & { threadId: string }>()
/** and by its item once the bot has it in front of it. */
const answering = new Map<number, Answer>()

/** Tells whoever waits for an answer to a message that still waits in a queue that none is coming. */
function unanswered(queuedId: number, why: string) {
  const answer = awaited.get(queuedId)
  awaited.delete(queuedId)
  answer?.reject(new Error(why))
}

/** Told each time a bot has answered: the thread, what its turn was the answer to, and the last thing it said in it (worked out when asked for). */
type Hearer = (threadId: string, asked: Item[], reply: () => string) => void
const hearers = new Set<Hearer>()
/** Has `fn` told whenever a bot has answered something: a call says what the bot answers to its own work coming back (calls.ts). */
export function onAnswered(fn: Hearer) {
  hearers.add(fn)
}

/** The turn that answers these messages is over: whoever waits for an answer gets what the bot said last in it, or why there is nothing. */
function answered(threadId: string, asked: Item[], failure?: string) {
  let said: string | undefined
  const reply = () => {
    if (said !== undefined) return said
    const first = Math.min(...asked.map((item) => item.id))
    const last = db.listItems(threadId).findLast((i) => i.id > first && i.data.type === 'message' && i.data.role === 'assistant')?.data
    return (said = last?.type === 'message' ? last.text : '')
  }
  for (const item of asked) {
    const answer = answering.get(item.id)
    if (!answer) continue
    answering.delete(item.id)
    if (failure !== undefined) answer.reject(new Error(failure))
    else answer.resolve(reply(), asked.filter((other) => other.id !== item.id).map((other) => other.data as Said))
  }
  if (failure === undefined && asked.length) for (const fn of hearers) fn(threadId, asked, reply)
}

/** How many subagents a thread started since `since` are at work now. Found from the threads that are running, which are few. */
export function subagentsAtWork(threadId: string, since: number): number {
  let count = 0
  for (const id of running.keys()) {
    const thread = db.getThread(id)
    if (thread?.kind === 'subagent' && thread.parentId === threadId && thread.createdAt >= since) count++
  }
  return count
}

/** A queue with nothing left in it is not held back any more. */
function emptied(threadId: string) {
  if (db.getThread(threadId)?.held && !db.queueOf(threadId).length) db.updateThread(threadId, { held: false })
}

/** Lets a waiting message into its conversation, for the bot to answer. */
function letIn(waiting: Queued, thread: Thread): Item {
  const { message } = withCopies(waiting, thread)
  // A conversation is named after what it began with, which is how it is found again once archived.
  if ((message.source === 'user' || message.source === 'bot') && thread.kind === 'chat' && thread.title === db.UNTITLED) {
    const title = message.text.replace(/\s+/g, ' ').trim() || (message.attachments ?? []).map((a) => a.name).join(', ')
    db.updateThread(thread.id, { title: title.length > 60 ? title.slice(0, 57) + '…' : title || db.UNTITLED })
  }
  const item = db.addItem(thread.id, message)
  db.removeQueued(waiting.id)
  emptied(thread.id)
  track('message sent', { from: message.source, engine: getBot(thread.botId)?.provider, attachments: message.attachments?.length ?? 0, on_call: message.via === 'call' })
  const answer = awaited.get(waiting.id)
  if (answer) {
    awaited.delete(waiting.id)
    answering.set(item.id, answer)
  }
  return item
}

/** What the bot's own work comes back with: a subagent's report, or what a run of an automation came to. */
const isReport = (said: Pick<Said, 'source'>) => said.source === 'subagent' || said.source === 'automation'

/** How a message stands once it has been sent: `place` is where it waits in the queue, 0 when the bot took it up at once. */
export interface Delivery {
  place: number
  /** It waits in a queue that is held back: the bot was stopped, or failed, and only the owner lets it go on. */
  held: boolean
}

/** Thrown when a queue is full. */
export class Busy extends Error {}

/**
 * Says something to a thread: the message joins the thread's queue, and the thread is set to work
 * if it is not at work already. `files` are the ids of files the owner sent with it, waiting to go
 * (see attachments.ts). `always` lets it in however many are waiting. `answer` is told what the
 * bot answers to it.
 */
export function postMessage(
  threadId: string,
  said: Omit<Said, 'type' | 'role' | 'attachments'>,
  opts: { files?: string[]; always?: boolean; answer?: Answer } = {},
): Delivery {
  const thread = db.getThread(threadId)
  if (!thread) throw new Error('No such thread')
  if (thread.archivedAt) throw new Error('This is an earlier conversation, which can only be read. Continue it to write in it again.')
  // What its own subagents and runs of automations report always gets in: there is nobody to tell that the bot is busy.
  // Where the bot was stopped, it goes straight into the conversation, unanswered, for the bot to see when it goes on.
  if (isReport(said) && thread.held) {
    db.addItem(threadId, { type: 'message', role: 'user', ...said })
    return { place: 0, held: false }
  }
  if (!opts.always && !isReport(said) && db.queueOf(threadId).length >= MAX_WAITING) {
    throw new Busy(`${getBot(thread.botId)?.name ?? 'The bot'} is busy: ${MAX_WAITING} messages are already waiting for it.`)
  }
  const attachments = opts.files?.length ? attach(thread.botId, thread.id, opts.files) : []
  const waiting = db.addQueued(threadId, { type: 'message', role: 'user', ...said, ...(attachments.length ? { attachments } : {}) })
  if (opts.answer) awaited.set(waiting.id, { ...opts.answer, threadId })
  // The owner writing to a bot lets go what was held back for it, which goes in first.
  if (said.source === 'user' && thread.held) db.updateThread(threadId, { held: false })
  run(threadId)
  const place = db.queueOf(threadId).findIndex((w) => w.id === waiting.id) + 1
  return { place, held: place > 0 && !!db.getThread(threadId)?.held }
}

/**
 * Says something to a thread and waits for what the bot answers to it: the last thing it says in
 * the turn that answers the message, or nothing when it said nothing. Fails when the bot was
 * stopped, or failed, or the message never reached it. `also` is what else that turn answered
 * (something the owner had the bot read at once, as it worked). `waits` is called when the bot is
 * at work on something else and the message has to wait its turn.
 */
export function ask(threadId: string, said: Omit<Said, 'type' | 'role' | 'attachments'>, opts: { waits?: () => void } = {}): Promise<{ text: string; also: Said[] }> {
  return new Promise((resolve, reject) => {
    try {
      const { place } = postMessage(threadId, said, { answer: { resolve: (text, also) => resolve({ text, also }), reject } })
      // The bot is at work on something else, and this waits its turn.
      if (place > 0) opts.waits?.()
    } catch (e) {
      reject(e as Error)
    }
  })
}

/** Takes a waiting message back before the bot has read it: one of the owner's, or one from another bot. */
export function takeBack(id: number) {
  const waiting = db.getQueued(id)
  if (!waiting) return
  if (waiting.message.source !== 'user' && waiting.message.source !== 'bot') throw new Error('Only a message from you or from another bot can be taken back.')
  const thread = db.getThread(waiting.threadId)
  if (thread && waiting.message.attachments) discard(thread.botId, thread.id, waiting.message.attachments)
  db.removeQueued(id)
  emptied(waiting.threadId)
  unanswered(id, 'The message was taken back before the bot read it.')
}

/** Lets a queue that was held back go on: the bot reads what waited, in order. */
export function letGo(threadId: string) {
  if (db.getThread(threadId)?.held) db.updateThread(threadId, { held: false })
  run(threadId)
}

/** After a restart: the bots go on with what was waiting for them, except where it was held back. */
export function resumeQueues() {
  for (const threadId of db.threadsWithQueue()) run(threadId)
}

/**
 * Has the bot read a waiting message now, as it works, instead of when its turn comes. A model
 * OpenKumi asks itself gets it before its next step; an engine that can be told as it works is
 * told; any other has its turn cut short once the step under way is done, and reads the message
 * next. Nothing a tool is doing is cut off. A bot that is not at work starts with the message.
 */
export function sendNow(id: number) {
  const waiting = db.getQueued(id)
  const thread = waiting && db.getThread(waiting.threadId)
  if (!waiting || !thread) throw new Error('That message is no longer waiting.')
  db.updateQueued(id, { now: true })
  const state = running.get(thread.id)
  if (!state) return run(thread.id)
  state.hurry.abort()
  state.hurry = new AbortController()
  if (state.engine) void giveNow(state, state.engine, thread, id).catch((e) => console.error('Could not give the bot a message as it works:', e))
}

/** Gives an engine at work a message: by telling it, if it can be told, and otherwise by cutting its turn short for it. */
async function giveNow(state: Run, engine: EngineTurn, thread: Thread, id: number) {
  const waiting = db.getQueued(id)
  const bot = getBot(thread.botId)
  if (!waiting || !bot) return
  if (engine.steering.deliver) {
    const { message } = withCopies(waiting, thread)
    const files = toShow(bot.id, thread.id, message.attachments ?? [], getProvider(runsOn(thread, bot).provider).sees)
    const taken = await engine.steering.deliver(told([message]), files).catch(() => false)
    const still = db.getQueued(id)
    if (taken && still) {
      const item = letIn(still, thread)
      state.asked.push(item)
      engine.given.push(item.id)
    }
    if (taken || !still) return
  }
  await engine.endpoint.settle()
  // A moment for the engine to take in what its last tool call came to.
  await new Promise((resolve) => setTimeout(resolve, 150))
  if (state.engine === engine && db.getQueued(id)) engine.cut.abort()
}

/** Starts the loop for a thread that has something waiting to be read, unless it is at work already. */
export function run(threadId: string) {
  if (running.has(threadId) || closing) return
  const thread = db.getThread(threadId)
  if (!thread || !next(thread)) return
  const state: Run = { abort: new AbortController(), partial: { text: '', reasoning: '' }, asked: [], cutShort: false, hurry: new AbortController(), startedAt: Date.now(), steps: 0, used: new Map() }
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

/** Keeps what the model had written when it was cut off, as it stood, for the owner to read and the bot to see. */
function keepPartial(threadId: string, state: Run) {
  if (state.partial.reasoning.trim()) db.addItem(threadId, { type: 'reasoning', summary: state.partial.reasoning })
  if (state.partial.text.trim()) db.addItem(threadId, { type: 'message', role: 'assistant', text: state.partial.text, stopped: true })
  state.partial = { text: '', reasoning: '' }
}

/** Works through a thread's queue: each message is let in and answered in a turn of its own, until none is left. */
async function loop(threadId: string, state: Run) {
  const { signal } = state.abort
  let status: Thread['status'] = 'idle'
  /** The bot was stopped or failed: what still waits for it is held back. */
  let broken = false
  /** Where it failed, when it did: a place in the code, never what the error said. */
  let error: string | undefined
  try {
    for (;;) {
      const thread = db.getThread(threadId)
      const waiting = thread && next(thread)
      if (!waiting) break
      const item = letIn(waiting, thread)
      // A turn that was cut short for this message is not over: its answer is to what it was asked before, too.
      state.asked = state.cutShort ? [...state.asked, item] : [item]
      await turn(threadId, state)
      // A turn that was cut short for the next message answers that one too, when it is over.
      if (!state.cutShort) answered(threadId, state.asked)
    }
    // Cut short for a message that was then taken back: what it had said is all the answer there is.
    if (state.cutShort) answered(threadId, state.asked)
  } catch (e: any) {
    // What had been written of a reply is kept as it stood, for the owner to read and the bot to see.
    if (state.partial.text.trim()) db.addItem(threadId, { type: 'message', role: 'assistant', text: state.partial.text, stopped: true })
    state.partial = { text: '', reasoning: '' }
    broken = true
    if (signal.aborted) {
      db.addItem(threadId, { type: 'notice', level: 'info', text: 'Stopped.' })
    } else {
      status = 'error'
      error = whereOf(e)
      failed(e, 'run')
      db.addItem(threadId, { type: 'notice', level: 'error', text: String(e?.message ?? e) })
    }
    answered(threadId, state.asked, signal.aborted ? 'It was stopped before it was done.' : String(e?.message ?? e))
  } finally {
    running.delete(threadId)
    // The server stopping is not the run's own end.
    if (!closing) {
      const ended = db.getThread(threadId)
      const owner = ended && getBot(ended.botId)
      const engine = ended && owner ? runsOn(ended, owner).provider : undefined
      track('run finished', { engine, outcome: status === 'error' ? 'failed' : broken ? 'stopped' : 'done', seconds: (Date.now() - state.startedAt) / 1000, steps: state.steps, error })
      // What it cost in tokens, whether it finished or not: counted by model, never by conversation.
      for (const [model, sum] of state.used) track('tokens used', { engine, model: modelSent(engine ?? '', model), input_tokens: sum.input, cached_tokens: sum.cached, output_tokens: sum.output, total_tokens: sum.input + sum.output })
    }
    // Stopped or failed, the bot does not start again by itself on what was waiting: that is held
    // back for the owner to let go, except what its own work came back with, which is put in the
    // conversation as it is. Not so when it is only the server shutting down.
    const stopped = broken && !closing ? db.getThread(threadId) : undefined
    if (stopped) for (const waiting of db.queueOf(threadId)) if (isReport(waiting.message)) letIn(waiting, stopped)
    // Nobody is kept waiting for an answer to what waited here and will not be read now: it is held back, the
    // server is stopping, or it went with the conversation, which was deleted.
    for (const [id, waiter] of awaited) {
      if (waiter.threadId !== threadId) continue
      const waits = !!db.getQueued(id)
      if (broken || closing || !waits) unanswered(id, waits ? 'The bot stopped before it got to that. It waits in the conversation.' : 'The conversation was deleted before the bot got to that.')
    }
    const held = !!stopped && db.queueOf(threadId).length > 0
    const thread = db.updateThread(threadId, { status, ...(held ? { held } : {}) })
    if (thread) finished(thread)
  }
}

/** One turn: the model answers what it was asked, calling tools until it has nothing more to do. */
async function turn(threadId: string, state: Run) {
  const { signal } = state.abort
  /** The conversation was already cut down once in this turn because the model refused its length. */
  let squeezed = false
  /** The turn before was cut short for what this one begins with. */
  const resumed = state.cutShort
  state.cutShort = false
  // A turn that answers something asked on a call: the bot only passes work on in it (tools.ts onACall). So also when
  // the turn answers something else besides, as one does that was cut short for a message the owner had read at once.
  const call = state.asked.some(onCall)
  /**
   * What the turn runs on, as it was when it began. A change to the bot while it works (by the owner, or by
   * the bot itself with update_bot) applies from its next turn: another model taking over halfway would
   * start again on what this one was asked.
   */
  let began: RunsOn | undefined
  for (let step = 0; ; step++) {
    const thread = db.getThread(threadId)
    const bot = thread && getBot(thread.botId)
    if (!thread || !bot) return
    const { maxSteps, disabledProviders } = settings()
    if (step >= maxSteps) throw new Error(`Stopped after ${maxSteps} steps without finishing. The limit is in Settings, under Advanced.`)

    const on = (began ??= runsOn(thread, bot))
    const provider = getProvider(on.provider)
    if (disabledProviders.includes(provider.id)) throw new Error(`${provider.info().name} is switched off in Settings.`)
    const model = on.model || (await provider.models())[0]?.id
    // What the model is called, for the bot to say what powers it.
    await learnModels(provider)
    if (!model) throw new Error(`No model is available from ${provider.info().name}. Check Settings.`)
    const { tools: all, problems } = await toolsFor(thread)
    const tools = call ? onACall(all) : all
    signal.throwIfAborted()
    state.steps++
    // What the owner asked to be read now goes in before the model is asked again.
    for (const waiting of db.queueOf(threadId)) if (waiting.now) state.asked.push(letIn(waiting, thread))
    let items = db.listItems(threadId)
    const seen = items.at(-1)?.id ?? 0

    const calls: Extract<ItemData, { type: 'function_call' }>[] = []
    /** Counts what a model says it used: for the run (telemetry.ts), and for the usage page (usage.ts), by the name of the model that was asked when it gives none. */
    const used = (ev: Extract<ModelEvent, { type: 'usage' }>) => {
      const sum = state.used.get(ev.model) ?? { input: 0, cached: 0, output: 0 }
      state.used.set(ev.model, { input: sum.input + ev.input, cached: sum.cached + ev.cached, output: sum.output + ev.output })
      countUsage(bot.id, provider.id, { ...ev, model: ev.model || model })
    }
    /** Stores a finished item, or passes streaming text on to whoever is watching. */
    const record = (ev: ModelEvent) => {
      if (ev.type === 'usage') used(ev)
      else if (ev.type === 'item') {
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
      const upTo = session ? session.upTo : Math.max(kept?.upTo ?? 0, lastReply)
      const fresh = items.filter((i) => i.id > upTo && isUserMessage(i))
      if (!fresh.length) return
      // Something asked on a call that the engine never got to hear (the turn for it failed before the engine ran) is
      // told to it now, with whatever came next: this turn answers it too, so it is one in which the bot only passes work on.
      const passing = call || fresh.some(onCall)
      const said = (resumed ? CUT_SHORT : '') + told(fresh.map((i) => i.data))
      const input = session ? said : transcript(items.filter((i) => i.id < fresh[0].id)) + said
      // The engine runs until it is done, the bot is stopped, or the turn is cut short for a message to be read now.
      const engine: EngineTurn = {
        steering: {},
        endpoint: openToolEndpoint({ thread, bot, tools: passing && !call ? onACall(all) : tools, signal, hurry: () => state.hurry.signal }),
        cut: new AbortController(),
        given: [],
      }
      state.engine = engine
      let sessionId = session?.id ?? null
      let produced = false
      try {
        const events = provider.turn({
          model,
          instructions: instructions(bot, thread, problems, passing, on),
          input,
          // What came with the messages it has not seen yet; earlier files are named in what it is told, and kept in the workspace.
          files: toShow(bot.id, threadId, fresh.flatMap((i) => filesOf(i.data)), provider.sees),
          session: sessionId,
          cwd: workspaceDir(bot.id),
          toolsUrl: engine.endpoint.url,
          effort: on.effort,
          // Looking something up is work too: on a call it is passed on.
          webSearch: bot.webSearch && !passing,
          signal: AbortSignal.any([signal, engine.cut.signal]),
          steering: engine.steering,
        })
        for await (const ev of events) {
          if (ev.type === 'session') sessionId = ev.id
          else if (ev.type !== 'usage') produced = true
          record(ev)
        }
      } catch (e) {
        if (signal.aborted) throw e
        if (!engine.cut.signal.aborted) {
          // The engine may have lost its record of the conversation. Start a new one, once, from what was said.
          if (!session || produced) throw e
          sessionId = null
          db.setSession(threadId, null)
          continue
        }
      } finally {
        engine.steering.deliver = undefined
        engine.endpoint.close()
        state.engine = undefined
        // Whatever happened, the engine has now been told everything up to here, and what it was given as it worked.
        if (sessionId) db.setSession(threadId, { provider: provider.id, id: sessionId, upTo: Math.max(seen, ...engine.given) })
      }
      signal.throwIfAborted()
      if (engine.cut.signal.aborted) {
        keepPartial(threadId, state)
        state.cutShort = true
      }
      return
    }

    // An engine that ran this thread earlier has missed what happens from here on, so its
    // conversation is dropped; if the thread goes back to it, it starts again from what was said.
    if (db.getSession(threadId)) db.setSession(threadId, null)
    const system = instructions(bot, thread, problems, call, on)
    // The conversation is sent whole each time, so it is kept within what the model can take.
    const room = Math.max(1000, settings().historyLimit - Math.ceil(system.length / 4))
    if (await shorten(threadId, room, { provider, model, signal, used })) items = db.listItems(threadId)
    try {
      const stream = provider.stream!({
        model,
        instructions: system,
        items: prepare(items),
        tools: tools.map(({ name, description, parameters }) => ({ name, description, parameters })),
        effort: on.effort,
        webSearch: bot.webSearch && !call,
        sessionId: threadId,
        signal,
        show: (attachments) => toShow(bot.id, threadId, attachments, provider.sees),
      })
      for await (const ev of stream) record(ev)
    } catch (e) {
      // The model's window turned out smaller than the limit in Settings: halve what it is sent and ask again, once.
      if (squeezed || signal.aborted || !isOverflow(e)) throw e
      squeezed = true
      if (!(await shorten(threadId, Math.floor(tokens(prepare(items)) / 2), { provider, model, signal, used }))) throw e
      continue
    }
    signal.throwIfAborted()
    if (!calls.length) return
    // Results are stored as each call finishes; prepare() restores call/output order.
    await Promise.all(
      calls.map(async (call) => {
        const output = await runTool(tools, call, { thread, bot, signal, hurry: state.hurry.signal })
        db.addItem(threadId, { type: 'function_call_output', call_id: call.call_id, output })
      }),
    )
    signal.throwIfAborted()
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
  postMessage(thread.parentId, { source: 'subagent', text: `<subagent_notification>\n${describeSubagent(thread)}\n</subagent_notification>` })
}

// ---- what a turn is the answer to, and messages between bots

/** How many messages may go between bots, one leading to the next, without the owner saying anything. */
export const MAX_CHAIN = 20

/** What the turn under way in a thread is the answer to, and what that allows the bot. */
export interface Basis {
  /** The owner said something in it. Only then may the main assistant create a bot. */
  owner: boolean
  /** The bots it may message: any (null), or only the ones whose message it is answering and that asked for a reply, each with the key of that message. */
  mayMessage: Map<string, string> | null
  /** How many messages between bots in a row led to it. */
  chain: number
}

export function basisOf(thread: Thread): Basis {
  const asked = (running.get(thread.id)?.asked ?? []).map((i) => i.data as Said)
  const owner = asked.some((m) => m.source === 'user')
  // Woken by its own subagents, a bot goes on with what it was doing: that is still the answer to what came before them.
  let causes = asked.filter((m) => m.source !== 'subagent')
  if (!causes.length) causes = db.listItems(thread.id).map((i) => i.data).filter((d): d is Said => d.type === 'message' && d.role === 'user' && d.source !== 'subagent').slice(-1)
  const bots = causes.filter((m) => m.source === 'bot')
  // The owner's word, an automation of its own, or nothing at all: it may message whom it likes.
  if (!bots.length || causes.some((m) => m.source === 'user')) return { owner, mayMessage: null, chain: 0 }
  return {
    owner,
    mayMessage: new Map(bots.filter((m) => m.replyWanted && m.bot).map((m) => [m.bot!.id, m.key ?? ''])),
    chain: Math.max(...bots.map((m) => m.chain ?? 1)),
  }
}

/**
 * Sends a message from a bot to another bot's own conversation with the owner, where that bot
 * answers it as it would the owner, in its turn. The sender's conversation keeps a record of it
 * for the owner to read. Files of the sender's can go with it: the other bot gets a copy of each,
 * as it does of a file the owner sends it, and never reaches the sender's folder.
 * Gives how the message stands, the bot it went to, and the files that went with it.
 */
export function messageBot(from: Thread, sender: Bot, to: unknown, text: unknown, replyWanted: boolean, files?: unknown): Delivery & { bot: Bot; sent: Attachment[] } {
  if (!canMessage(from)) throw new Error('Bots cannot message each other from here.')
  const target = typeof to === 'string' ? getBot(to) : undefined
  if (!target) throw new Error(`No bot with id ${to}. Use list_bots to see the bots that exist.`)
  if (target.id === sender.id) throw new Error('That is you. Give the id of another bot.')
  const words = typeof text === 'string' ? text.trim() : ''
  if (!words) throw new Error('The message is empty.')
  const basis = basisOf(from)
  if (basis.mayMessage && !basis.mayMessage.has(target.id)) {
    throw new Error(
      basis.mayMessage.size
        ? 'You are answering a message from another bot, so the only bot you can write to now is the one that asked you for a reply. Say the rest in your reply here, where the user reads it.'
        : 'You are answering a message from another bot that did not ask for a reply, so you cannot message a bot now. Say what matters in your reply here, where the user reads it.',
    )
  }
  if (basis.chain >= MAX_CHAIN) {
    db.addItem(from.id, { type: 'notice', level: 'info', text: `${MAX_CHAIN} messages have gone between bots without you saying anything, so ${sender.name} was not let send another. Write to it to carry on.` })
    throw new Error(`${MAX_CHAIN} messages have gone between bots, one leading to the next, without the user saying anything. Send no more: tell the user where things stand, in your reply.`)
  }
  const sending = outgoing(sender.id, files)
  const key = `m_${crypto.randomBytes(9).toString('base64url')}`
  const conversationId = conversation(target.id).id
  // The copies wait on the other bot's side, as files the owner picked for it do. The record here says where each came from.
  const sent: Attachment[] = []
  let delivery: Delivery
  try {
    for (const file of sending) sent.push({ ...stageCopy(target.id, file), path: file.path })
    // A reply that was asked for always gets in: the bot that asked is waiting for it.
    delivery = postMessage(
      conversationId,
      // A reply says which message it answers, so that whoever asked can tell it from anything else the bot writes.
      { source: 'bot', text: words, bot: { id: sender.id, name: sender.name }, replyWanted, key, chain: basis.chain + 1, ...(basis.mayMessage?.get(target.id) ? { answers: basis.mayMessage.get(target.id) } : {}) },
      { always: !!basis.mayMessage, files: sent.map((file) => file.id) },
    )
  } catch (e) {
    // A message that did not go leaves no copy behind: neither one still waiting, nor one the conversation had already taken.
    for (const file of sent) unstage(target.id, file.id)
    discard(target.id, conversationId, sent)
    throw e
  }
  db.addItem(from.id, { type: 'sent', to: { id: target.id, name: target.name }, threadId: conversationId, text: words, replyWanted, key, ...(sent.length ? { attachments: sent } : {}) })
  return { ...delivery, bot: target, sent }
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
  if (!current || (!db.hasItems(current.id) && !db.queueOf(current.id).length)) return current ?? db.createThread({ botId })
  if (busy(current)) throw new Error('The bot is still working. Stop it first, or wait until it is done.')
  mustBeRead(current)
  db.updateThread(current.id, { archivedAt: Date.now() })
  const next = db.createThread({ botId })
  // The bot carries on in the browser window it was using.
  browserFor(botId).handOver(current.id, next.id)
  return next
}

/** A conversation with messages still waiting in it cannot be set aside: they would never be read. */
function mustBeRead(conversation: Thread) {
  if (db.queueOf(conversation.id).length) throw new Error('Messages are still waiting for the bot. Let it read them, or take them back, first.')
}

/** Makes an archived conversation the bot's current one again; the one that was current is archived in its place. */
export function resume(thread: Thread): Thread {
  if (!thread.archivedAt || thread.parentId) throw new Error('Only an earlier conversation can be continued.')
  const current = db.mainThread(thread.botId)
  if (current) {
    if (busy(current)) throw new Error('The bot is still working. Stop it first, or wait until it is done.')
    mustBeRead(current)
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

/** Starts a subagent: the same bot, at work on a task of its own in a thread beneath this one. */
export function spawnSubagent(parent: Thread, opts: { task: string; name: string; model?: string }): Thread {
  const { maxDepth, maxSubagents } = settings()
  if (depthOf(parent) >= maxDepth) throw new Error('Subagents at this depth cannot spawn further subagents.')
  if (subagentsOf(parent).filter((c) => isRunning(c.id)).length >= maxSubagents) {
    throw new Error(`At most ${maxSubagents} subagents can run at once. Wait for some to finish.`)
  }
  const child = db.createThread({
    botId: parent.botId,
    parentId: parent.id,
    kind: 'subagent',
    title: opts.name.slice(0, 60) || 'Subagent',
    // A run that was given a model of its own passes it on, so the work it hands out is done on that too.
    // A subagent given another model thinks as hard as that model does by itself: the run's level was chosen for the run's.
    provider: parent.provider,
    model: opts.model || (parent.provider ? parent.model : null),
    effort: opts.model && opts.model !== parent.model ? null : parent.effort,
  })
  postMessage(child.id, { source: 'parent', text: opts.task })
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

/**
 * Blocks until the given subagents are no longer running, the timeout passes, or the caller is
 * stopped. It also gives way (`hurry`) when the owner wants the bot to read a message now.
 */
export async function waitSubagents(parent: Thread, ids: string[] | undefined, timeoutMs: number, signal: AbortSignal, hurry?: AbortSignal): Promise<string> {
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
  const hurried = new Promise<void>((resolve) => hurry?.addEventListener('abort', () => resolve(), { once: true }))
  await Promise.race([all, timeout, aborted, hurried])
  clearTimeout(timer)
  cleanup.forEach((fn) => fn())

  const early = hurry?.aborted ? 'Stopped waiting: the user sent a message for you to read now. The subagents carry on.\n\n' : ''
  return early + targets
    .map((t) => {
      const fresh = db.getThread(t.id)
      if (!fresh) return `Subagent ${t.id} was deleted.`
      if (!isRunning(fresh.id)) db.updateThread(fresh.id, { reported: true })
      return describeSubagent(fresh)
    })
    .join('\n\n---\n\n')
}
