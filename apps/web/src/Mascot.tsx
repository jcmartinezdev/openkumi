// A bot's mascot, drawn from its look (@openkumi/client/mascot). Whole, it stands in the empty
// conversation and on the bot's page; its head, holding up the sign, stands for the bot in lists.
import { type CSSProperties, useId, useMemo } from 'react'
import type { Bot, Look } from '@openkumi/shared'
import { HEAD_SIGN, UNDECIDED, drawMascot, signColors } from '@openkumi/client/mascot'

interface MascotProps {
  look: Look
  emoji: string
  crop?: 'full' | 'head'
  /** Breathes and blinks. Kept for the large ones, where it is noticed and not distracting. */
  live?: boolean
  className?: string
}

export function Mascot({ look: given, emoji, crop = 'full', live = false, className = '' }: MascotProps) {
  // A server from before bots had looks sends none.
  const look = given ?? UNDECIDED
  // Each mascot's gradient needs an id of its own on the page.
  const id = 'm' + useId().replace(/[^A-Za-z0-9]/g, '')
  const { viewBox, body } = useMemo(() => drawMascot(look, emoji, { crop, id }), [look.creature, look.color, look.hat, look.extra, look.clothes, emoji, crop, id])
  // Mascots side by side do not breathe in step.
  const delay = useMemo(() => ({ '--delay': `${(-Math.random() * 4).toFixed(2)}s` }) as CSSProperties, [])
  return <svg className={`mascot ${live ? 'live' : ''} ${className}`} viewBox={viewBox} style={delay} aria-hidden dangerouslySetInnerHTML={{ __html: body }} />
}

/**
 * A bot's head, in the place of an avatar, holding its sign under its chin so bots that look alike
 * tell apart. The name beside it says whose it is. `sign={false}` leaves the sign out where the bot
 * is plain.
 */
export function BotHead({ bot, sign = true, className = '' }: { bot: Pick<Bot, 'look' | 'emoji'>; sign?: boolean; className?: string }) {
  return (
    <span className={`avatar head ${className}`} style={sign ? lifted : undefined}>
      <Mascot look={bot.look} emoji={bot.emoji} crop="head" />
      {sign && <HeadSign look={bot.look ?? UNDECIDED} emoji={bot.emoji} />}
    </span>
  )
}

// The head is a size container, so every length inside it is a share of its width (cqw). The head
// itself moves by a share of its own height, which is its width.
const share = (n: number) => `${n * 100}cqw`
const s = HEAD_SIGN
const lifted = { translate: `0 ${-s.lift * 100}%` }
const signBox = { width: share(s.width), height: share(s.height), left: share((1 - s.width) / 2), bottom: share(s.bottom), borderRadius: share(s.radius), fontSize: share(s.emoji), rotate: `${s.angle}deg` }
const pawBox = { width: share(s.paw), height: share(s.paw) }

function HeadSign({ look, emoji }: { look: Look; emoji: string }) {
  const { card, paw, pawEdge } = signColors(look)
  const pawStyle = { ...pawBox, background: paw, borderColor: pawEdge }
  return (
    <span className="head-sign" style={{ ...signBox, background: card }}>
      <i style={{ ...pawStyle, left: share(-s.paw / 2) }} />
      <i style={{ ...pawStyle, right: share(-s.paw / 2) }} />
      {emoji}
    </span>
  )
}
