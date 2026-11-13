// The first screen, while the app has no environment at all: a few bots say hello, and under them
// are the ways to start, running them on this computer or pairing with another one that runs them.
// The iPhone has the same welcome (apps/mobile/app/welcome.tsx); keep the two alike.
import { type CSSProperties, type ComponentProps, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Look } from '@openkumi/shared'
import { BODY_COLORS, describeLook, surprise } from '@openkumi/client/mascot'
import { desktop, reason } from './desktop'
import { Icon } from './Icon'
import { Mascot } from './Mascot'
import { AddEnvironment } from './Settings'
import { Section } from './settingsUi'

interface Dress {
  look: Look
  emoji: string
}

/** Who says hello: OpenKumi's own bear in front, waving, between two of the crew on the website. */
const CREW: Dress[] = [
  { look: { creature: 'cat', color: 'periwinkle', hat: 'grad', extra: 'glasses', clothes: 'navy' }, emoji: '🔬' },
  { look: { creature: 'bear', color: 'sky', hat: 'headphones', extra: 'none', clothes: 'orange' }, emoji: '👋' },
  { look: { creature: 'blob', color: 'tangerine', hat: 'chef', extra: 'bowtie', clothes: 'red' }, emoji: '🍳' },
]

/** The ways to start. More can go here. */
const STARTS: { key: 'local' | 'pair'; icon: ComponentProps<typeof Icon>['name']; title: string; detail: string }[] = [
  { key: 'local', icon: 'cpu', title: 'Run them on this computer', detail: 'OpenKumi starts here, and your bots, their memory and their browsers stay on this computer.' },
  { key: 'pair', icon: 'monitor', title: 'Connect to another computer', detail: 'Your bots run on it. Pair with the code it shows in its settings.' },
]

/** Bits of sparkle around the crew, placed as fractions of the space it stands in. */
const SPARKLES: { x: number; y: number; size: number; color: string; star?: boolean }[] = [
  { x: 0.08, y: 0.2, size: 16, color: BODY_COLORS.lemon.hex, star: true },
  { x: 0.9, y: 0.12, size: 9, color: BODY_COLORS.berry.hex },
  { x: 0.86, y: 0.5, size: 18, color: BODY_COLORS.sky.hex, star: true },
  { x: 0.16, y: 0.62, size: 8, color: BODY_COLORS.mint.hex },
  { x: 0.52, y: 0.02, size: 10, color: BODY_COLORS.grape.hex, star: true },
  { x: 0.03, y: 0.44, size: 7, color: BODY_COLORS.coral.hex },
  { x: 0.96, y: 0.74, size: 7, color: BODY_COLORS.lime.hex },
]

const STAR = 'm12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.2-4.1 5.8-.8z'

const reduced = matchMedia('(prefers-reduced-motion: reduce)')
const watchMotion = (changed: () => void) => (reduced.addEventListener('change', changed), () => reduced.removeEventListener('change', changed))
/** Whether the computer is set to reduce motion. The bots then keep still, and only change clothes. */
const useStill = () => useSyncExternalStore(watchMotion, () => reduced.matches)

/** Off the ground fast, slowing towards the top. */
const rise = (t: number) => 1 - (1 - t) * (1 - t)
/** Back to the ground, bouncing as it lands (React Native's Easing.bounce, which the iPhone uses). */
function bounce(t: number) {
  if (t < 1 / 2.75) return 7.5625 * t * t
  if (t < 2 / 2.75) return 7.5625 * (t -= 1.5 / 2.75) * t + 0.75
  if (t < 2.5 / 2.75) return 7.5625 * (t -= 2.25 / 2.75) * t + 0.9375
  return 7.5625 * (t -= 2.625 / 2.75) * t + 0.984375
}

/** A hop under way: when it began, the height it began at and goes up to (1 is a whole jump), and how long up and down take. */
interface Hop {
  at: number
  from: number
  peak: number
  up: number
  down: number
}

