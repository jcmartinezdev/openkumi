// Calling a bot from the window: a button in its conversation, and while a call is on a small
// panel over the window with who is on the line, what is being said, a way to mute and a way to
// hang up. The panel stays wherever the window goes, so a call can go on while another bot's
// conversation or the settings are showing. The call itself is made in @openkumi/client/calls;
// what is here is how a window opens the microphone and plays the bot's voice.
import { useEffect, useRef, useState } from 'react'
import type { Bot, CallLine } from '@openkumi/shared'
import { Denied, call, callLength, callTime, dismissCallError, endCall, hangUp, mute, useCalling, usePhone } from '@openkumi/client/calls'
import { desktop, inDesktopApp } from './desktop'
import { Icon } from './Icon'
import { BotHead } from './Mascot'
import { usePrefs } from './prefs'
import { navigate, useStore } from './store'

if (inDesktopApp && typeof RTCPeerConnection !== 'undefined') {
  usePhone({
    async microphone() {
      // A Mac asks the person, the first time, whether the app may listen.
      if (desktop.microphone && !(await desktop.microphone())) throw new Denied('OpenKumi is not allowed to use the microphone.')
      try {
        // The bot's voice comes out of the speakers, so what the microphone hears of it is taken out.
        return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      } catch (e: any) {
        if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') throw new Denied('OpenKumi is not allowed to use the microphone.')
        throw new Error(e?.name === 'NotFoundError' ? 'This computer has no microphone to call with.' : `The microphone could not be opened: ${e?.message ?? e}`)
      }
    },
    line: () => new RTCPeerConnection(),
    play(sound) {
      const voice = new Audio()
      voice.srcObject = sound as MediaStream
      void voice.play().catch(() => {})
      return () => {
        voice.pause()
        voice.srcObject = null
      }
    },
  })
}

/** In a bot's conversation: calls it, or hangs up when this window is on a call with it. */
export function CallButton({ bot, setError }: { bot: Bot; setError: (message: string) => void }) {
  const calls = useStore((s) => s.calls)
  const calling = useCalling()
  const on = calling.phase !== 'off' && calling.botId === bot.id
  if (on) {
    return (
      <button className="icon on calling" title="Hang up" aria-label={`Hang up the call with ${bot.name}`} onClick={() => void hangUp()}>
        <Icon name="phone" size={16} />
      </button>
    )
  }
  const start = () => {
    // Said in the conversation, where it can be read, rather than in a tooltip.
    if (!calls?.available) return setError(calls?.reason || 'The OpenKumi this bot runs on is too old for calls. Update it first.')
    setError('')
    void call(bot.id)
  }
  return (
    <button className="icon" title={`Call ${bot.name}`} aria-label={`Call ${bot.name}`} onClick={start}>
      <Icon name="phone" size={16} />
    </button>
  )
}

function Elapsed({ since }: { since: number }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(timer)
  }, [])
  return <span className="call-time">{callTime(since)}</span>
}

/** What is being said, the newest at the foot and kept in view. */
function Words({ lines, saying, name }: { lines: CallLine[]; saying: { user: string; assistant: string }; name: string }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight
  }, [lines, saying])
  const shown = [
    ...lines.slice(-6),
    ...(saying.user.trim() ? [{ role: 'user' as const, text: saying.user, live: true }] : []),
    ...(saying.assistant.trim() ? [{ role: 'assistant' as const, text: saying.assistant, live: true }] : []),
  ]
  if (!shown.length) return <div className="call-words empty">Say something: {name} is listening.</div>
  return (
    <div className="call-words" ref={box} aria-live="off">
      {shown.map((line, i) => (
        <p key={i} className={`${line.role} ${'live' in line ? 'live' : ''}`}>{line.text.trim()}</p>
      ))}
    </div>
  )
}

