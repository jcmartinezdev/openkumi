// The voice a bot has on a call, chosen by ear. In the bot's settings a button shows the voice it
// has and opens a page of its own (Settings › Bots › the bot › Voice): the voices sorted female,
// male, then by language (@openkumi/client/voices), each with what it is like, beside a stage
// where the bot says a short line in the voice in view. Choosing one there, by click or with the
// arrow keys, has it say its line, as a swipe does on the phone; a button makes it the bot's.
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { Bot } from '@openkumi/shared'
import { hearVoice, stopHearing, useCalling, useHearing, useVoices } from '@openkumi/client/calls'
import { type VoiceChoice, aboutVoice, isVoice, shelvesOf, voiceName, voiceOf } from '@openkumi/client/voices'
import { desktop } from './desktop'
import { Icon } from './Icon'
import { BotHead, Mascot } from './Mascot'
import { Page } from './settingsUi'
import { api, useStore } from './store'

export const voiceLink = (botId: string) => `#/settings/bots/${encodeURIComponent(botId)}/bot/voice`

/** How long the arrow keys rest on a voice before it says its line, so passing through the list does not start each one. */
const REST = 350

/** The Voice row's control in the bot's settings: hear the voice it has, or open the page to choose another. */
export function VoiceControl({ bot }: { bot: Bot }) {
  const known = useVoices()
  const hearing = useHearing()
  const onCall = useCalling().phase !== 'off'
  const value = bot.voice ?? ''
  const heard = hearing.phase !== 'off' && hearing.voice === value
  const voice = voiceOf(known, value)
  const about = voice && aboutVoice(voice)
  return (
    <>
      {/* The voice the bot has says a line as the bot. */}
      <button
        className="icon"
        title={heard ? 'Stop' : onCall ? 'Hang up to hear the voice' : 'Hear it'}
        aria-label={heard ? 'Stop the voice' : 'Hear the voice'}
        disabled={!known || onCall || !!voice?.gone}
        onClick={() => (heard ? stopHearing() : void hearVoice(bot.id, value))}
      >
        {heard && hearing.phase === 'connecting' ? <span className="spinner" /> : <Icon name={heard ? 'stop' : 'play'} size={15} />}
      </button>
      <a className="voice-button" href={voiceLink(bot.id)} aria-label={`Voice: ${voice?.name ?? (value || 'the usual one')}. Choose another`}>
        <BotHead bot={bot} sign={false} />
        <span className="voice-button-text">
          <b>{voice?.name ?? (value ? voiceName(value) : 'Usual')}</b>
          {voice?.gone ? <small>No longer offered</small> : about ? <small>{about}</small> : null}
        </span>
        <Icon name="chevron" size={13} />
      </a>
    </>
  )
}

