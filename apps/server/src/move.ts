// A bot's id changing. The id is made from the name a bot was given first, and is the name of its
// folder and what everything about it is filed under: its conversations, automations, webhooks and
// usage here, and its vault, whose values are sealed to it. All of that moves to the new id. The
// one it leaves stays the bot's (Bot.formerIds): other bots' notes, automations and links from
// before still reach it, and no other bot can take it.
import type { Bot, Call } from '@openkumi/shared'
import * as agent from './agent.ts'
import { lookingFor } from './automations.ts'
import { getBot, idFrom, moveFolder } from './bots.ts'
import { stopBrowser } from './browser.ts'
import { emit } from './config.ts'
import * as db from './db.ts'
import * as mcp from './mcp.ts'
import * as secrets from './secrets.ts'
import { settings, updateSettings } from './settings.ts'

/** Why a bot cannot move right now, if it cannot: something is at work in its folder, or with its records. */
function busy(bot: Bot, call: Call | null): string | undefined {
  const later = 'Its id can change once that is over.'
  if (agent.atWork(bot.id)) return `${bot.name} is at work. Its id can change once it has finished.`
  if (call?.botId === bot.id) return `You are on a call with ${bot.name}. ${later}`
  if (bot.choosingLook) return `${bot.name} is still choosing its look. ${later}`
  if (mcp.signingIn(bot.id)) return `${bot.name} is being signed in to an app. ${later}`
  if (lookingFor(bot.id)) return `One of ${bot.name}’s watches is being looked at right now. Try again in a moment.`
}

/** Gives the bot `from` the id the owner asked for (`given`, which is made into one: "Trip Planner" is "trip-planner"). */
export async function moveBot(from: string, given: unknown): Promise<Bot> {
  const bot = getBot(from)
  if (!bot) throw new Error(`No bot with id ${from}.`)
  const to = idFrom(given, bot)
  if (to === bot.id) return bot
  // Loaded here rather than with this file: calls.ts needs agent.ts loaded first, and tools.ts, which agent.ts loads, loads this.
  const { currentCall } = await import('./calls.ts')
  const refused = busy(bot, currentCall())
  if (refused) throw new Error(refused)

  // What holds the folder open lets go of it first. Each starts again by itself when it is next needed.
  await stopBrowser(from)
  await mcp.closeBot(from)
  // Something may have started meanwhile. From here on nothing is waited for, so nothing else can start.
  const now = getBot(from)
  if (!now) throw new Error(`No bot with id ${from}.`)
  const still = busy(now, currentCall())
  if (still) throw new Error(still)
  // Taken meanwhile, it is refused as it would have been at first.
  idFrom(given, now)

  // A vault that cannot be opened stops it here, before anything moved.
  const vault = secrets.resealed(from, to)
  const back = moveFolder(from, to)
  try {
    vault.write()
    db.moveBotRecords(from, to)
  } catch (e) {
    vault.undo()
    back()
    throw e
  }
  const order = settings().botOrder
  if (order.includes(from)) updateSettings({ botOrder: order.map((id) => (id === from ? to : id)) })

  const moved = getBot(to)!
  emit({ type: 'bot.move', from, bot: moved })
  // What an app from before bot.move understands: a bot gone, and one come.
  emit({ type: 'bot.delete', id: from })
  emit({ type: 'bot.upsert', bot: moved })
  return moved
}
