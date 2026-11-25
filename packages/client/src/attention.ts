// What a bot has for its owner, as both apps show it beside the bot. Things happen in a bot's
// conversation while its owner is elsewhere (an automation's result, another bot's message, a
// subagent's report), so each bot wears one mark, the first of these that holds:
//   needs    it waits for its owner: in its browser, with messages held back, or for an answer
//   read     it told them something that should not wait until they next look
//   working  it is at work
//   failed   its last run failed
//   new      it said something they have not read
// The server keeps what this is read from (Thread.told, readTo and flag; see agent.ts), so every
// device shows the same, and reading on one clears it on the others.
import type { Bot, BrowserState, Queued, Thread } from '@openkumi/shared'
import { ApiError, api, assume, onEnvironmentChange, onState } from './store'

export type AttentionMark = 'needs' | 'read' | 'working' | 'failed' | 'new'

export interface Attention {
  mark: AttentionMark | null
  /** For 'needs' and 'read': what it is about, in a line. */
  reason: string
}

/** What each mark is called, where it is said in words. */
export const MARK_WORDS: Record<AttentionMark, string> = { needs: 'Needs you', read: 'Read this', working: 'Working', failed: 'Failed', new: 'New' }

/** What the apps hold that the marks are read from. */
export interface Standing {
  threads: Thread[]
  browsers: Record<string, BrowserState>
  queue: Queued[]
}

const NOTHING: Attention = { mark: null, reason: '' }

/** The mark a bot wears. */
export function attentionOf(botId: string, { threads, browsers, queue }: Standing): Attention {
  const main = threads.find((t) => t.botId === botId && !t.parentId && !t.archivedAt)
  if (!main) return NOTHING
  // Its conversation, and the subagents and runs beneath it that the list holds: the ones at work, or that were until a while ago.
  const family = new Map([[main.id, main]])
  for (let grew = true; grew; ) {
    grew = false
    for (const t of threads) if (t.parentId && family.has(t.parentId) && !family.has(t.id)) (family.set(t.id, t), (grew = true))
  }
  // Waiting in its browser comes first: the bot only waits so long there.
  const asked = (browsers[botId]?.windows ?? []).find((w) => w.request && w.threadId && family.has(w.threadId))
  if (asked?.request) return { mark: 'needs', reason: asked.request }
  if (main.flag?.kind === 'answer') return { mark: 'needs', reason: main.flag.reason }
  const held = main.held ? queue.filter((w) => w.threadId === main.id).length : 0
  if (held) return { mark: 'needs', reason: held === 1 ? 'A message is held back for it' : `${held} messages are held back for it` }
  if (main.flag?.kind === 'read') return { mark: 'read', reason: main.flag.reason }
  for (const t of family.values()) if (t.status === 'running') return { mark: 'working', reason: '' }
  if (main.status === 'error') return { mark: 'failed', reason: '' }
  if ((main.told ?? 0) > (main.readTo ?? 0)) return { mark: 'new', reason: '' }
  return NOTHING
}

/** Whether a mark is one the owner is wanted for: what the count on the app's icon counts. */
export const wantsOwner = (mark: AttentionMark | null) => mark === 'needs' || mark === 'read' || mark === 'new'

/** What a notification says when a bot needs its owner, or has something for them to read now. None for any other mark. */
export function noticeOf(bot: Pick<Bot, 'name'>, attention: Attention): { title: string; body: string } | null {
  if (attention.mark === 'needs') return { title: `${bot.name} needs you`, body: attention.reason }
  if (attention.mark === 'read') return { title: `${bot.name}: read this`, body: attention.reason }
  return null
}

/**
 * Whether a conversation has something its owner has not read, or was asked to read: what an app
 * that has it in front of them tells the server about (`markRead`).
 */
export const unread = (thread: Thread | undefined) => !!thread && !thread.parentId && !thread.archivedAt && ((thread.told ?? 0) > (thread.readTo ?? 0) || thread.flag?.kind === 'read')

/**
 * Says that the owner has a conversation in front of them, read up to what the bot last said. It
 * shows as read here at once, so that what a bot says to someone looking at it is never marked as
 * new, even for a moment. An older server does not keep what was read, and says so; nothing is
 * new there either.
 */
export function markRead(thread: Thread): Promise<unknown> {
  const upTo = thread.told ?? 0
  assume(thread.id, { readTo: Math.max(upTo, thread.readTo ?? 0), ...(thread.flag?.kind === 'read' ? { flag: null } : {}) })
  return tellRead(thread.id, upTo)
}

/**
 * What the server has still to be told was read, by thread: it could not be reached, or failed,
 * when the conversation was read. It shows as read here already, and the other devices go by what
 * the server knows, so it is said again when the connection comes back, and every so often until then.
 */
const untold = new Map<string, number>()
let again: ReturnType<typeof setTimeout> | undefined
// The threads of an environment that was left mean nothing in the next one.
onEnvironmentChange(() => (untold.clear(), clearTimeout(again)))
let connected = false
onState((state) => {
  if (state.connected && !connected) tellAgain()
  connected = state.connected
})

function tellAgain() {
  for (const [threadId, upTo] of untold) void tellRead(threadId, upTo)
}

function tellRead(threadId: string, upTo: number): Promise<unknown> {
  untold.set(threadId, upTo)
  /** Nothing more to say about this thread, unless it was read further meanwhile. */
  const said = () => {
    if (untold.get(threadId) === upTo) untold.delete(threadId)
    if (!untold.size) clearTimeout(again)
  }
  return api('POST', `/api/threads/${threadId}/seen`, { upTo }).then(said, (e) => {
    // A server that says no would say it again: an older one keeps nothing of the kind, or the thread is gone.
    if (e instanceof ApiError && e.status < 500) return said()
    clearTimeout(again)
    again = setTimeout(tellAgain, 30_000)
  })
}

/** Clears what a bot raised for its owner, without answering it. */
export const clearFlag = (threadId: string) => api('DELETE', `/api/threads/${threadId}/flag`)
