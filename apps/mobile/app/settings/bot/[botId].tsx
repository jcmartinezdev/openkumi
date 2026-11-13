// One bot's settings, as its owner sets them: the computer's page for the bot (Settings › Bots),
// without its files, which need the computer. What the bot knows (its AGENTS.md
// and memory) it writes itself; this is what it can do.
import { Fragment, useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import type { Bot, Superpower, SuperpowerStatus } from '@openkumi/shared'
import { signInThread, windowCount } from '@openkumi/client/browser'
import { api, useStore } from '@openkumi/client/store'
import { scheduleLabel } from '@openkumi/client/tasks'
import { ProviderIcon, SuperpowerIcon } from '../../../src/icons'
import { useBotModel } from '../../../src/ModelChip'
import { Field, ICON_INSET, Row, Section, SettingsPage, Slot, SwitchRow } from '../../../src/SettingsUi'
import { useTheme } from '../../../src/theme'
import { describeLook } from '@openkumi/client/mascot'
import { Mascot } from '../../../src/Mascot'

export default function BotSettings() {
  const theme = useTheme()
  const router = useRouter()
  const { botId } = useLocalSearchParams<{ botId: string }>()
  const stored = useStore((s) => s.bots.find((b) => b.id === botId))
  const main = useStore((s) => s.bots[0]?.id === botId && s.bots.length > 1)
  const browser = useStore((s) => s.browsers[botId])
  const powers = useStore((s) => s.superpowers)
  const statuses = useStore((s) => s.superpowerStatus[botId])
  const zone = useStore((s) => s.about.timeZone)
  const allTasks = useStore((s) => s.tasks)
  /** What was just changed, shown at once instead of when the server has said so. */
  const [changed, setChanged] = useState<Partial<Bot> | null>(null)
  // Nothing connects until it is needed, so how the bot's services stand is asked for here.
  useEffect(() => void api('POST', `/api/bots/${botId}/superpowers/check`).catch(() => {}), [botId])
  useEffect(() => setChanged(null), [stored])

  // Gone, because it was deleted here or elsewhere.
  if (!stored) return null
  const bot = { ...stored, ...changed }
  const tasks = allTasks.filter((t) => t.botId === bot.id)

  const save = (patch: Partial<Bot>) => {
    setChanged((before) => ({ ...before, ...patch }))
    api('PATCH', `/api/bots/${bot.id}`, patch).catch((e) => (setChanged(null), Alert.alert('Not saved', (e as Error).message)))
  }
  const deactivate = (power: Superpower) => {
    const turn = () => api('PUT', `/api/bots/${bot.id}/superpowers/${power.id}`, { on: false }).catch((e) => Alert.alert('Not saved', (e as Error).message))
    if (!statuses?.[power.id]?.signedIn) return void turn()
    Alert.alert(`Deactivate ${power.name}?`, `${bot.name}’s sign-in to ${power.name} is forgotten.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Deactivate', style: 'destructive', onPress: () => void turn() },
    ])
  }
  // One that works in an app is active once the bot has signed in to it. On the phone that happens
  // in the bot's own browser, on the browser screen, with the phone in control, or on the phone itself.
  const signIn = (power: Superpower) =>
    api<{ windowId?: string }>('POST', `/api/bots/${bot.id}/superpowers/${power.id}/login`, { via: 'bot' }).then(
      ({ windowId }) => windowId && router.push({ pathname: '/browser/[botId]', params: { botId: bot.id, threadId: signInThread(power.id), take: '1' } }),
      (e) => Alert.alert('Could not start the sign-in', (e as Error).message),
    )
  // On the phone itself: the service's page opens in a sign-in sheet that has the accounts the phone
  // has in Safari. The service sends the sheet back to the app's own address (Google's by way of Open
  // Bot's page on the web), the sheet hands that over, and the server finishes the sign-in.
  const signInHere = async (power: Superpower) => {
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
  const activate = (power: Superpower, again = false) => {
    if (!power.signIn) {
      return Alert.alert(`Activate ${power.name}?`, `${bot.name} can use ${power.name} as soon as it is active. There is nothing to sign in to.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Activate', onPress: () => void api('PUT', `/api/bots/${bot.id}/superpowers/${power.id}`, { on: true }).catch((e) => Alert.alert('Not activated', (e as Error).message)) },
      ])
    }
    // Registering OpenKumi with Google means its Cloud console and pasting two values, which is the computer's job.
    const registration = power.registration
    if (registration && !registration.done) {
      return Alert.alert(
        `Set up ${registration.name} first`,
        `Before a bot can sign in to ${power.name}, OpenKumi has to be registered with ${registration.name}, once. Do that on your computer: in the OpenKumi app, open Settings, then Superpowers, then ${power.name}.`,
      )
    }
    // A company that admits only registered apps (Google) comes back to the phone by way of OpenKumi's page, which this version may not have.
    const here = !registration || registration.ownBrowser
    Alert.alert(
      again ? `Sign ${bot.name} in to ${power.name} again?` : `Activate ${power.name}?`,
      `${bot.name} signs in to ${power.name} with an account of its own${here ? ': on this phone, with the accounts you have in Safari, or inside its own browser, which suits a different account' : ', inside its own browser'}.${again ? '' : ` Once it is signed in, ${power.name} is active.`}`,
      [
        { text: 'Cancel', style: 'cancel' },
        ...(here ? [{ text: 'Sign in on this phone', onPress: () => void signInHere(power) }] : []),
        { text: `Sign in inside ${bot.name}’s browser`, onPress: () => void signIn(power) },
      ],
    )
  }
  const openLook = () => router.push({ pathname: '/settings/look/[botId]', params: { botId: bot.id } })
  const remove = () =>
    Alert.alert(`Delete ${bot.name}?`, 'Its conversations, files, memory and saved logins are removed. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => api('DELETE', `/api/bots/${bot.id}`).then(() => router.back(), (e) => Alert.alert('Not deleted', (e as Error).message)),
      },
    ])

  return (
    <SettingsPage title={bot.name} subtitle="Bot settings">
      <Pressable accessibilityRole="button" accessibilityLabel={`Change ${bot.name}’s look`} style={styles.hero} onPress={openLook}>
        <Mascot look={bot.look} emoji={bot.emoji} size={120} live />
        {main && <Text style={[styles.tag, { color: theme.muted, borderColor: theme.border }]}>Main assistant</Text>}
      </Pressable>

      <Section>
        <Field label="Name" value={bot.name} required onCommit={(name) => save({ name })} />
        <Row label="Look" detail={bot.choosingLook ? 'Choosing its look…' : describeLook(bot.look)} opens onPress={openLook} />
      </Section>

      <Section title="What it is for" footer="One line. The other bots are told it, so they know when to hand this bot work; the bot cannot change it.">
        <Field label="What it is for" multiline value={bot.description} placeholder="For example: plans trips and books travel." onCommit={(description) => save({ description })} />
      </Section>

      <Section title="Rules from you" footer="The bot follows these and cannot change them. Its own instructions, which it writes and updates itself, are in AGENTS.md among its files.">
        <Field label="Rules" multiline value={bot.rules} placeholder="For example: never send an email without asking me first." onCommit={(rules) => save({ rules })} />
      </Section>

      <Section title="Model" inset={ICON_INSET}>
        <ModelRow bot={bot} open={() => router.push({ pathname: '/model/[botId]', params: { botId: bot.id } })} />
        <SwitchRow label="Web search" detail="Use the model’s built-in search." value={bot.webSearch} onChange={(webSearch) => save({ webSearch })} />
      </Section>

      <Section
        title="Browser"
        inset={ICON_INSET}
        footer="Show the browser window also opens it on the desktop of the computer running OpenKumi. Some sites only allow signing in that way. It takes effect the next time the browser starts."
      >
        <Row
          icon="globe"
          label="Open its browser"
          detail={browser?.running ? `Running, with ${windowCount(browser)} open` : 'Not running. It starts when the bot needs it.'}
          opens
          onPress={() => router.push({ pathname: '/browser/[botId]', params: { botId: bot.id } })}
        />
        <SwitchRow label="Show the browser window" value={!bot.headless} onChange={(shown) => save({ headless: !shown })} />
        {browser?.running && <Row label="Stop its browser" tone="action" onPress={() => api('POST', `/api/bots/${bot.id}/browser/stop`).catch((e) => Alert.alert('Not stopped', (e as Error).message))} />}
      </Section>

      <Section
        title="Superpowers"
        inset={ICON_INSET}
        footer="What the bot can do beyond its own tools. Only you can activate one; the bot cannot. Each bot signs in to an app in its own browser, so each can use a different account."
      >
        {powers.map((power) => {
          const on = bot.superpowers.includes(power.id)
          return (
            <Fragment key={power.id}>
              <Row
                leading={<Slot><SuperpowerIcon power={power} /></Slot>}
                label={power.name}
                detail={<Text style={{ color: theme.faint, fontSize: 13.5, lineHeight: 18 }} numberOfLines={2}>{(on && standing(power, statuses?.[power.id])) || power.tagline}</Text>}
                value={on ? 'Active' : undefined}
              />
              {on && statuses?.[power.id]?.state === 'needs-login' && (
                <Row icon="globe" label="Sign in again" tone="action" onPress={() => activate(power, true)} />
              )}
              {on ? (
                <Row icon="x" label="Deactivate superpower" tone="destructive" accessibilityHint={`Takes ${power.name} away from ${bot.name}`} onPress={() => deactivate(power)} />
              ) : (
                <Row icon="plus" label="Activate superpower" tone="action" accessibilityHint={`Gives ${bot.name} ${power.name}`} onPress={() => activate(power)} />
              )}
            </Fragment>
          )
        })}
      </Section>

      <Section title="Scheduled tasks" inset={ICON_INSET}>
        {tasks.map((task) => (
          <Row
            key={task.id}
            icon="clock"
            label={task.title}
            detail={task.enabled ? scheduleLabel(task.schedule, zone) : 'Paused'}
            opens
            onPress={() => router.push({ pathname: '/tasks/[id]', params: { id: task.id } })}
          />
        ))}
        <Row icon="plus" label="New task" tone="action" onPress={() => router.push({ pathname: '/tasks/[id]', params: { id: 'new', botId: bot.id } })} />
      </Section>

      <Section footer="Removes its conversations, files, memory and saved logins.">
        <Row label="Delete this bot" tone="destructive" onPress={remove} />
      </Section>
    </SettingsPage>
  )
}

