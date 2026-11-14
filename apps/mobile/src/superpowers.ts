// Giving a bot a superpower from the phone and taking it away again. One that works in an app is
// active once the bot has signed in to it: on the phone itself, with the accounts Safari has, or
// inside the bot's own browser, which suits a different account.
import { ActionSheetIOS, Alert } from 'react-native'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import type { Bot, Superpower, SuperpowerStatus } from '@openkumi/shared'
import { signInThread } from '@openkumi/client/browser'
import { api, useStore } from '@openkumi/client/store'

export function usePowers(bot: Bot | undefined) {
  const router = useRouter()
  const statuses = useStore((s) => (bot ? s.superpowerStatus[bot.id] : undefined))

  const deactivate = (bot: Bot, power: Superpower) => {
    const turn = () => api('PUT', `/api/bots/${bot.id}/superpowers/${power.id}`, { on: false }).catch((e) => Alert.alert('Not saved', (e as Error).message))
    if (!statuses?.[power.id]?.signedIn) return void turn()
    Alert.alert(`Deactivate ${power.name}?`, `${bot.name}’s sign-in to ${power.name} is forgotten.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Deactivate', style: 'destructive', onPress: () => void turn() },
    ])
  }
  // In the bot's own browser, on the browser screen, with the phone in control.
  const signIn = (bot: Bot, power: Superpower) =>
    api<{ windowId?: string }>('POST', `/api/bots/${bot.id}/superpowers/${power.id}/login`, { via: 'bot' }).then(
      ({ windowId }) => windowId && router.push({ pathname: '/browser/[botId]', params: { botId: bot.id, threadId: signInThread(power.id), take: '1' } }),
      (e) => Alert.alert('Could not start the sign-in', (e as Error).message),
    )
  // On the phone itself: the service's page opens in a sign-in sheet that has the accounts the phone
  // has in Safari. The service sends the sheet back to the app's own address, the sheet hands that
  // over, and the server finishes the sign-in.
  const signInHere = async (bot: Bot, power: Superpower) => {
    const path = `/api/bots/${bot.id}/superpowers/${power.id}/login`
    try {
      const { url } = await api<{ url?: string }>('POST', path, { via: 'app' })
      if (!url) return
      const result = await WebBrowser.openAuthSessionAsync(url, 'openkumi://sign-in/callback')
      if (result.type !== 'success') return void api('DELETE', path).catch(() => {})
      await api('POST', '/api/superpowers/return', { url: result.url })
    } catch (e) {
      Alert.alert('Not signed in', (e as Error).message)
    }
  }
  const activate = (bot: Bot, power: Superpower, again = false) => {
    if (!power.signIn) {
      return Alert.alert(`Activate ${power.name}?`, `${bot.name} can use ${power.name} as soon as it is active. There is nothing to sign in to.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Activate', onPress: () => void api('PUT', `/api/bots/${bot.id}/superpowers/${power.id}`, { on: true }).catch((e) => Alert.alert('Not activated', (e as Error).message)) },
      ])
    }
    Alert.alert(
      again ? `Sign ${bot.name} in to ${power.name} again?` : `Activate ${power.name}?`,
      `${bot.name} signs in to ${power.name} with an account of its own: on this phone, with the accounts you have in Safari, or inside its own browser, which suits a different account.${again ? '' : ` Once it is signed in, ${power.name} is active.`}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in on this phone', onPress: () => void signInHere(bot, power) },
        { text: `Sign in inside ${bot.name}’s browser`, onPress: () => void signIn(bot, power) },
      ],
    )
  }
  /** What can be done with one the bot has: sign in again, where it signs in, and deactivate it. */
  const manage = (bot: Bot, power: Superpower) => {
    const options = [...(power.signIn ? ['Sign in again'] : []), 'Deactivate', 'Cancel']
    ActionSheetIOS.showActionSheetWithOptions(
      { title: power.name, message: standing(power, statuses?.[power.id]) || power.tagline, options, destructiveButtonIndex: options.length - 2, cancelButtonIndex: options.length - 1 },
      (i) => (options[i] === 'Sign in again' ? activate(bot, power, true) : options[i] === 'Deactivate' ? deactivate(bot, power) : undefined),
    )
  }
  return { statuses, activate, manage }
}

/** How a superpower with a service stands for a bot that has it, when that is worth saying instead of what it is for. */
export function standing(power: Superpower, status: SuperpowerStatus | undefined): string {
  if (!power.service || !status) return ''
  if (status.state === 'connected') return `${status.signedIn ? 'Signed in' : 'Connected'} · ${status.tools} ${status.tools === 1 ? 'tool' : 'tools'}`
  if (status.state === 'needs-login') return 'Not signed in any more'
  if (status.state === 'error') return status.error ?? 'Not working.'
  return ''
}
