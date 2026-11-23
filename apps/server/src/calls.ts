// Calls: the owner talks with a bot out loud, and it talks back at once.
//
// The voice on the line is a speech model of the owner's ChatGPT plan. Only Codex reaches it, so a
// call runs through the user's own installed `codex` program, as its app server, whatever the bot
// itself runs on; no API key is involved. The app that calls makes its half of a WebRTC
// connection, the server hands that to Codex, Codex sets the call up with OpenAI and gives back
// the other half: sound then goes between the device and the speech model directly, and never
// through this server.
//
// The voice speaks as the bot and makes small talk itself. Whatever needs the bot (its tools, its
// memory, its accounts) the voice hands over, and the server passes that to the bot's own
// conversation as a message from the owner, marked as said on a call. The bot answers it as
// itself, on its own engine, and the server has the voice say the answer. So what was asked and
// what came of it are in the conversation like anything else, and the bot's work is never done by
// anything but the bot. What to hand over is the voice's own choice; what it kept to itself the
// bot goes over when the call ends (see "after a call").
//
// A bot answering on a call does not do the work there either: it only has the tools to pass it
// on (tools.ts ON_A_CALL), to another bot, to a subagent of its own in the background, or to an
// automation. So its first answer is usually that something is under way. When the work comes
// back to its conversation (the subagent's report, the other bot's reply) it answers that as it
// always does, and the voice says that too, for as long as the call lasts.
//
// Codex's part in this is experimental (`thread/realtime/*`), and the Codex conversation behind a
// call has nothing to do: it is there because a call needs one, and is told to answer "ok".
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Bot, Call, CallLine, Said } from '@openkumi/shared'
import * as agent from './agent.ts'
import { getBot, listBots } from './bots.ts'
import { HOME, VERSION, emit, sharedComputer } from './config.ts'
import * as db from './db.ts'
import { cleanEnv, end, start } from './providers/cli.ts'
import { codexProgram, sealed } from './providers/codex.ts'
import { callsInfo, getProvider, learnModels, modelName } from './providers/index.ts'
import { settings } from './settings.ts'
import { TIME_ZONE } from './automations.ts'
import { track } from './telemetry.ts'
import { passedOnAt } from './tools.ts'

/** How long Codex is given to answer with the other half of the connection. */
const ANSWER_WITHIN = 25_000
/** A call nobody has said anything on for this long is ended: it would only use up the plan. */
const QUIET_FOR = 5 * 60_000
/** A call whose app has not been heard from for this long is ended: the app is gone. */
const GONE_AFTER = 40_000
/** The most of a bot's answer that is given to the voice to say. */
const SAYABLE = 3500

/** Thrown for what the owner can put right: no Codex, a bot that is gone. */
export class CallError extends Error {}

// ---- Codex's app server, as a call uses it

/** Codex's app server (see providers/codex.ts), kept running for as long as the call lasts. */
class AppServer {
  private proc: ChildProcessWithoutNullStreams
  private asked = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
  private requests = 0
  private errors = ''
  /** What it says of its own accord. */
  heard: (method: string, params: any) => void = () => {}
  /** It ended, by itself or because it was closed. */
  gone: (why: string) => void = () => {}

  constructor(program: string, args: string[], cwd: string) {
    this.proc = start(program, args, { cwd, env: cleanEnv() })
    this.proc.stdin.on('error', () => {})
    this.proc.stderr.on('data', (d) => (this.errors = (this.errors + String(d)).slice(-4000)))
    const ended = (why: string) => {
      const waiting = [...this.asked.values()]
      this.asked.clear()
      for (const w of waiting) w.reject(new Error(why))
      const gone = this.gone
      this.gone = () => {}
      gone(why)
    }
    this.proc.on('error', (e) => ended(`Codex could not be started: ${e.message}`))
    this.proc.on('close', () => ended(this.lastError() || 'Codex stopped.'))
    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      if (process.env.OPENKUMI_DEBUG || settings().debugEngines) console.error(`[codex call] ${line.slice(0, 1500)}`)
      let message: any
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      const { id, method, params } = message
      if (id !== undefined && !method) {
        const waiting = this.asked.get(id)
        this.asked.delete(id)
        if (message.error) waiting?.reject(new Error(String(message.error.message ?? 'Codex refused a request').slice(0, 600)))
        else waiting?.resolve(message.result)
      } else if (id !== undefined) {
        // Codex asks for a go-ahead, or for something of the user. A call's Codex has nothing to do: the answer is no.
        if (/requestApproval$/.test(method)) this.write({ id, result: { decision: 'decline' } })
        else this.write({ id, error: { code: -32601, message: 'Not available here.' } })
      } else if (typeof method === 'string') this.heard(method, params ?? {})
    })
  }

  private write(message: Record<string, unknown>) {
    return this.proc.stdin.writable && (this.proc.stdin.write(JSON.stringify(message) + '\n'), true)
  }

  private lastError() {
    const line = this.errors.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
    return line ? line.replace(/^\S+Z\s+ERROR\s+\S+:\s*/, '').slice(0, 400) : ''
  }

  ask(method: string, params: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.requests
      this.asked.set(id, { resolve, reject })
      if (!this.write({ id, method, params })) {
        this.asked.delete(id)
        reject(new Error('Codex is not running.'))
      }
    })
  }

  tell(method: string, params: Record<string, unknown>) {
    this.write({ method, params })
  }

  /** With its input closed it ends by itself; if it does not, it is ended. */
  close() {
    this.proc.stdin.end()
    setTimeout(() => this.proc.exitCode === null && this.proc.signalCode === null && end(this.proc), 1500).unref()
  }
}

