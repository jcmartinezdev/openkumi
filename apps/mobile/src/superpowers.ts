// Giving a bot a superpower from the phone and taking it away again. One that works in an app is
// active once the bot has signed in to it: on the phone itself, with the accounts Safari has, or
// inside the bot's own browser, which suits a different account. What is under way, and what went
// wrong, is kept here rather than in a screen, so the superpower's page shows it whichever screen
// started it (the sign-in sheet closes before the sign-in is done).
import { useSyncExternalStore } from 'react'
import { Alert } from 'react-native'
import type { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import * as WebBrowser from 'expo-web-browser'
import type { Bot, Superpower, SuperpowerStatus } from '@openkumi/shared'
import { signInThread } from '@openkumi/client/browser'
import { type Standing, shortStanding } from '@openkumi/client/superpowers'
import { api, useStore } from '@openkumi/client/store'

/** What is being done with one superpower for one bot, and what went wrong with the last try. */
export interface Attempt {
  busy?: 'activating' | 'deactivating' | 'signing-in'
  error?: string
}

const key = (botId: string, powerId: string) => `${botId}/${powerId}`
let attempts: Record<string, Attempt> = {}
const listeners = new Set<() => void>()
function setAttempt(botId: string, powerId: string, attempt: Attempt) {
  attempts = { ...attempts, [key(botId, powerId)]: attempt }
  for (const heard of listeners) heard()
}
const subscribe = (heard: () => void) => (listeners.add(heard), () => void listeners.delete(heard))

export function useAttempt(botId: string, powerId: string): Attempt {
  return useSyncExternalStore(subscribe, () => attempts[key(botId, powerId)] ?? NONE)
}
const NONE: Attempt = {}

/** Said so a person can act on it: a phone that cannot reach the computer says so, not "fetch failed". */
export function plainly(e: unknown): string {
  const message = (e as Error)?.message ?? String(e)
  return /fetch failed|network request failed|failed to fetch|load failed/i.test(message) ? 'can’t reach the computer running OpenKumi' : message
}

/** What failed, then why, as one or two sentences whether the reason is a phrase or a sentence of its own. */
export function failed(what: string, e: unknown): string {
  const why = plainly(e).trim()
  return /[.!?]$/.test(why) ? `${what}. ${why[0].toUpperCase()}${why.slice(1)}` : `${what}: ${why}.`
}

// ---- how one a bot has stands, in a list

/** The last settled word for each superpower of each bot, so a reconnect does not flash "Connecting…". */
const settled = new Map<string, Standing>()

/**
 * How one a bot has stands, for the catalog and the bot's settings alike. While it reconnects, the
 * last settled word stands (kept while the app runs); only one never settled says "Connecting…".
 */
export function standingOf(botId: string, power: Superpower, status: SuperpowerStatus | undefined): Standing {
  const now = shortStanding(power, status)
  if (now.settled) settled.set(key(botId, power.id), now)
  return now.settled ? now : (settled.get(key(botId, power.id)) ?? now)
}

/** How the bot's superpowers stand. Nothing connects until it is needed, so a screen that shows this asks for it as it opens. */
export function useStatuses(botId: string): Record<string, SuperpowerStatus> | undefined {
  return useStore((s) => s.superpowerStatus[botId])
}
export const check = (botId: string) => api('POST', `/api/bots/${botId}/superpowers/check`)

// ---- activating

/** Activating one there is nothing to sign in to: at once, from its page. */
export async function activate(bot: Bot, power: Superpower) {
  setAttempt(bot.id, power.id, { busy: 'activating' })
  try {
    await api('PUT', `/api/bots/${bot.id}/superpowers/${power.id}`, { on: true })
    setAttempt(bot.id, power.id, {})
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  } catch (e) {
    setAttempt(bot.id, power.id, { error: failed('Couldn’t activate', e) })
  }
}

/**
 * Starts signing a bot in, from the sheet that asked where. What starts, or fails to, is the
 * sheet's to show; once it has started the sheet closes (`close`) and the rest happens over the
 * superpower's page: the phone's own sign-in sheet, or the bot's browser in control. A sign-in that
 * comes back failed says why on the page.
 */
export async function signIn(bot: Bot, power: Superpower, via: 'app' | 'bot', router: ReturnType<typeof useRouter>, close: () => void) {
  const path = `/api/bots/${bot.id}/superpowers/${power.id}/login`
  const started = await api<{ url?: string; windowId?: string; done?: true }>('POST', path, { via })
  setAttempt(bot.id, power.id, {})
  close()
  if (started.windowId) return router.push({ pathname: '/browser/[botId]', params: { botId: bot.id, threadId: signInThread(power.id), take: '1' } })
  if (!started.url) return
  const url = started.url
  // The phone shows its sign-in sheet once the choice has gone, not over it.
  await new Promise((done) => setTimeout(done, 450))
  setAttempt(bot.id, power.id, { busy: 'signing-in' })
  try {
    const result = await WebBrowser.openAuthSessionAsync(url, 'openkumi://sign-in/callback')
    if (result.type !== 'success') {
      setAttempt(bot.id, power.id, {})
      return void api('DELETE', path).catch(() => {})
    }
    await api('POST', '/api/superpowers/return', { url: result.url })
    setAttempt(bot.id, power.id, {})
  } catch (e) {
    setAttempt(bot.id, power.id, { error: failed('Sign-in didn’t finish', e) })
  }
}

// ---- deactivating

/**
 * Deactivating, always asked first, saying what is lost: a sign-in, and a webhook with the
 * automations it starts. Until the computer answers the page shows what it last said.
 */
export function deactivate(bot: Bot, power: Superpower, status: SuperpowerStatus | undefined, hooked: boolean) {
  const lost = [
    ...(status?.signedIn ? [`${bot.name}’s sign-in to ${power.name} is forgotten.`] : []),
    ...(hooked ? ['Its webhook is removed, and the automations it starts are paused.'] : []),
  ]
  Alert.alert(`Deactivate ${power.name}?`, lost.length ? lost.join(' ') : `${bot.name} stops using it.`, [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Deactivate',
      style: 'destructive',
      onPress: () => {
        setAttempt(bot.id, power.id, { busy: 'deactivating' })
        settled.delete(key(bot.id, power.id))
        api('PUT', `/api/bots/${bot.id}/superpowers/${power.id}`, { on: false }).then(
          () => setAttempt(bot.id, power.id, {}),
          (e) => setAttempt(bot.id, power.id, { error: `${failed('Couldn’t deactivate', e)} As far as this phone knows, ${power.name} is still on.` }),
        )
      },
    },
  ])
}