export function VoicePage({ bot }: { bot: Bot }) {
  const known = useVoices()
  const calls = useStore((s) => s.calls)
  const hearing = useHearing()
  const onCall = useCalling().phase !== 'off'
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState('')
  // What was saved here holds until the server says what the bot has.
  useEffect(() => setSaved(null), [bot.voice])
  const mine = saved ?? bot.voice ?? ''

  // The bot's voice as the page opened stays listed, even once another is chosen and Codex no longer offers it.
  const first = useRef(mine).current
  const shelves = useMemo(() => (known ? shelvesOf(known, first) : []), [known])
  const all = useMemo(() => shelves.flatMap((shelf) => shelf.voices), [shelves])
  /** The voice in view on the stage, by Codex's name. It opens at the bot's own. */
  const [at, setAt] = useState('')
  const shown = all.find((choice) => choice.voice === at) ?? all.find((choice) => isVoice(choice, mine)) ?? all[0]

  const list = useRef<HTMLDivElement>(null)
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Nothing goes on talking once the page is left.
  useEffect(() => () => (clearTimeout(rest.current), stopHearing()), [])
  // The keys work as soon as the voices are there.
  const listed = !!shown
  useEffect(() => {
    if (listed) list.current?.focus({ preventScroll: true })
  }, [listed])

  const isHeard = (choice: VoiceChoice) => hearing.phase !== 'off' && hearing.voice === choice.value
  /** Has a voice say its line. One that cannot be heard stops the one talking, so what talks is always the one in view. */
  const hear = (choice: VoiceChoice) => {
    clearTimeout(rest.current)
    if (choice.gone || onCall) stopHearing()
    else void hearVoice(bot.id, choice.value)
  }
  /** Stops the voice talking, and the one the arrow keys came to rest on from starting. */
  const stop = () => {
    clearTimeout(rest.current)
    stopHearing()
  }
  /** A click on a voice: it comes into view and says its line, or stops if it was saying it. */
  const pick = (choice: VoiceChoice) => {
    setAt(choice.voice)
    if (isHeard(choice)) stop()
    else hear(choice)
  }
  const use = (choice: VoiceChoice) => {
    if (isVoice(choice, mine) || choice.gone) return
    setSaved(choice.value)
    setError('')
    api('PATCH', `/api/bots/${bot.id}`, { voice: choice.value }).catch((e) => (setSaved(null), setError((e as Error).message)))
  }
  const onKey = (e: KeyboardEvent) => {
    if (!shown) return
    const i = all.indexOf(shown)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next === shown) return
      setAt(next.voice)
      document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' })
      clearTimeout(rest.current)
      rest.current = setTimeout(() => hear(next), REST)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      use(shown)
    } else if (e.key === ' ') {
      e.preventDefault()
      if (isHeard(shown)) stop()
      else hear(shown)
    }
  }

  const unavailable = calls?.available === false
  const heard = !!shown && isHeard(shown)
  const speaking = heard && hearing.phase === 'speaking'
  const chosen = !!shown && isVoice(shown, mine)

  return (
    <Page>
      <header className="voice-head">
        <h1>{bot.name}’s voice</h1>
        <p>Click a voice to hear it say a line as {bot.name}. Each one is a very short call on your ChatGPT plan, through Codex, whatever {bot.name} itself runs on.</p>
      </header>
      {error && <div className="notice error">{error}</div>}
      {unavailable ? (
        <div className="notice">{calls?.reason || 'Bots cannot be called from this computer.'}</div>
      ) : !shown ? (
        <div className="voice-waiting"><span className="spinner" /> Asking Codex which voices it has…</div>
      ) : (
        <div className="voice-page">
          <div
            ref={list}
            className="voice-list"
            role="listbox"
            tabIndex={0}
            aria-label="Voices"
            aria-activedescendant={optionId(shown)}
            onKeyDown={onKey}
          >
            {shelves.map((shelf) => (
              <div key={shelf.shelf} className="voice-shelf" role="group" aria-labelledby={`voice-shelf-${shelf.shelf}`}>
                <h2 id={`voice-shelf-${shelf.shelf}`}>{shelf.title} <span>{shelf.voices.length}</span></h2>
                <div className="set-group">
                  {shelf.voices.map((choice) => {
                    const here = isHeard(choice)
                    const has = isVoice(choice, mine)
                    // The kind is the shelf's title, so a row says only what more there is.
                    const line = choice.shelf === 'female' || choice.shelf === 'male' ? choice.about : choice.language
                    return (
                      <div
                        key={choice.voice}
                        id={optionId(choice)}
                        role="option"
                        aria-selected={choice === shown}
                        className={`voice-row ${choice === shown ? 'on' : ''}`}
                        onClick={() => (list.current?.focus(), pick(choice))}
                      >
                        <span className={`voice-play ${here ? 'here' : ''}`} aria-hidden>
                          {here && hearing.phase === 'speaking' ? <Bars /> : here ? <span className="spinner" /> : <Icon name="play" size={10} />}
                        </span>
                        <span className="voice-name">{choice.name}</span>
                        <span className="voice-line">{choice.gone ? 'No longer offered' : line}</span>
                        {choice.usual && <span className="voice-usual">usual</span>}
                        {has && <span className="voice-mine"><Icon name="check" size={12} /> {bot.name}’s voice</span>}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          <aside className="voice-stage" aria-live="polite">
            <div className={`voice-mascot ${speaking ? 'talking' : ''}`}>
              <Mascot look={bot.look} emoji={bot.emoji} live />
            </div>
            <h2>{shown.name}</h2>
            {shown.about && <p className="voice-about">{shown.about}</p>}
            <div className="voice-chips">
              {(shown.shelf === 'female' || shown.shelf === 'male') && <span>{shown.shelf === 'female' ? 'Female' : 'Male'}</span>}
              {shown.language && <span>{shown.language}</span>}
              {shown.usual && <span>The usual one</span>}
              {shown.gone && <span>No longer offered</span>}
            </div>
            <p className="voice-says">
              {speaking ? `“Hi, I’m ${bot.name}. This is how I sound when you call me.”`
                : heard ? 'Getting the voice on the line…'
                : shown.gone ? 'It cannot be heard any more.'
                : onCall ? 'You are on a call. Hang up to hear the voices.'
                : ''}
            </p>
            <div className="voice-actions">
              <button disabled={shown.gone || onCall} onClick={() => (heard ? stop() : hear(shown))}>
                <Icon name={heard ? 'stop' : 'play'} size={12} /> {heard ? 'Stop' : 'Hear it'}
              </button>
              <button className={chosen ? '' : 'primary'} disabled={chosen || shown.gone} onClick={() => use(shown)}>
                {chosen ? <><Icon name="check" size={13} /> {bot.name}’s voice</> : `Use ${shown.name}`}
              </button>
            </div>
            {hearing.error && !onCall && (
              <p className="voice-error" role="alert">
                {hearing.error}
                {hearing.denied && <> <button className="ghost" onClick={() => void desktop.dictation?.openMicrophoneSettings()}>Open System Settings</button></>}
              </p>
            )}
            <p className="voice-hint"><kbd>↑</kbd> <kbd>↓</kbd> to listen · <kbd>↵</kbd> to choose</p>
          </aside>
        </div>
      )}
    </Page>
  )
}

const optionId = (choice: VoiceChoice) => `voice-${choice.voice}`

/** Sound coming out, as three bars going up and down. */
const Bars = () => <span className="voice-bars"><i /><i /><i /></span>