/** Starts Codex's app server for a call, or to ask it about calls. It is not waited for: it still has to be greeted (`greet`). */
function startCodex(): AppServer {
  const program = codexProgram()
  if (!program) throw new CallError('Codex is not installed on this computer.')
  // A folder with nothing in it: the Codex behind a call has no work, and nothing to look at.
  const cwd = path.join(HOME, 'calls', 'workspace')
  fs.mkdirSync(cwd, { recursive: true })
  return new AppServer(program, ['app-server', ...sealed(), '-c', 'web_search="disabled"', '-c', 'model_reasoning_effort="low"'], cwd)
}

/** Tells Codex who is asking. Its voice part is experimental, and has to be asked for here. */
async function greet(codex: AppServer) {
  await codex.ask('initialize', { clientInfo: { name: 'openkumi', title: 'OpenKumi', version: VERSION }, capabilities: { experimentalApi: true, requestAttestation: false } })
  codex.tell('initialized', {})
}

/** `work`, unless it has come to nothing in time: a Codex that hangs must not keep a call, or a request, waiting for ever. */
function within<T>(ms: number, why: string, work: Promise<T>): Promise<T> {
  let late: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_, reject) => (late = setTimeout(() => reject(new Error(why)), ms)))
  return Promise.race([work, deadline]).finally(() => clearTimeout(late))
}

/** What the Codex conversation behind a call is told. Everything the voice hands over is carried out by the bot instead (see `handOver`). */
const NOTHING_TO_DO =
  'This conversation only carries a voice call for OpenKumi. There is nothing for you to do in it: the requests you are shown ' +
  'are carried out elsewhere. Whatever you are sent, reply with exactly: ok'

// ---- what the voice is told
// On a ChatGPT sign-in the speech model keeps to its own standing instructions ("I'm ChatGPT…")
// and takes no notice of the ones a call is started with. What it does read is the conversation
// the call starts with, so that is where its instructions go: as the first thing in it, from the
// developer. (Found by trying, 2026-11: with the instructions only in `prompt` it introduced
// itself as ChatGPT, and said "I'll remember that" without handing anything over.)

