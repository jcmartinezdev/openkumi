// One bot's settings, as its owner sets them: the computer's page for the bot (Settings › Bots).
// What the bot knows (its AGENTS.md and memory) it writes itself, in its workspace, which opens
// from here; the rest is what it can do.
import { useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { Bot } from '@openkumi/shared'
import { windowCount } from '@openkumi/client/browser'
import { api, useFiles, useStore } from '@openkumi/client/store'
import { triggerLabel } from '@openkumi/client/automations'
import { inShort, summarize } from '@openkumi/client/workspace'
import { ProviderIcon, SuperpowerIcon } from '../../../src/icons'
import { useBotModel } from '../../../src/ModelChip'
import { Field, ICON_INSET, Row, Section, SettingsPage, Slot, SwitchRow } from '../../../src/SettingsUi'
import { check, standingOf, useStatuses } from '../../../src/superpowers'
import { StandingLine } from '../../../src/PowerUi'
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
  const zone = useStore((s) => s.about.timeZone)
  const statuses = useStatuses(botId)
  const { entries } = useFiles(botId)
  const allAutomations = useStore((s) => s.automations)
  /** What was just changed, shown at once instead of when the server has said so. */
  const [changed, setChanged] = useState<Partial<Bot> | null>(null)
  // Nothing connects until it is needed, so how the bot's services stand is asked for here.
  useEffect(() => void check(botId).catch(() => {}), [botId])
  useEffect(() => setChanged(null), [stored])

  // Gone, because it was deleted here or elsewhere.
  if (!stored) return null
  const bot = { ...stored, ...changed }
  const automations = allAutomations.filter((a) => a.botId === bot.id)

  const save = (patch: Partial<Bot>) => {
    setChanged((before) => ({ ...before, ...patch }))
    api('PATCH', `/api/bots/${bot.id}`, patch).catch((e) => (setChanged(null), Alert.alert('Not saved', (e as Error).message)))
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

      <Section title="What it is for" footer="One line. The other bots are told it, so they know what to pass on to this bot; the bot cannot change it.">
        <Field label="What it is for" multiline value={bot.description} placeholder="For example: plans trips and books travel." onCommit={(description) => save({ description })} />
      </Section>

      <Section title="Rules from you" footer={`${bot.name} follows these and cannot change them. Its own instructions, which it writes and updates itself, are in its workspace.`}>
        <Field label="Rules" multiline value={bot.rules} placeholder="For example: never send an email without asking me first." onCommit={(rules) => save({ rules })} />
      </Section>

      <Section title="Workspace" inset={ICON_INSET} footer={`${bot.name} keeps these itself.`}>
        <Row icon="folder" label="Explore workspace" detail={entries ? inShort(summarize(entries)) : undefined} opens onPress={() => router.push({ pathname: '/workspace/[botId]', params: { botId: bot.id } })} />
      </Section>

      <Section title="Model" inset={ICON_INSET}>
        <ModelRow bot={bot} open={() => router.push({ pathname: '/model/[botId]', params: { botId: bot.id } })} />
        <SwitchRow label="Web search" detail="Use the model’s built-in search." value={bot.webSearch} onChange={(webSearch) => save({ webSearch })} />
      </Section>

      {/* Only the ones the bot has; the others are a tap away, so the page does not list every superpower there is. */}
      <Section
        title="Superpowers"
        inset={ICON_INSET}
        footer="What the bot can do beyond its own tools. Only you can activate one; the bot cannot. Each bot signs in to an app in its own browser, so each can use a different account."
      >
        {powers.filter((power) => bot.superpowers.includes(power.id)).map((power) => (
          <Row
            key={power.id}
            leading={<Slot><SuperpowerIcon power={power} /></Slot>}
            label={power.name}
            detail={<StandingLine standing={standingOf(bot.id, power, statuses?.[power.id])} />}
            opens
            onPress={() => router.push({ pathname: '/superpowers/[botId]/[id]', params: { botId: bot.id, id: power.id } })}
          />
        ))}
        <Row icon="compass" label="Browse superpowers" tone="action" opens onPress={() => router.push({ pathname: '/superpowers/[botId]', params: { botId: bot.id } })} />
      </Section>

      <Section title="Automations" inset={ICON_INSET}>
        {automations.map((automation) => (
          <Row
            key={automation.id}
            icon={automation.trigger.kind === 'time' ? 'clock' : automation.trigger.kind === 'watch' ? 'eye' : 'bolt'}
            label={automation.title}
            detail={automation.enabled ? triggerLabel(automation.trigger, zone) : 'Paused'}
            opens
            onPress={() => router.push({ pathname: '/automations/[id]', params: { id: automation.id } })}
          />
        ))}
        <Row icon="plus" label="New automation" tone="action" onPress={() => router.push({ pathname: '/automations/[id]', params: { id: 'new', botId: bot.id } })} />
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

      <Section footer="Removes its conversations, files, memory and saved logins.">
        <Row label="Delete this bot" tone="destructive" onPress={remove} />
      </Section>
    </SettingsPage>
  )
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
