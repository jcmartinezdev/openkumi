// A bot's mascot, drawn from its look (@openbot/client/mascot). Whole, it stands in the empty
// conversation and on the bot's page; its head stands for the bot in lists, where its emoji was.
import { type CSSProperties, useId, useMemo } from 'react'
import type { Bot, Look } from '@openbot/shared'
import { UNDECIDED, drawMascot } from '@openbot/client/mascot'

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

/** A bot's head, in the place of an avatar. The name beside it says whose it is. */
export function BotHead({ bot, className = '' }: { bot: Pick<Bot, 'look' | 'emoji'>; className?: string }) {
  return (
    <span className={`avatar head ${className}`}>
      <Mascot look={bot.look} emoji={bot.emoji} crop="head" />
    </span>
  )
}