/** The voice's instructions: who it is on this call, and what it does itself and what it hands over. */
function voiceInstructions(bot: Bot): string {
  const main = listBots()[0]?.id === bot.id
  // The model the bot itself runs on, which does the work: the voice is only how it speaks here.
  const powered = modelName(bot)
  // Whether others have bots on this computer too: then it is not the user's alone, and nor is the plan it is signed in to.
  const shared = sharedComputer()
  return [
    '# Who you are on this call',
    `Your name is ${bot.name}. You are ${main ? "the user's main assistant" : "one of the user's AI bots"} in OpenKumi, an app that runs on ${shared ? 'a computer the user shares with others' : "the user's own computer"}, and you are on a voice call with the user: the one person you work for.` +
      (bot.description ? ` What you are for: ${bot.description}` : '') +
      (shared
        ? " The others on the computer have bots of their own, kept apart from the user's: none of the user's bots can reach theirs, nor theirs the user's. That keeps the bots apart, not the computer: whoever can use the computer's account can read what is kept on it."
        : ''),
    `On this call you are ${bot.name} and nobody else. When asked who or what you are, say you are ${bot.name}, the user's bot in OpenKumi${bot.description ? ', and what you are for' : ''}. ` +
      'OpenKumi is a free, open-source app, created by Juan Cruz Martinez, in which a person keeps their own crew of AI bots on their own computer, each with its own memory, its own files and its own web browser: when asked who made you, or what OpenKumi is, say that. ' +
      'Do not introduce yourself as ChatGPT, as an OpenAI model or as a general assistant. ' +
      (powered ? `What powers you is no secret, though. ${bot.name} is powered by ${powered}, and you can say so, as in "I'm ${bot.name}, your bot in OpenKumi, powered by ${powered}". ` : 'What powers you is no secret, though. ') +
      `Asked what is behind your voice on this call, say that the voice comes with ${shared ? 'the ChatGPT plan this computer is signed in to' : "the user's ChatGPT plan"}, and that you are still ${bot.name}.`,
    '# How you speak',
    'The way one speaks on the phone: warm, natural and brief. A sentence or two at a time, unless they ask for more. Speak the language the user speaks.',
    '# You can only talk. Everything else is delegated.',
    'On this call you have no memory, no notes, no files, no calendar, no mail, no web and no tools of your own. You cannot remember, save, note, look up, check, send, schedule or do anything yourself, and when the call ends you forget all of it. ' +
      `The one way any of that happens is to delegate it: what you delegate is carried out by you, ${bot.name}, in your written conversation with the user, with your real tools, memory and accounts.`,
    [
      'Delegate, every time, without exception:',
      '- anything the user wants remembered, noted, saved, added to a list or kept for later, even one small fact. Saying "I\'ll remember that" without delegating is untrue: nothing is kept;',
      "- anything about the user's own things: their calendar, mail, files, notes, lists, tasks, accounts, earlier conversations, what you did or said before this call;",
      '- anything that needs the web or facts that may have changed: news, prices, the weather, opening hours;',
      '- anything to be done: look up, send, write, create, schedule, remind, change, book, buy, tell another bot.',
      'When in doubt, delegate.',
    ].join('\n'),
    [
      'Examples of what to delegate:',
      '- "Remember that my favourite tea is jasmine." Delegate: "Remember that the user\'s favourite tea is jasmine." Then say: "I\'ll note that."',
      '- "Keep in mind I\'m away next week." Delegate: "Remember that the user is away next week."',
      '- "What\'s on my calendar tomorrow?" Delegate it, and say: "Let me check."',
      'Examples of what you answer yourself: "How are you?", "What\'s two plus two?", "What did you just say?"',
    ].join('\n'),
    [
      'Rules:',
      '- Delegate first, then say in a few words that you are on it. Say everything the user wants, in their words, with every detail they gave, so that it can be understood without the rest of the call.',
      '- Never say that something is done, saved, remembered, added or sent unless you delegated it and the result that came back says so.',
      '- What comes back is what you have to say about it. Tell the user what it says in your own spoken words: the answer first, short, no lists or symbols read out. When it says something went wrong, say so plainly.',
      '- Often what comes back first only says that the work is under way: started in the background, or passed to another bot. Then say just that. The result comes in later, by itself, and you tell the user when it does.',
      '- It can take a while. Meanwhile keep talking with the user if they like. Do not delegate the same thing twice, and do not make up a result that has not come in.',
      '- To the user it is all you: say "let me check" or "I\'ll do that", never that you are asking someone else.',
      '- Only greetings, small talk, and questions you can answer from general knowledge or from what was said on this call are answered without delegating.',
      '- You cannot show anything. Longer things (a table, a document, a page) are in your conversation with the user in the app, for them to read there.',
    ].join('\n'),
    `Today is ${new Date().toDateString()}, and the user's time zone is ${TIME_ZONE}.`,
  ].join('\n\n')
}

type Opening = { role: 'developer' | 'user' | 'assistant'; text: string }

/**
 * What the call starts with, for the voice: its instructions, then the end of the bot's written
 * conversation, so that it knows what the two were just talking about.
 */
function opening(bot: Bot): Opening[] {
  const conversation = db.mainThread(bot.id)
  const kept = (conversation ? db.pageOf(conversation.id).items : [])
    .flatMap(({ data }): Opening[] => (data.type !== 'message' || !data.text.trim() || (data.role === 'user' && data.source !== 'user') ? [] : [{ role: data.role, text: data.text.trim().slice(0, 700) }]))
    .slice(-8)
  return [
    { role: 'developer', text: voiceInstructions(bot) },
    ...(kept.length ? [{ role: 'developer' as const, text: 'For what the two of you were last talking about, this is the end of your written conversation with the user, from before this call:' }, ...kept] : []),
    { role: 'developer', text: 'The call begins now.' },
  ]
}

// ---- the call under way

interface Live {
  call: Call
  codex: AppServer
  /** Codex's conversation behind the call. */
  thread: string
  /** What was said, in order, for the record. */
  lines: CallLine[]
  /** When its app last said it is still there. */
  seenAt: number
  /** When something was last said, or came back from the bot. */
  heardAt: number
  /** How much of `lines` had been said when the voice last handed something to the bot, what it handed over then, and the user's own words for it. */
  handed: { at: number; request: string; words: string }
  /** Everything the voice handed to the bot, in order. */
  passed: string[]
  /** How many things the voice handed over the bot has not answered yet. */
  asked: number
  watch: NodeJS.Timeout
  over: boolean
}

