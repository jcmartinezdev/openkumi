// What the bots have for their owner, shown outside the window by the app behind it: how many of
// them want the owner, as a count on the app's icon, and a notification for each bot that needs
// them or has something to be read now (see @openkumi/client/attention). The app shows a
// notification only while the window is not in front, and takes it back when the bot no longer waits.
import { attentionOf, noticeOf, wantsOwner } from '@openkumi/client/attention'
import type { Notice } from '@openkumi/shared/desktop'
import { desktop } from './desktop'
import { getPrefs, onPrefs } from './prefs'
import { type State, navigate, onState, stateNow } from './store'

/** What the marks were last read from, and what the app was last told: most changes to the state change neither. */
let read: unknown[] = []
let told = ''

function tell(state: State) {
  const from = [state.loaded, state.bots, state.threads, state.browsers, state.queue, getPrefs().notifications]
  if (from.every((part, i) => part === read[i])) return
  read = from
  let count = 0
  const notices: Notice[] = []
  // An environment that has not answered yet says nothing about its bots.
  for (const bot of state.loaded ? state.bots : []) {
    const attention = attentionOf(bot.id, state)
    if (wantsOwner(attention.mark)) count++
    const notice = getPrefs().notifications ? noticeOf(bot, attention) : null
    if (notice) notices.push({ id: bot.id, ...notice })
  }
  const next = JSON.stringify([count, notices])
  if (next === told) return
  told = next
  void desktop.attention?.(count, notices).catch(() => {})
}

/**
 * Tells the app a moment after the state changed, once for all that changes in that moment. What
 * a bot says to someone looking at its conversation is new only until the window has said it was
 * read, which is at once: the icon should not count it in between.
 */
let soon: ReturnType<typeof setTimeout> | undefined
function later() {
  soon ??= setTimeout(() => {
    soon = undefined
    tell(stateNow())
  }, 200)
}

/** Keeps the app told, from now on, and opens the bot a clicked notification was about. */
export function watchAttention() {
  onState(later)
  onPrefs(later)
  later()
  desktop.onNotice?.((id) => stateNow().bots.some((bot) => bot.id === id) && navigate(id))
}
