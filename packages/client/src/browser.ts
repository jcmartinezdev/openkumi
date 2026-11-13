// What every app needs to show a bot's browser: which window is whose, and who is driving it. Each
// thread of a bot (its conversation, a subagent, a scheduled run) browses in a window of its own;
// the owner watches one, and takes control of it to use the page themselves.
import type { BrowserState, BrowserWindow, Thread } from '@openkumi/shared'
import { mainThread, send } from './store'

/** This view's own name for itself when it takes control of a window. A new one each time the app starts. */
export const viewer = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** Who is driving a window, as this view sees it: the bot, this view, or the owner on another device. */
export type Driver = 'bot' | 'you' | 'elsewhere'

export const driverOf = (win: BrowserWindow | undefined): Driver => (!win?.controller ? 'bot' : win.controller === viewer ? 'you' : 'elsewhere')

/** Takes control of a window for this view, hands it back to the bot, or says no to what the bot asked. */
export function control(botId: string, windowId: string, action: 'take' | 'give' | 'decline') {
  send({ type: 'browser.control', botId, windowId, viewer, action })
}

/** The window a thread works in, if it has one. */
export function windowOf(browser: BrowserState | undefined, threadId: string | undefined): BrowserWindow | undefined {
  if (!browser?.running || !threadId) return undefined
  // Servers from before windows had tabs only; each thread had one.
  return (browser.windows ?? []).find((w) => w.threadId === threadId)
}

/** The thread whose window a view of `thread` shows: an earlier conversation's window went to the current one. */
export function browsingThread(threads: Thread[], thread: Thread | undefined): Thread | undefined {
  return thread?.archivedAt ? mainThread(threads, thread.botId) : thread
}

/** The window a superpower's sign-in happens in: a window of the bot's browser that belongs to no thread. */
export const signInThread = (superpowerId: string) => `sign-in:${superpowerId}`

/** Whose session a window is, in a few words. */
export function sessionName(threads: Thread[], threadId: string | null | undefined): string {
  if (threadId?.startsWith('sign-in:')) return 'Signing in'
  const thread = threads.find((t) => t.id === threadId)
  if (!thread || thread.kind === 'chat') return 'Conversation'
  return thread.kind === 'task' ? `Scheduled: ${thread.title}` : thread.title
}

/** "2 windows": one for each thread of the bot that is browsing. */
export function windowCount(browser: BrowserState): string {
  const count = browser.windows?.length ?? browser.tabs.length
  return `${count} ${count === 1 ? 'window' : 'windows'}`
}

/** The address of a page, short: its host, or what there is when it has none. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}