let live: Live | null = null

export const currentCall = (): Call | null => live?.call ?? null

const announce = (error?: string) => emit({ type: 'call', call: currentCall(), ...(error ? { error } : {}) })

/**
 * Calls a bot. `offer` is the calling app's half of the connection (an SDP offer with a microphone
 * track and the data channel the speech model expects); what comes back is the other half. A call
 * that is under way is ended first: there is one at a time.
 */
export async function startCall(botId: string, offer: unknown): Promise<{ call: Call; sdp: string }> {
  const bot = getBot(botId)
  if (!bot) throw new CallError('No such bot')
  if (typeof offer !== 'string' || !offer.startsWith('v=0') || offer.length > 20_000) throw new CallError('That is not a connection a call can be made with.')
  const info = callsInfo()
  if (!info.available) throw new CallError(info.reason)
  if (live) endCall(live.call.id)
  // A voice being tried out gives way to a call.
  if (sample) endSample(sample.id)

  // The call takes its place before anything is waited for, so that of two started at once the first is ended, not left behind.
  const codex = startCodex()
  const call: Call = { id: `call_${crypto.randomBytes(9).toString('base64url')}`, botId: bot.id, state: 'connecting', startedAt: Date.now(), working: 0 }
  const session: Live = { call, codex, thread: '', lines: [], seenAt: Date.now(), heardAt: Date.now(), handed: { at: 0, request: '', words: '' }, passed: [], asked: 0, watch: setInterval(() => check(session), 5000), over: false }
  session.watch.unref()
  live = session
  announce()

  try {
    // One deadline for all of it: Codex starting up, its conversation, and the other half of the connection.
    const sdp = await within(ANSWER_WITHIN, 'The call was not answered in time.', connect(session, bot, offer))
    if (session.over) throw new Error('The call was ended.')
    codex.heard = (method, params) => heard(session, method, params)
    codex.gone = (why) => finish(session, `The call was cut off: ${why}`)
    session.call = { ...session.call, state: 'live' }
    session.heardAt = Date.now()
    announce()
    return { call: session.call, sdp }
  } catch (e: any) {
    // Ended meanwhile (another call was started, the bot was deleted): that is why, whatever Codex said as it was let go.
    const why = session.over ? 'The call was ended.' : readable(String(e?.message ?? e))
    finish(session, why)
    throw new CallError(why)
  }
}

/** Sets a call up with Codex, and gives the other half of the connection. */
async function connect(session: Live, bot: Bot, offer: string): Promise<string> {
  // What the bot's own model is called, for the voice to say what powers it.
  await learnModels(getProvider(bot.provider)).catch(() => {})
  return setUp(session, offer, { voice: bot.voice ?? '', prompt: voiceInstructions(bot), items: opening(bot) })
}

/** A voice on the line: what a call and a sample of a voice both have of Codex. */
interface Line {
  codex: AppServer
  /** Codex's conversation behind it. */
  thread: string
}

/** Has Codex put a voice on the line, with what it is told, and gives the other half of the connection. */
async function setUp(session: Line, offer: string, { voice, prompt, items }: { voice: string; prompt: string; items: Opening[] }): Promise<string> {
  const { codex } = session
  await greet(codex)
  const opened = await codex.ask('thread/start', { cwd: path.join(HOME, 'calls', 'workspace'), approvalPolicy: 'never', sandbox: 'read-only', developerInstructions: NOTHING_TO_DO, ephemeral: true })
  session.thread = String(opened?.thread?.id ?? '')
  if (!session.thread) throw new Error('Codex did not open a conversation for the call.')
  // The other half of the connection arrives as a message of its own, or the reason there is none.
  const answer = new Promise<string>((resolve, reject) => {
    codex.heard = (method, params) => {
      if (method === 'thread/realtime/sdp' && typeof params.sdp === 'string') resolve(params.sdp)
      else if (method === 'thread/realtime/error' || method === 'thread/realtime/closed') reject(new Error(readable(String(params.message ?? params.reason ?? 'The call could not be set up.'))))
    }
    codex.gone = (why) => reject(new Error(why))
  })
  // A refusal can come either way: as the answer to the request, or as a message of its own.
  answer.catch(() => {})
  await codex.ask('thread/realtime/start', {
    threadId: session.thread,
    outputModality: 'audio',
    transport: { type: 'webrtc', sdp: offer },
    // The only version a ChatGPT sign-in is let use over WebRTC.
    version: 'v3',
    ...(voice ? { voice } : {}),
    // Its instructions go where it reads them, in what the call starts with (see `opening`), and
    // here too, for a speech model that does take them from here.
    prompt,
    initialItems: items,
    // Codex would add what it knows of the user's own work with it, which is none of a bot's business.
    includeStartupContext: false,
    // What the voice hands over is not answered by Codex: the server passes it to the bot, and has the voice say what the bot answered.
    clientManagedHandoffs: true,
  })
  return answer
}