/** How a superpower with a service stands for a bot that has it, when that is worth saying instead of what it is for. */
function standing(power: Superpower, status: SuperpowerStatus | undefined): string {
  if (!power.service || !status) return ''
  if (status.state === 'connected') return `${status.signedIn ? 'Signed in' : 'Connected'} · ${status.tools} ${status.tools === 1 ? 'tool' : 'tools'}`
  if (status.state === 'needs-login') return 'Not signed in any more.'
  if (status.state === 'error') return status.error ?? 'Not working.'
  return ''
}

/** What the bot runs on; opens the same sheet as the model chip in the conversation. */
function ModelRow({ bot, open }: { bot: Bot; open: () => void }) {
  const theme = useTheme()
  const { provider, name, effort } = useBotModel(bot)
  const state = provider && !provider.connected ? `${provider.name} is not connected` : provider?.name ?? bot.provider
  return (
    <Row
      leading={provider ? <Slot><ProviderIcon provider={provider} size={20} color={theme.text} /></Slot> : undefined}
      icon={provider ? undefined : 'cpu'}
      label={name}
      detail={[state, effort && `${effort} reasoning`].filter(Boolean).join(' · ')}
      opens
      onPress={open}
    />
  )
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: 10, marginBottom: -8 },
  tag: { fontSize: 12.5, paddingHorizontal: 8, paddingVertical: 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, overflow: 'hidden' },
})