const over = (hop: Hop, now: number) => now >= hop.at + hop.up + hop.down
function heightOf(hop: Hop, now: number) {
  const t = now - hop.at
  if (t < hop.up) return hop.from + (hop.peak - hop.from) * rise(t / hop.up)
  return t < hop.up + hop.down ? hop.peak * (1 - bounce((t - hop.up) / hop.down)) : 0
}
/** `a` to `b` as `t` goes from 0 to 1. */
const towards = (a: number, b: number, t: number) => a + (b - a) * Math.min(Math.max(t, 0), 1)

/** One of the crew: pops up when the screen opens, hops now and then, and when clicked jumps into new clothes. */
function Hopper({ start, order, still, front = false }: { start: Dress; order: number; still: boolean; front?: boolean }) {
  const [dress, setDress] = useState(start)
  const body = useRef<HTMLSpanElement>(null)
  const shadow = useRef<HTMLSpanElement>(null)
  // The little hop it does by itself and the jump it makes when clicked, which add up; and the frame drawing them.
  const hops = useRef<{ idle?: Hop; leap?: Hop; dressed?: boolean; frame?: number }>({})

  /** Puts the bot at a height: stretched a little while in the air, over a shadow that stays on the ground. */
  const pose = (height: number) => {
    if (!body.current || !shadow.current) return
    const stretch = height < 0.25 ? height / 0.25 : 1 - (height - 0.25) / 0.95
    const scaleY = height < 0.25 ? towards(1, 1.06, stretch) : towards(1.03, 1.06, stretch)
    const scaleX = height < 0.25 ? towards(1, 0.95, stretch) : towards(0.97, 0.95, stretch)
    body.current.style.transform = height ? `translateY(${-height * 0.36 * body.current.offsetWidth}px) scale(${scaleX}, ${scaleY})` : ''
    // Smaller and fainter the higher the bot goes.
    const ground = towards(1, 0.45, height / 1.2)
    shadow.current.style.transform = height ? `scale(${ground})` : ''
    shadow.current.style.opacity = height ? String(ground) : ''
  }

  /** Draws a frame of whatever hops are under way, and asks for the next one until they are over. */
  const draw = () => {
    const now = performance.now()
    const state = hops.current
    if (state.idle && over(state.idle, now)) state.idle = undefined
    if (state.leap && over(state.leap, now)) state.leap = undefined
    // The clothes change at the top of the jump.
    if (state.leap && !state.dressed && now >= state.leap.at + state.leap.up) {
      state.dressed = true
      setDress(surprise())
    }
    pose((state.idle ? heightOf(state.idle, now) : 0) + (state.leap ? heightOf(state.leap, now) : 0))
    state.frame = state.idle || state.leap ? requestAnimationFrame(draw) : undefined
  }

  const hop = (kind: 'idle' | 'leap', peak: number, up: number, down: number) => {
    const state = hops.current
    const now = performance.now()
    // A jump made in the middle of another goes on from where that one has got to.
    const going = state[kind]
    state[kind] = { at: now, from: going && !over(going, now) ? heightOf(going, now) : 0, peak, up, down }
    if (kind === 'leap') state.dressed = false
    state.frame ??= requestAnimationFrame(draw)
  }

  useEffect(() => {
    if (still) return
    // Each at its own pace, so they do not hop together.
    const every = 2400 + order * 1300
    let timer = setTimeout(function next() {
      hop('idle', 0.2, 170, 420)
      timer = setTimeout(next, every + 590)
    }, every)
    return () => {
      clearTimeout(timer)
      if (hops.current.frame) cancelAnimationFrame(hops.current.frame)
      hops.current = {}
      pose(0)
    }
  }, [still])

  const poke = () => (still ? setDress(surprise()) : hop('leap', 1, 200, 640))

  return (
    <button type="button" className={`hopper ${front ? 'front' : ''}`} style={{ '--order': order } as CSSProperties} aria-label={describeLook(dress.look)} onClick={poke}>
      <span className="hopper-in">
        <span className="hopper-body" ref={body}>
          <Mascot look={dress.look} emoji={dress.emoji} live={!still} />
        </span>
      </span>
      <span className="hopper-ground">
        <span className="hopper-shadow" ref={shadow} />
      </span>
    </button>
  )
}