/** What Codex says went wrong, in words for the owner. */
function readable(message: string): string {
  if (/requires API key auth/i.test(message)) return 'Calls need Codex to be signed in with a ChatGPT plan.'
  if (/unknown (method|variant)|method not found|experimentalApi/i.test(message)) return 'This version of Codex cannot make calls. Update Codex on the computer running OpenKumi, then try again.'
  if (/not supported for v3|supported voices/i.test(message)) return 'The voice chosen for this bot is not one Codex offers any more. Choose another in the bot’s settings.'
  if (/usage limit|rate limit|quota/i.test(message)) return `Your ChatGPT plan did not allow the call: ${message}`
  return message
}

/** What Codex reports as the call goes on. */
function heard(session: Live, method: string, params: any) {
  if (session.over) return
  if (method === 'thread/realtime/transcript/delta' && typeof params.delta === 'string') {
    session.heardAt = Date.now()
    emit({ type: 'call.words', callId: session.call.id, role: roleOf(params.role), text: params.delta, done: false })
  } else if (method === 'thread/realtime/transcript/done' && typeof params.text === 'string') {
    session.heardAt = Date.now()
    const line: CallLine = { role: roleOf(params.role), text: params.text.trim() }
    if (!line.text) return
    session.lines.push(line)
    emit({ type: 'call.words', callId: session.call.id, role: line.role, text: line.text, done: true })
  } else if (method === 'thread/realtime/itemAdded' && params.item?.type === 'handoff_request') {
    handOver(session, params.item)
  } else if (method === 'thread/realtime/error') {
    finish(session, readable(String(params.message ?? 'The call failed.')))
  } else if (method === 'thread/realtime/closed') {
    finish(session, params.reason === 'requested' ? undefined : 'The call was cut off.')
  }
}

const roleOf = (role: unknown): CallLine['role'] => (role === 'user' ? 'user' : 'assistant')

/**
 * The voice handed something over: it goes to the bot's own conversation as a message from the
 * owner, read at once even if the bot is at work, and what the bot answers is given to the voice
 * to say. The bot does it as itself, whether or not the call is still going when it is done.
 */
function handOver(session: Live, item: { input_transcript?: unknown; active_transcript?: unknown }) {
  const request = typeof item.input_transcript === 'string' ? item.input_transcript.trim() : ''
  if (!request) return
  const bot = getBot(session.call.botId)
  if (!bot) return finish(session, 'The bot is gone.')
  // What was said since the voice last handed something over.
  const lately: CallLine[] = (Array.isArray(item.active_transcript) ? item.active_transcript : []).flatMap((line: any) =>
    typeof line?.text === 'string' && line.text.trim() ? [{ role: roleOf(line.role), text: line.text.trim() }] : [],
  )
  // Without the request itself, when the voice passed it on in the user's own words.
  const before = lately.filter((line) => !same(line.text, request)).map((line) => `${line.role === 'user' ? 'User' : 'You'}: ${line.text}`).join('\n').slice(-2000)
  const said: Omit<Said, 'type' | 'role' | 'attachments'> = { source: 'user', text: request, via: 'call', ...(before ? { before } : {}) }
  session.handed = { at: session.lines.length, request, words: lately.findLast((line) => line.role === 'user')?.text ?? '' }
  session.passed.push(request)
  // More than one thing may be under way: the voice is told which this is about.
  const about = `“${request.slice(0, 200)}”`
  session.asked++
  working(session)
  agent
    // It is answered in a turn of its own, in which the bot only passes work on. A bot at work on something else gets to it after that.
    .ask(agent.conversation(bot.id).id, said, { waits: () => say(session, `About ${about}: you are still in the middle of something else, and get to this right after it. Tell the user so, briefly.`) })
    .then(
      ({ text, also }) =>
        // An answer that is also to something the owner wrote meanwhile, and had the bot read at once, is theirs to read.
        also.some((other) => other.via !== 'call') ? 'The answer is in the conversation, where it also answers something that was written there meanwhile.' : text.trim() || 'It was taken up, and nothing was said about it yet.',
      (e: Error) => `That did not work. ${e.message}`,
    )
    .then((result) => {
      session.asked--
      working(session)
      say(session, `What came back for ${about}:\n\n${sayable(result)}`)
    })
}

/** Whether two things said are the same, by their letters and digits alone, in whatever language. */
const same = (a: string, b: string) => letters(a) === letters(b)
// Marks are kept: in many scripts they are what tells one word from another.
const letters = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()

const sayable = (text: string) => (text.length > SAYABLE ? `${text.slice(0, SAYABLE)}\n\n(There is more: it is in the conversation, in the app.)` : text)

