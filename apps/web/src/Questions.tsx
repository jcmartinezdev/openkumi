import { useEffect, useRef, useState } from 'react'
import type { Bot, Thread } from '@openkumi/shared'
import { clearFlag } from '@openkumi/client/attention'
import { askedIn, openQuestions, replied, sendAnswers, useAnswering } from '@openkumi/client/questions'
import { Icon } from './Icon'

/**
 * What the bot asked with ask_user, over the composer for as long as it waits for the answer: one
 * question in front at a time, its options to press, and room to write another answer. The
 * answers go to the bot as a message; the composer under it stays, to answer in writing instead.
 */
export function Questions({ bot, thread, connected, setError }: { bot: Bot; thread: Thread; connected: boolean; setError: (message: string) => void }) {
  const questions = openQuestions(thread)
  const answering = useAnswering(questions, thread.flag?.at ?? 0)
  // Sent, the card waits for the server to clear the mark, which takes it away: it is not sent twice meanwhile.
  const [sending, setSending] = useState(false)
  useEffect(() => setSending(false), [thread.flag?.at])
  // Going on to the next question by itself, a moment after one answer was chosen, so that the choice is seen.
  const onward = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(onward.current), [])
  // Going on with Enter from the field for an answer of one's own leaves the keyboard in the next question's field.
  const own = useRef<HTMLInputElement>(null)
  const typing = useRef(false)
  const shown = answering?.at
  useEffect(() => {
    if (typing.current) own.current?.focus()
    typing.current = false
  }, [shown])
  if (!answering) return null
  const { at, question, reply, last } = answering
  const several = questions.length > 1

  const send = () => {
    if (!answering.ready || sending || !connected) return
    setSending(true)
    setError('')
    sendAnswers(thread, questions, answering.replies)
      // It never left: what was answered is still here, to send again.
      .catch((e) => (setError(e.message), setSending(false)))
  }
  const pick = (label: string) => {
    clearTimeout(onward.current)
    answering.pick(label)
    if (!question.multiple && !last && !reply.chosen.includes(label)) onward.current = setTimeout(() => answering.go(at + 1), 220)
  }
  const go = (to: number) => (clearTimeout(onward.current), answering.go(to))

  return (
    <div className="questions" role="group" aria-label={`${bot.name} asks`}>
      <div className="questions-head">
        <span className="eyebrow grow">{bot.name} needs you{question.header ? ` · ${question.header}` : ''}</span>
        {several && <span className="faint" aria-label={`Question ${at + 1} of ${questions.length}`}>{at + 1} of {questions.length}</span>}
        <button className="icon" title="Clear this without answering" aria-label="Clear this without answering" onClick={() => clearFlag(thread.id).catch((e) => setError(e.message))}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="question-text">{question.question}</div>
      {question.options.length > 0 && (
        <div className="question-options" role={question.multiple ? 'group' : 'radiogroup'} aria-label={question.multiple ? 'Choose any that fit' : 'Choose one'}>
          {question.options.map((option) => {
            const on = reply.chosen.includes(option.label)
            return (
              <button key={option.label} role={question.multiple ? 'checkbox' : 'radio'} aria-checked={on} className={`question-option ${on ? 'on' : ''}`} onClick={() => pick(option.label)}>
                <span className={`question-mark ${question.multiple ? 'box' : ''}`}>{on && <Icon name="check" size={11} />}</span>
                <span className="question-label">{option.label}</span>
                {option.description && <span className="question-about">{option.description}</span>}
              </button>
            )
          })}
        </div>
      )}
      <input
        // A field of its own for each question, so that one's words are never left in the next.
        key={at}
        ref={own}
        className="question-own"
        value={reply.written}
        placeholder={!question.options.length ? 'Your answer' : question.multiple ? 'Something else, too…' : 'Something else…'}
        aria-label="An answer of your own"
        // Writing instead, right after choosing, stays on this question.
        onFocus={() => clearTimeout(onward.current)}
        onChange={(e) => answering.write(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
          e.preventDefault()
          if (last) return send()
          typing.current = true
          go(at + 1)
        }}
      />
      <div className="questions-foot">
        <span className="faint grow">{question.multiple ? 'Choose any that fit.' : several ? '' : `Or write to ${bot.name} below.`}</span>
        {at > 0 && <button onClick={() => go(at - 1)}>Back</button>}
        {!last && <button className={replied(reply) ? 'primary' : ''} onClick={() => go(at + 1)}>{replied(reply) ? 'Next' : 'Skip'}</button>}
        {last && (
          <button className="primary" title={!connected ? 'Offline' : undefined} disabled={!answering.ready || sending || !connected} onClick={send}>
            {several ? 'Send answers' : 'Send answer'}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Where the bot asked, in the conversation: the questions in its words, to read back once the card
 * over the composer is gone. What was answered is the message that follows.
 */
export function Asked({ id, call }: { id: number; call: { arguments: string } }) {
  const asked = askedIn(call)
  return (
    <div data-item={id} className="msg asked">
      <div className="asked-head"><Icon name="message" size={13} /><span className="eyebrow">Asked you</span></div>
      {asked.map((question, i) => <div key={i} className="asked-question">{question}</div>)}
    </div>
  )
}