/** A sparkle that comes and goes. */
function Sparkle({ x, y, size, color, star, order }: (typeof SPARKLES)[number] & { order: number }) {
  const place = { left: `${x * 100}%`, top: `${y * 100}%`, width: size, height: size, color, rotate: `${order * 23}deg`, '--order': order } as CSSProperties
  return (
    <span className={`sparkle ${star ? '' : 'dot'}`} style={place}>
      {star && (
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d={STAR} fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )
}

/** Asks the app to do something, keeping what went wrong to show. */
function useChange() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = async (fn: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError(reason(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, change }
}

export function Welcome() {
  const still = useStill()
  const [pairing, setPairing] = useState(false)
  const { busy, error, change } = useChange()
  // Once OpenKumi is turned on here, or another computer is paired, the window moves on by itself.
  if (pairing) return <Pairing back={() => setPairing(false)} />

  return (
    <div className="gate welcome">
      <div className="gate-bar" />
      <div className="welcome-scroll">
        <div className="welcome-page">
          <div className="welcome-hero">
            <div className="welcome-stage">
              {/* A soft light behind them, in two of the bots' colours. */}
              <span className="welcome-glow" style={{ left: '36%', top: '55%', width: '84%', '--tint': BODY_COLORS.sky.hex } as CSSProperties} />
              <span className="welcome-glow" style={{ left: '66%', top: '50%', width: '76%', '--tint': BODY_COLORS.berry.hex } as CSSProperties} />
              {SPARKLES.map((sparkle, i) => <Sparkle key={i} {...sparkle} order={i} />)}
              <div className="welcome-crew">
                <Hopper start={CREW[0]} order={1} still={still} />
                <Hopper start={CREW[1]} order={0} still={still} front />
                <Hopper start={CREW[2]} order={2} still={still} />
              </div>
            </div>
            <p className="welcome-hint">Click a bot to dress it up</p>
            <div className="welcome-words">
              <p className="welcome-eyebrow">Welcome to OpenKumi</p>
              <h1>Your own crew<br />of AI bots</h1>
              <p className="welcome-lead">
                They get things done for you, each with its own memory and its own browser. Run them on this computer, or on another one of yours and work with them from here.
              </p>
            </div>
          </div>

          <section className="welcome-starts">
            <h2>Get started</h2>
            {error && <div className="notice error">{error}</div>}
            {STARTS.map((start) => (
              <button
                key={start.key}
                type="button"
                className="welcome-start"
                disabled={busy}
                onClick={() => (start.key === 'pair' ? setPairing(true) : void change(() => desktop.setLocal(true)))}
              >
                <span className="welcome-start-icon"><Icon name={start.icon} size={22} /></span>
                <span className="grow">
                  <strong>{start.title}</strong>
                  <span>{start.detail}</span>
                </span>
                <Icon name="chevron" size={16} />
              </button>
            ))}
          </section>
        </div>
      </div>
    </div>
  )
}

/** Pairing with OpenKumi on another computer, the way to start that the welcome offers. */
function Pairing({ back }: { back: () => void }) {
  const { busy, error, change } = useChange()
  useEffect(() => {
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && back()
    addEventListener('keydown', escape)
    return () => removeEventListener('keydown', escape)
  }, [])
  return (
    <div className="gate welcome">
      <div className="gate-bar" />
      <div className="set-scroll">
        <div className="set-column welcome-pairing">
          <button type="button" className="ghost welcome-back" onClick={back}><Icon name="back" size={14} /> Back</button>
          <div className="gate-head">
            <h1>Connect to another computer</h1>
            <p>Your bots run on it, and you work with them from here.</p>
          </div>
          {error && <div className="notice error">{error}</div>}
          <Section title="Pair with it">
            <AddEnvironment add={(input) => void change(() => desktop.add(input))} busy={busy} />
          </Section>
        </div>
      </div>
    </div>
  )
}
