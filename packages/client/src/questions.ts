// What a bot asked its owner with ask_user, as both apps show and answer it. The questions stand
// on the bot's conversation with its "Needs you" mark (Thread.flag.questions), so every device
// shows the same card over its composer, and answering on one closes it on the others: the
// answers go to the bot as a message from the owner, which clears the mark like anything they write.
import { useEffect, useMemo, useState } from 'react'
import type { Question, Thread } from '@openkumi/shared'
import { parse } from './steps'
import { api } from './store'

const NONE: Question[] = []

/** The questions that wait for the owner in a conversation: none in a subagent's thread, or one that was set aside. */
export const openQuestions = (thread: Thread | undefined): Question[] =>
  thread && !thread.parentId && !thread.archivedAt && thread.flag?.kind === 'answer' && thread.flag.questions?.length ? thread.flag.questions : NONE

/**
 * What an ask_user call asked, in its questions' own words: the conversation shows them where
 * they were asked, once the card is gone. None when the call cannot be read.
 */
export function askedIn(call: { arguments: string }): string[] {
  const { questions } = parse(call.arguments)
  if (!Array.isArray(questions)) return []
  return questions.flatMap((q) => (typeof q?.question === 'string' && q.question.trim() ? [q.question.replace(/\s+/g, ' ').trim()] : []))
}

/** What the owner answered to one question: the options they chose, and what they wrote themselves. */
export interface Reply {
  chosen: string[]
  written: string
}

const NO_REPLY: Reply = { chosen: [], written: '' }

/** Whether a question was answered at all. */
export const replied = (reply: Reply | undefined) => !!reply && (reply.chosen.length > 0 || !!reply.written.trim())

/** A reply after one of the question's options was pressed: among several it goes on or off, otherwise it is the answer, in place of anything written. */
export function choose(question: Question, reply: Reply = NO_REPLY, label: string): Reply {
  const on = reply.chosen.includes(label)
  if (question.multiple) return { ...reply, chosen: on ? reply.chosen.filter((l) => l !== label) : [...reply.chosen, label] }
  return { chosen: on ? [] : [label], written: '' }
}

/** A reply after the owner wrote an answer of their own: with several to choose from it is one more, otherwise it is the answer. */
export function write(question: Question, reply: Reply = NO_REPLY, text: string): Reply {
  return { chosen: question.multiple || !text.trim() ? reply.chosen : [], written: text }
}

/**
 * The owner's answers as the message that goes to the bot, which is also how they read it back in
 * the conversation: each question, and under it what they chose or wrote. The question is said
 * again so that the bot knows which answer is to what, also once its own record of asking is gone
 * (a summary took its place, or it moved to another model).
 */
export function answerText(questions: Question[], replies: (Reply | undefined)[]): string {
  return questions
    .map((q, at) => {
      const reply = replies[at] ?? NO_REPLY
      // In the order the bot offered them, whatever order they were chosen in.
      const picked = q.options.map((option) => option.label).filter((label) => reply.chosen.includes(label))
      const written = reply.written.trim()
      const lines = [...picked, ...(written ? [written] : [])]
      return `${q.question}\n${(lines.length ? lines : ['(no answer)']).map((text) => `→ ${text}`).join('\n')}`
    })
    .join('\n\n')
}

/**
 * Sends the answers to the bot, as a message from its owner in the conversation that asked. The
 * card stays as it is until the server says the mark is cleared, so nothing answered is lost when
 * the message does not get through.
 */
export const sendAnswers = (thread: Thread, questions: Question[], replies: (Reply | undefined)[]): Promise<unknown> =>
  api('POST', `/api/threads/${thread.id}/messages`, { text: answerText(questions, replies) })

/** The card's state: which question is in front, and what was answered to each so far. */
export interface Answering {
  /** The question in front, counted from 0. */
  at: number
  question: Question
  reply: Reply
  replies: (Reply | undefined)[]
  /** It is the last one: what comes next is sending. */
  last: boolean
  /** Something was answered, so there is something to send. */
  ready: boolean
  go: (to: number) => void
  /** Presses one of the options of the question in front. */
  pick: (label: string) => void
  /** Takes what the owner writes as their own answer to the question in front. */
  write: (text: string) => void
}

/**
 * Answering a set of questions, one in front at a time. It starts over when other questions take
 * their place (`since` is when they were asked).
 */
export function useAnswering(questions: Question[], since: number): Answering | null {
  const [state, setState] = useState<{ at: number; replies: (Reply | undefined)[] }>({ at: 0, replies: [] })
  useEffect(() => setState({ at: 0, replies: [] }), [since])
  return useMemo(() => {
    if (!questions.length) return null
    const at = Math.min(state.at, questions.length - 1)
    const question = questions[at]
    const set = (reply: Reply) => setState((now) => ({ at, replies: Object.assign([...now.replies], { [at]: reply }) }))
    return {
      at,
      question,
      reply: state.replies[at] ?? NO_REPLY,
      replies: state.replies,
      last: at === questions.length - 1,
      ready: questions.some((_, i) => replied(state.replies[i])),
      go: (to) => setState((now) => ({ ...now, at: Math.max(0, Math.min(to, questions.length - 1)) })),
      pick: (label) => set(choose(question, state.replies[at], label)),
      write: (text) => set(write(question, state.replies[at], text)),
    }
  }, [questions, state])
}
