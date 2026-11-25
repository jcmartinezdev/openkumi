// What the phone app shows in a car, through CarPlay: the bots as a list, to call one with a tap,
// and the call while it lasts. A car's screen is not drawn by the app: CarPlay has a few screens of
// its own for an app that is talked with (a list, the screen for a voice, an alert), and the app
// says what goes on them. This works that out from what the app knows, and nothing else, so it can
// be tried without a car; the phone app hands it on (apps/mobile/src/car.ts, modules/car).
import type { Look } from '@openkumi/shared'
import { sortBots } from './bots'
import type { Calling } from './calls'
import type { State } from './store'

/** A row of the list: a bot to call. */
export interface CarRow {
  id: string
  title: string
  detail: string
  /** The name of the bot's face as a picture (`faceOf`). Until the car has it, `emoji` is drawn. */
  picture: string
  emoji: string
}

/** The call, over the list. What is said is not shown, only heard: whose call it is and how it stands. */
export interface CarCall {
  /** The bot on the line. */
  id: string
  name: string
  state: 'calling' | 'listening' | 'working' | 'muted'
  picture: string
  emoji: string
}

/** Something to say that cannot wait, over everything, until its button is tapped. */
export interface CarAlert {
  id: string
  /** From the longest way of saying it to the shortest: the car shows the longest that fits. */
  titles: string[]
}

/** Everything the car shows. */
export interface CarScreen {
  rows: CarRow[]
  /** Said in the list's place while it has no rows. */
  note: string
  noteDetail: string
  /** A spinner with the note: something is on its way. */
  busy: boolean
  call: CarCall | null
  alert: CarAlert | null
}

/** What the app knows, as far as a car shows any of it. */
export interface CarKnown {
  /** The computer the phone is paired with, or none. */
  server: { name: string } | null
  /** Whether the phone has read which computer that is. */
  ready: boolean
  /** It could not: the phone is locked, and has to be unlocked once. */
  locked: boolean
  state: Pick<State, 'bots' | 'threads' | 'settings' | 'calls' | 'call' | 'loaded' | 'connected' | 'refused' | 'outdated' | 'newer' | 'failures'>
  /** The call this phone is making, or is on. */
  calling: Calling
  /** Something to say that is not about a call under way, until it is dismissed. */
  said: CarAlert | null
}

/** The name of a bot's face as a picture: bots that look alike share one. */
export const faceOf = (look: Look | undefined) => (look ? [look.creature, look.color, look.hat, look.extra, look.clothes].join('.') : 'none')

/**
 * What to say in the car when the app may not listen, given what the phone says about its
 * microphone ("granted", "denied", or "prompt" when it has not asked yet). The phone asks on its
 * own screen, which nobody looks at in a car, so a call from there is only made once it may.
 */
export function microphoneAlert(permission: string): CarAlert | null {
  if (permission === 'granted') return null
  if (permission === 'denied') return { id: 'microphone', titles: ['OpenKumi may not use the microphone. Allow it in Settings on your iPhone.', 'Allow the microphone on your iPhone'] }
  return { id: 'microphone', titles: ['Call a bot from OpenKumi on your iPhone once, so it can ask to use the microphone.', 'Call a bot on your iPhone once first'] }
}

export function carScreen({ server, ready, locked, state: s, calling, said }: CarKnown): CarScreen {
  // A call that ended by itself, or could not be made, says why until that is dismissed, here or on the phone.
  const alert: CarAlert | null = calling.error ? (calling.denied ? { ...microphoneAlert('denied')!, id: 'ended' } : { id: 'ended', titles: [`The call ended. ${calling.error}`, 'The call ended'] }) : said
  // The call is the phone's own, and its sound goes its own way: it stays on the car's screen, with the
  // way to end it, when the computer cannot be reached for a moment (leaving the Wi-Fi at home, say).
  const mine = calling.phase !== 'off'
  const on = mine ? s.bots.find((bot) => bot.id === calling.botId) : undefined
  const call: CarCall | null = mine
    ? {
        id: calling.botId,
        name: on?.name ?? 'Your bot',
        state: calling.phase !== 'live' ? 'calling' : calling.muted ? 'muted' : s.call?.id === calling.id && s.call.working > 0 ? 'working' : 'listening',
        picture: faceOf(on?.look),
        emoji: on?.emoji ?? '',
      }
    : null
  const note = (note: string, noteDetail = '', busy = false): CarScreen => ({ rows: [], note, noteDetail, busy, call, alert })

  if (locked) return note('Unlock your iPhone', 'Then open OpenKumi on it once.')
  if (!ready) return note('', '', true)
  if (!server) return note('Pair your iPhone first', 'Open OpenKumi on your iPhone and pair it with the computer that runs your bots.')
  if (s.refused) return note(`${server.name} no longer lets this iPhone in`, 'Pair it again in OpenKumi on your iPhone.')
  if (s.outdated) return note(`${server.name} needs an update`, 'It runs an older OpenKumi than this app can work with.')
  if (s.newer) return note('Update OpenKumi on your iPhone', `${server.name} runs a newer OpenKumi than this app can work with.`)
  // The phone may hold the bots from last time, but none can be called while the computer cannot be reached.
  if (!s.loaded || !s.connected) return s.failures >= 2 ? note(`${server.name} cannot be reached`, 'Still trying…', true) : note('Connecting…', '', true)
  if (!s.calls?.available) return note('Calls are not set up', s.calls?.reason || `Update OpenKumi on ${server.name} first.`)
  const bots = sortBots(s.bots, s.threads, s.settings.botSort, s.settings.botOrder)
  if (!bots.length) return note('No bots yet', 'Create one in OpenKumi on your computer.')

  return {
    rows: bots.map((bot) => ({
      id: bot.id,
      title: bot.name,
      // A call made from another device: one made here takes its place. Not the one just hung up here, which the server is still ending.
      detail: !mine && s.call && s.call.id !== calling.last && s.call.botId === bot.id ? 'On a call on another device' : '',
      picture: faceOf(bot.look),
      emoji: bot.emoji,
    })),
    note: '',
    noteDetail: '',
    busy: false,
    call,
    alert,
  }
}