/** Gives the voice something to say. */
function say(session: Live, text: string) {
  if (session.over) return
  session.heardAt = Date.now()
  session.codex.ask('thread/realtime/appendSpeech', { threadId: session.thread, text }).catch((e) => console.error('Could not give the voice something to say:', e.message))
}

// What the bot passed on while on the call comes back to its conversation (a subagent's report,
// another bot's reply, an automation's result), and the bot answers that there as it always
// does. While the call lasts, the voice says that answer too.
agent.onAnswered((threadId, asked, reply) => {
  const session = live
  if (!session || session.over || session.call.state !== 'live' || db.mainThread(session.call.botId)?.id !== threadId) return
  working(session)
  const said = asked.flatMap((item) => (item.data.type === 'message' && item.data.role === 'user' ? [item.data] : []))
  // Only an answer to nothing but that: what was asked on the call itself is said where it was handed over, and an
  // answer that is also to something the owner wrote meanwhile is theirs to read.
  if (!said.length || !said.every((message) => ofThisCall(session, message))) return
  const text = reply().trim()
  if (text) say(session, `A result has come in for something that was under way. Tell the user what it says:\n\n${sayable(text)}`)
})

/**
 * Whether something that came back to the bot's conversation is of work the bot passed on from
 * this call (tools.ts notes what a turn that answers a call passes on): the report of a subagent
 * it started or wrote to, the result of a run of an automation it made or changed, another bot's
 * reply to a message it sent. Whatever else comes in meanwhile is not the call's: it stays in
 * the conversation, and is neither said nor sent to the speech model.
 */
function ofThisCall(session: Live, message: Said): boolean {
  const since = session.call.startedAt
  // As agent.describeSubagent writes it.
  if (message.source === 'subagent') return passedOnAt(/\(id: ([^\s)]+)\) — /.exec(message.text)?.[1] ?? '') >= since
  if (message.source === 'automation') {
    // As automations.finishRun writes it. Not a run that was already under way when the call made the change.
    const [, id = '', run = ''] = /\(automation: ([^\s,)]+), run: ([^\s)]+)\) — /.exec(message.text) ?? []
    const at = passedOnAt(id)
    return at >= since && (db.getThread(run)?.createdAt ?? 0) >= at
  }
  if (message.source === 'bot') return !!message.answers && passedOnAt(`message:${message.answers}`) >= since
  return false
}

/** Says how much the bot is at work on for the caller: what it has not answered yet, and the subagents it started on this call. */
function working(session: Live) {
  if (session.over) return
  const conversation = db.mainThread(session.call.botId)
  const count = session.asked + (conversation ? agent.subagentsAtWork(conversation.id, session.call.startedAt) : 0)
  if (count === session.call.working) return
  session.call = { ...session.call, working: count }
  announce()
}

/** Ends a call that nobody is on any more: its app went away, or nothing has been said for a long time. */
function check(session: Live) {
  if (session.over) return
  if (Date.now() - session.seenAt > GONE_AFTER) return finish(session)
  // A subagent may have ended without anything coming of it.
  working(session)
  if (session.call.working === 0 && Date.now() - session.heardAt > QUIET_FOR) finish(session, 'The call was ended because nothing had been said for five minutes.')
}

/** The calling app says it is still there. False when the call is over, which is how the app learns of it. */
export function alive(id: string): boolean {
  if (live?.call.id !== id) return false
  live.seenAt = Date.now()
  return true
}

/** Hangs up. */
export function endCall(id: string) {
  if (live?.call.id === id) finish(live)
}

/** Set while the server shuts down: a call that ends then is not gone over, since nothing new starts. */
let closing = false

/** Ends the call under way, for the server to shut down. */
export function endCalls() {
  closing = true
  if (live) finish(live)
  if (sample) endSample(sample.id)
}

/** The call is over: Codex is let go, and the conversation keeps a record of what was said. `error` is why, when it did not end by being hung up. */
function finish(session: Live, error?: string) {
  if (session.over) return
  session.over = true
  clearInterval(session.watch)
  if (session.thread) session.codex.ask('thread/realtime/stop', { threadId: session.thread }).catch(() => {})
  // A call still being set up hears of this from Codex going: nothing it says from here on is acted on.
  session.codex.close()
  const current = live === session
  if (current) live = null
  if (!closing) track('call ended', { seconds: (Date.now() - session.call.startedAt) / 1000, failed: !!error })
  if (session.lines.length && getBot(session.call.botId)) {
    const seconds = Math.max(1, Math.round((Date.now() - session.call.startedAt) / 1000))
    try {
      db.addItem(agent.conversation(session.call.botId).id, { type: 'call', seconds, lines: session.lines })
      if (!closing) lookBack(session)
    } catch (e) {
      console.error('Could not keep the record of a call:', e)
    }
  }
  if (current) announce(error)
}

