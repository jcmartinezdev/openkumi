// Dictation in the composer: a microphone button, and while it listens a bar in its place with a
// way to give up, how loud it is, how long it has been, and a way to finish. What is said is written
// down by the desktop app (apps/desktop/src/dictation.ts) and goes into the draft as it is heard
// (@openkumi/client/dictation); nothing but the words ever reaches the window.
import { useEffect, useRef, useState } from 'react'
import type { Dictating } from '@openkumi/client/dictation'
import type { Listener } from '@openkumi/shared/dictation'
import { desktop, inDesktopApp } from './desktop'
import { Icon } from './Icon'

const dictation = inDesktopApp ? desktop.dictation : undefined
/** Asked once: whether this computer can take dictation does not change while the app runs. */
let usable: Listener | null = null
const asked = dictation?.available().then((yes) => (usable = yes ? dictation : null), () => null)

/** The computer's way of taking dictation, once it is known to have one. Null where there is none (macOS before 26, Windows, Linux). */
export function useListener() {
  const [listener, setListener] = useState(usable)
  useEffect(() => void asked?.then(setListener), [])
  return listener
}

/** Keeps the focus in the message, so Enter and Escape still reach it. */
const keepFocus = (e: React.PointerEvent) => e.preventDefault()

export function MicButton({ start }: { start: () => void }) {
  return (
    <button className="icon mic" title="Dictate" aria-label="Dictate" onPointerDown={keepFocus} onClick={start}>
      <Icon name="mic" size={17} />
    </button>
  )
}

const BARS = 18

/** How loud it is, as bars that move along from right to left. Drawn straight onto the page, so the chat is not drawn again for each. */
function Level({ listener }: { listener: Listener }) {
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  useEffect(() => {
    const levels = Array<number>(BARS).fill(0)
    return listener.onEvent((event) => {
      if (event.type !== 'level') return
      levels.copyWithin(0, 1)
      levels[BARS - 1] = event.level
      bars.current.forEach((bar, i) => bar && (bar.style.transform = `scaleY(${Math.max(0.12, levels[i])})`))
    })
  }, [listener])
  return (
    <span className="level" aria-hidden>
      {Array.from({ length: BARS }, (_, i) => <span key={i} ref={(bar) => void (bars.current[i] = bar)} />)}
    </span>
  )
}

function Elapsed() {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const tick = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500)
    return () => clearInterval(tick)
  }, [])
  return <span className="elapsed">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</span>
}

/** In place of the microphone and the model while it listens. */
export function Listening({ dictating, listener }: { dictating: Dictating; listener: Listener }) {
  const { phase, progress } = dictating
  return (
    <div className="listening" role="status" aria-label={phase === 'preparing' ? 'Getting the speech model ready' : 'Listening'}>
      <button className="icon" title="Cancel (Esc)" aria-label="Cancel dictation" onPointerDown={keepFocus} onClick={dictating.cancel}>
        <Icon name="x" size={15} />
      </button>
      {phase === 'preparing' ? (
        <span className="listening-note"><span className="spinner" /> Getting the speech model ready{progress > 0 ? ` · ${Math.round(progress * 100)}%` : ''}</span>
      ) : (
        <>
          <span className={`rec ${phase === 'starting' ? '' : 'on'}`} />
          {/* Counted from when the microphone is on, not while the computer asks whether it may be. */}
          {phase !== 'starting' && <Elapsed />}
          <Level listener={listener} />
        </>
      )}
      <button className="icon done" title="Finish" aria-label="Finish dictation" disabled={phase === 'finishing'} onPointerDown={keepFocus} onClick={() => dictating.finish()}>
        {phase === 'finishing' ? <span className="spinner" /> : <Icon name="check" size={15} />}
      </button>
    </div>
  )
}

/** Why the last dictation ended early, above the message. */
export function DictationFailed({ dictating }: { dictating: Dictating }) {
  const failure = dictating.failure
  if (!failure) return null
  return (
    <div className="dictation-failed" role="alert">
      <Icon name="mic" size={14} />
      <span className="grow">{failure.code === 'denied' ? `${failure.message} You can allow it in System Settings, under Privacy & Security.` : failure.message}</span>
      {failure.code === 'denied' && <button className="pill link" onClick={() => void dictation?.openMicrophoneSettings()}>Open System Settings</button>}
      <button className="icon" title="Dismiss" aria-label="Dismiss" onClick={dictating.dismiss}><Icon name="x" size={13} /></button>
    </div>
  )
}
