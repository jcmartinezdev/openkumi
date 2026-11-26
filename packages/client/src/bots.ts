// The order the bots are listed in, in the computer's sidebar and on the phone's first screen: as
// they were made, the one last talked with first, or the owner's own order. Which it is, and the
// owner's order, are settings kept on the server, so every device lists them the same way.
// Everywhere else the bots stay as the server sends them, as they were made: the first of those
// is the main assistant.
import { useMemo } from 'react'
import type { Bot, BotSort, Thread } from '@openkumi/shared'
import { saveSettings, useStore } from './store'

/**
 * The bot with this id, or the one that had it before (Bot.formerIds): an address, a notification
 * or a message from before a bot's id changed still finds it.
 */
export function botById(bots: Bot[], id: string | undefined): Bot | undefined {
  if (!id) return undefined
  return bots.find((bot) => bot.id === id) ?? bots.find((bot) => bot.formerIds?.includes(id))
}

/** The id a bot has now, from one it may have had before: what a screen opened for a bot goes on with. */
export const useBotId = (id: string) => useStore((s) => botById(s.bots, id)?.id ?? id)

/** The orders to choose from, as both apps call them. */
export const BOT_SORTS: readonly (readonly [BotSort, string])[] = [
  ['created', 'Date created'],
  ['recent', 'Last message'],
  ['manual', 'My own order'],
]

/**
 * The bots in the order chosen. `bots` come as they were made, and stay so among bots the order
 * does not tell apart. A server from before there was a choice says nothing: as they were made.
 */
export function sortBots(bots: Bot[], threads: Thread[], sort: BotSort | undefined, order: string[] = []): Bot[] {
  if (sort === 'recent') {
    // When something last happened in each bot's conversation: the time shown beside it. A bot
    // nothing has been said to yet goes by when it was made, so a new one starts at the top.
    const last = new Map<string, number>()
    for (const t of threads) if (!t.parentId && !t.archivedAt && !last.has(t.botId)) last.set(t.botId, t.updatedAt)
    const at = (bot: Bot) => last.get(bot.id) ?? bot.createdAt
    return [...bots].sort((a, b) => at(b) - at(a))
  }
  if (sort === 'manual') {
    // A bot the order does not name (one made since) comes after the ones it does.
    const place = new Map(order.map((id, i) => [id, i]))
    const at = (bot: Bot) => place.get(bot.id) ?? order.length
    return [...bots].sort((a, b) => at(a) - at(b))
  }
  return bots
}

/** The ids with one of them moved to the place `to`, counted in the list as it is afterwards. */
export function moved(ids: string[], id: string, to: number): string[] {
  const rest = ids.filter((other) => other !== id)
  rest.splice(Math.max(0, Math.min(rest.length, to)), 0, id)
  return rest
}

/** The bots as a list shows them, the order they are in, and the ways to change it. */
export function useBotOrder() {
  const all = useStore((s) => s.bots)
  const threads = useStore((s) => s.threads)
  const chosen = useStore((s) => s.settings.botSort)
  const order = useStore((s) => s.settings.botOrder)
  // A server from before the bots could be ordered would not keep the choice: there is none to offer.
  const choosable = useStore((s) => s.defaults.botSort !== undefined)
  const bots = useMemo(() => sortBots(all, threads, chosen, order), [all, threads, chosen, order])
  const sort: BotSort = chosen ?? 'created'
  return {
    bots,
    sort,
    choosable,
    /** Orders the bots this way. Their own order, before the owner made one, starts as what is showing. */
    choose(next: BotSort): Promise<void> {
      const arranged = (order ?? []).some((id) => all.some((bot) => bot.id === id))
      return saveSettings({ botSort: next, ...(next === 'manual' && !arranged ? { botOrder: bots.map((bot) => bot.id) } : {}) })
    },
    /** Puts a bot at the place `to` of the list, which makes the order the owner's own. */
    move(id: string, to: number): Promise<void> {
      return saveSettings({ botSort: 'manual', botOrder: moved(bots.map((bot) => bot.id), id, to) })
    },
  }
}