// ---- after a call
// What the voice hands over is the voice's own choice, and it does not always choose right: it
// may say "I'll remember that" and hand nothing over. So when a call ends, the bot itself is
// shown the part of it that never reached it, and does what was asked or promised there. It
// does so in the background, in a thread of its own beneath the conversation, as a subagent
// does; the conversation only hears of it when there was something to do.

/** What a bot says when the part of a call it was not given held nothing for it to do. */
const NOTHING_FOUND = /^nothing to do\.?$/i

const LOOK_BACK = (passed: string[], said: string) =>
  'A voice call between you and the user has just ended. On a call a voice speaks for you, and passes on to you what the user asks for. ' +
  (passed.length
    ? `These were passed on to you during the call, and have been seen to in your conversation with the user, so none of them is to be done again:\n${passed.map((request) => `- ${request}`).join('\n')}\n\nThis part of the call, after the last of them, was not passed on to you:`
    : 'Nothing was passed on to you during this call. This is what was said on it:') +
  `\n\n${said}\n\n` +
  'Look through it for anything else the user asked you to remember, note or do, and anything else your voice said it would do. ' +
  'Where your voice tells the user what came of something that was passed on, that is done, and not to be done again. Do each thing that is left now, as far as it is clear what was meant: ' +
  'keep what is to be remembered where you will find it again (memory/ or AGENTS.md), set up what was to be scheduled. ' +
  'Do nothing that was not asked for there, and nothing that needs the user\'s go-ahead (a purchase, sending a message, deleting something): say what is waiting for them instead.\n\n' +
  'If there is nothing of the kind, make your final message exactly "Nothing to do." Otherwise say in a sentence or two what you did, for the user to read.'

/** Has the bot go over what was said after the voice last handed it something, when the user said anything there. */
function lookBack(session: Live) {
  const { at, request, words } = session.handed
  // What the user said to have the last thing handed over is written down a moment after it, so it is among these: it is left out.
  const unheard = session.lines.slice(at).filter((line) => !(request && line.role === 'user' && (same(line.text, request) || same(line.text, words))))
  if (!unheard.some((line) => line.role === 'user')) return
  const conversation = agent.conversation(session.call.botId)
  const said = unheard.map((line) => `${line.role === 'user' ? 'User' : 'You'}: ${line.text}`).join('\n').slice(-6000)
  // Marked as reported, so that it is not passed to the conversation when there was nothing to do.
  const thread = db.createThread({ botId: session.call.botId, parentId: conversation.id, kind: 'subagent', title: 'After the call' })
  db.updateThread(thread.id, { reported: true })
  agent.ask(thread.id, { source: 'parent', text: LOOK_BACK(session.passed.slice(-20).map((request) => request.slice(0, 300)), said) }).then(
    ({ text: did }) => {
      if (!did.trim() || NOTHING_FOUND.test(did.trim())) return
      const now = db.mainThread(session.call.botId)
      const done = db.getThread(thread.id)
      // The bot tells the user what it did after the call, in its conversation.
      if (now && done) agent.postMessage(now.id, { source: 'subagent', text: `<subagent_notification>\n${agent.describeSubagent(done)}\n</subagent_notification>` })
    },
    (e: Error) => console.error('The bot could not go over what was said on a call:', e.message),
  )
}

// ---- hearing a voice before choosing it
// A voice is tried out the way it will be heard: on the line, saying a line as the bot. It is a
// call in small, set up the same way through Codex, in which nobody is listened to and nothing is
// kept: the voice says its one line and the app hangs up. There is one at a time, and none while
// a call is on. (Found by trying, 2026-11: on a connection that only listens the voice never
// speaks, so the app sends the silence of a microphone that is switched off.)

/** A sample that nobody ended is ended after this long. */
const SAMPLE_FOR = 30_000
/** How long the voice is given to say its line. */
const SAID_WITHIN = 15_000
/** A voice that has not begun its line after this long is asked for it again. */
const ASK_AGAIN_AFTER = 3500

interface Sample extends Line {
  id: string
  /** The line the voice says. */
  words: string
  /** It has begun to say it. */
  speaking: boolean
  over: boolean
  /** Called when the voice has said its line. */
  said: () => void
  late: NodeJS.Timeout
}

let sample: Sample | null = null

/** What the voice is told when it is only being tried out. */
const SAMPLE_INSTRUCTIONS = (bot: Bot) =>
  [
    `This is a sound check, not a conversation. You are the voice of ${bot.name}, the user's bot in OpenKumi, and the user wants to hear what you sound like.`,
    'You will be given one line. Say exactly that line, once, warmly and naturally, as one says hello on the phone. Say nothing before it and nothing after it, do not answer anything you hear, and do not offer help.',
  ].join('\n')

