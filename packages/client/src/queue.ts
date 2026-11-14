// What waits for a bot, and the messages bots send each other: what both apps say and do about them.
// Everything said to a bot waits in a queue on the server and is read one message at a time; the
// owner can take a waiting message back, have it read now, or let a bot that was stopped go on.
import { useMemo } from 'react'
import type { Queued, Said, Thread } from '@openkumi/shared'
import { parseReport, reportWord } from './reports'
import { api, useStore } from './store'

/** The messages waiting in a thread, in the order the bot will read them: the ones to be read now first. */
export function useWaiting(thread: Thread | undefined): Queued[] {
  const queue = useStore((s) => s.queue)
  const id = thread?.id
  return useMemo(() => (id ? queue.filter((w) => w.threadId === id).sort((a, b) => Number(b.now) - Number(a.now) || a.id - b.id) : []), [queue, id])
}

/** Who a message that was not written by the owner is from, in a few words. */
export function fromWhom(message: Said): string {
  switch (message.source) {
    case 'user': return 'You'
    case 'bot': return message.bot?.name ?? 'Another bot'
    case 'subagent': return 'A subagent'
    case 'automation': return 'An automation'
    case 'trigger': return 'Automation'
    case 'parent': return 'The conversation above'
  }
}

/**
 * What a waiting message says, as shown while it waits. A report from the bot's own work is long and
 * wrapped in tags meant for the bot, so it is told in a line: "Subagent “Compare prices” completed".
 */
export function waitingText(message: Said): string {
  const report = parseReport(message.text)
  if (!report) return message.text
  return report.kind === 'subagent' ? `Subagent “${report.name}” ${report.status}` : `Automation “${report.name}” ${reportWord(report.status)}`
}

/** Only what the owner or another bot wrote can be taken back: what the bot's own work reports is its to read. */
export const canTakeBack = (message: Said) => message.source === 'user' || message.source === 'bot'

/** Takes a waiting message back, so that the bot never reads it. */
export const takeBack = (id: number) => api('DELETE', `/api/queue/${id}`)
/** Has the bot read a waiting message now, as it works, instead of when its turn comes. */
export const sendNow = (id: number) => api('POST', `/api/queue/${id}/now`)
/** Lets a bot that was stopped go on with what was held back for it. */
export const letGo = (threadId: string) => api('POST', `/api/threads/${threadId}/queue/go`)

/** Where a message is: in which bot's thread, and which item of it. */
export interface Place {
  botId: string
  threadId: string
  itemId: number
}

/**
 * The two ends of a message between bots, by the key they share: the sender's record of it, and
 * the message as the other bot got it, which is missing while it still waits to be read.
 */
export const bothEnds = (key: string) => api<{ sent: Place | null; received: Place | null }>('GET', `/api/messages/${encodeURIComponent(key)}`)