/** Over the window while a call is on, and after one that ended by itself until that is dismissed. */
export function CallPanel() {
  const calling = useCalling()
  const call = useStore((s) => s.call)
  const bots = useStore((s) => s.bots)
  const lines = useStore((s) => s.callLines)
  const saying = useStore((s) => s.callSaying)
  const mine = calling.phase !== 'off'
  // A call made from another device is under way: it can be seen here, and ended. Not the one
  // this window just hung up, which the server is still ending.
  const elsewhere = !mine && !!call && call.id !== calling.last
  const bot = bots.find((b) => b.id === (mine ? calling.botId : call?.botId))

  if (!mine && !elsewhere) {
    if (!calling.error) return null
    return (
      <div className="call-panel ended" role="alert">
        <div className="call-head">
          <span className="call-icon"><Icon name="phone" size={15} /></span>
          <div className="grow">
            <div className="call-name">The call ended</div>
            <div className="call-status">{calling.error}{calling.denied ? ' You can allow it in System Settings, under Privacy & Security.' : ''}</div>
          </div>
          <button className="icon" title="Dismiss" aria-label="Dismiss" onClick={dismissCallError}><Icon name="x" size={14} /></button>
        </div>
        {calling.denied && inDesktopApp && desktop.dictation && (
          <div className="call-foot"><button onClick={() => void desktop.dictation?.openMicrophoneSettings()}>Open System Settings</button></div>
        )}
      </div>
    )
  }
  if (!bot) return null

  const status =
    elsewhere ? 'On a call on another device'
    : calling.phase === 'asking' ? 'Waiting for the microphone…'
    : calling.phase === 'connecting' ? 'Calling…'
    : call?.id === calling.id && call.working > 0 ? 'Working on it…'
    : calling.muted ? 'Muted'
    : 'On a call'
  return (
    <div className="call-panel" role="group" aria-label={`Call with ${bot.name}`}>
      <div className="call-head">
        <button className="call-who" title={`Open ${bot.name}’s conversation`} onClick={() => navigate(bot.id)}>
          <BotHead bot={bot} sign={false} className={calling.phase === 'live' ? 'bob' : ''} />
          <span className="grow">
            <span className="call-name">{bot.name}</span>
            <span className="call-status">
              {calling.phase === 'live' && <Elapsed since={calling.since} />}
              {calling.phase !== 'live' && !elsewhere && <span className="spinner" />}
              {status}
            </span>
          </span>
        </button>
        {mine && calling.phase === 'live' && (
          <button className={`icon round ${calling.muted ? 'on' : ''}`} title={calling.muted ? 'Unmute' : 'Mute'} aria-label={calling.muted ? 'Unmute' : 'Mute'} aria-pressed={calling.muted} onClick={() => mute(!calling.muted)}>
            <Icon name={calling.muted ? 'micOff' : 'mic'} size={16} />
          </button>
        )}
        <button className="icon round hang-up" title="Hang up" aria-label="Hang up" onClick={() => void (mine ? hangUp() : endCall(call!.id).catch(() => {}))}>
          <Icon name="hangUp" size={17} />
        </button>
      </div>
      {(calling.phase === 'live' || elsewhere) && <Words lines={lines} saying={saying} name={bot.name} />}
    </div>
  )
}

/** A call that ended, in the conversation: how long it was, and what was said on it, to unfold. */
export function CallRecord({ id, seconds, lines, name }: { id: number; seconds: number; lines: CallLine[]; name: string }) {
  const expand = usePrefs().expandSteps
  return (
    <div data-item={id} className="msg report call-record">
      <div className="report-head">
        <Icon name="phone" size={13} />
        <span className="eyebrow">Call</span>
      </div>
      <details open={expand || undefined}>
        <summary className="report-title">
          Talked with {name} for {callLength(seconds)}
          <Icon name="chevron" size={12} />
        </summary>
        <div className="report-body call-lines">
          {lines.map((line, i) => (
            <p key={i} className={line.role}><span className="eyebrow">{line.role === 'user' ? 'You' : name}</span>{line.text}</p>
          ))}
        </div>
      </details>
    </div>
  )
}