/**
 * Puts one voice on the line for the app to hear. `offer` is the app's half of the connection, as
 * for a call; what comes back is the other half. The voice says nothing until `saySample` asks it
 * to, which the app does once the sound can reach it.
 */
export async function startSample(botId: string, voice: unknown, offer: unknown): Promise<{ id: string; sdp: string }> {
  const bot = getBot(botId)
  if (!bot) throw new CallError('No such bot')
  if (typeof offer !== 'string' || !offer.startsWith('v=0') || offer.length > 20_000) throw new CallError('That is not a connection a voice can be heard over.')
  if (typeof voice !== 'string' || voice.length > 60) throw new CallError('That is not a voice.')
  const info = callsInfo()
  if (!info.available) throw new CallError(info.reason)
  if (live) throw new CallError('A call is under way. Hang up to hear another voice.')
  if (sample) endSample(sample.id)

  const codex = startCodex()
  const mine: Sample = {
    id: `sample_${crypto.randomBytes(9).toString('base64url')}`,
    codex,
    thread: '',
    words: `Hi, I'm ${bot.name}. This is how I sound when you call me.`,
    speaking: false,
    over: false,
    said: () => {},
    late: setTimeout(() => endSample(mine.id), SAMPLE_FOR),
  }
  mine.late.unref()
  sample = mine
  try {
    const sdp = await within(ANSWER_WITHIN, 'The voice did not come on the line in time.', setUp(mine, offer, { voice, prompt: SAMPLE_INSTRUCTIONS(bot), items: [{ role: 'developer', text: SAMPLE_INSTRUCTIONS(bot) }] }))
    if (mine.over) throw new Error('Another voice was asked for.')
    codex.heard = (method, params) => {
      if (method === 'thread/realtime/transcript/delta' && params.role !== 'user') mine.speaking = true
      else if (method === 'thread/realtime/transcript/done' && params.role !== 'user') ((mine.speaking = true), mine.said())
      else if (method === 'thread/realtime/error' || method === 'thread/realtime/closed') endSample(mine.id)
    }
    codex.gone = () => endSample(mine.id)
    return { id: mine.id, sdp }
  } catch (e: any) {
    const why = mine.over ? 'Another voice was asked for.' : readable(String(e?.message ?? e))
    endSample(mine.id)
    throw new CallError(why)
  }
}

/** Has the voice say its line. Answers once it has (or has had time to), with the line, so the app can tell how long it takes to hear. */
export async function saySample(id: string): Promise<{ words: string }> {
  const mine = sample
  if (!mine || mine.id !== id || mine.over || !mine.thread) throw new CallError('That voice is no longer on the line.')
  const said = new Promise<void>((resolve) => (mine.said = resolve))
  const ask = () => mine.codex.ask('thread/realtime/appendSpeech', { threadId: mine.thread, text: `Say exactly this line, and nothing else: ${mine.words}` })
  await ask()
  // The speech model only runs while sound is coming in from the app (silence will do), and what it is
  // given before that is lost. So it is asked again when it has not begun to speak after a while.
  for (let again = 0; again < 2; again++) {
    const done = await Promise.race([said.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ASK_AGAIN_AFTER).unref())])
    if (done || mine.over || mine.speaking) break
    await ask().catch(() => {})
  }
  await within(SAID_WITHIN, '', said).catch(() => {})
  return { words: mine.words }
}

/** Lets the voice go: it was heard, or another was asked for. */
export function endSample(id: string) {
  const mine = sample
  if (!mine || mine.id !== id || mine.over) return
  mine.over = true
  sample = null
  clearTimeout(mine.late)
  mine.said()
  if (mine.thread) mine.codex.ask('thread/realtime/stop', { threadId: mine.thread }).catch(() => {})
  mine.codex.close()
}

// ---- the voices a bot can have

let known: Promise<{ voices: string[]; usual: string }> | null = null

/** The voices Codex offers for calls, and the one it uses when none is chosen. Asked once: they come with the program. */
export function voices(): Promise<{ voices: string[]; usual: string }> {
  known ??= (async () => {
    const codex = startCodex()
    try {
      const list = (await within(ANSWER_WITHIN, 'Codex did not say which voices it has.', greet(codex).then(() => codex.ask('thread/realtime/listVoices', {}))))?.voices ?? {}
      const names: string[] = (Array.isArray(list.v3) ? list.v3 : []).filter((v: unknown) => typeof v === 'string')
      return { voices: names, usual: typeof list.defaultV1 === 'string' && names.includes(list.defaultV1) ? list.defaultV1 : (names[0] ?? '') }
    } finally {
      codex.close()
    }
  })()
  // A failure is not kept: Codex may be installed, or updated, later.
  known.catch(() => (known = null))
  return known
}
