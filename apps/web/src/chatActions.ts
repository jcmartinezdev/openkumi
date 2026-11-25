// What the window's search (Palette.tsx) asks of a bot's conversation that only the conversation
// can do: open its model picker, or choose files to send. The conversation in view takes it at once;
// when none of that bot's is in view, the search opens the bot's conversation and it is done there.
import { useEffect, useRef } from 'react'

export type ChatAction = 'model' | 'attach'

/** What was asked, until a conversation of that bot in view takes it (for a few seconds). */
let waiting: { botId: string; action: ChatAction; at: number } | null = null
const takers = new Set<() => void>()

/** Asks a bot's conversation to do something. Returns whether one in view did it at once. */
export function askChat(botId: string, action: ChatAction): boolean {
  waiting = { botId, action, at: Date.now() }
  takers.forEach((take) => take())
  return waiting === null
}

/** Lets a conversation in view do what is asked of its bot's. An empty `botId` (not in view, or read only) takes nothing. */
export function useChatActions(botId: string, handle: (action: ChatAction) => void) {
  const latest = useRef(handle)
  latest.current = handle
  useEffect(() => {
    if (!botId) return
    const take = () => {
      if (waiting?.botId !== botId) return
      const { action, at } = waiting
      waiting = null
      if (Date.now() - at < 5000) latest.current(action)
    }
    take()
    takers.add(take)
    return () => void takers.delete(take)
  }, [botId])
}
