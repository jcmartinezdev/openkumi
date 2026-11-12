// One bot's settings, as its owner sets them: the computer's page for the bot (Settings › Bots),
// without its files and connections, which need the computer. What the bot knows (its AGENTS.md
// and memory) it writes itself; this is what it can do.
import { useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { Bot, Skill } from '@openbot/shared'
import { api, refreshSkills, useStore } from '@openbot/client/store'
import { scheduleLabel } from '@openbot/client/tasks'
import { ProviderIcon } from '../../../src/icons'
import { useBotModel } from '../../../src/ModelChip'
import { Field, ICON_INSET, Row, Section, SettingsPage, Slot, SwitchRow } from '../../../src/SettingsUi'
import { useTheme } from '../../../src/theme'
import { describeLook } from '@openbot/client/mascot'
import { Mascot } from '../../../src/Mascot'

export default function BotSettings() {
  const theme = useTheme()
  const router = useRouter()
  const { botId } = useLocalSearchParams<{ botId: string }>()
  const stored = useStore((s) => s.bots.find((b) => b.id === botId))
  const main = useStore((s) => s.bots[0]?.id === botId && s.bots.length > 1)
  const browser = useStore((s) => s.browsers[botId])
  const skills = useStore((s) => s.skills)
  const zone = useStore((s) => s.about.timeZone)
  const allTasks = useStore((s) => s.tasks)
  /** What was just changed, shown at once instead of when the server has said so. */
  const [changed, setChanged] = useState<Partial<Bot> | null>(null)
  // The skill catalog is a folder the owner can add to by hand, so it is asked for afresh.
  useEffect(() => void refreshSkills().catch(() => {}), [])
  useEffect(() => setChanged(null), [stored])

  // Gone, because it was deleted here or elsewhere.
  if (!stored) return null
  const bot = { ...stored, ...changed }
  const tasks = allTasks.filter((t) => t.botId === bot.id)

  const save = (patch: Partial<Bot>) => {
    setChanged((before) => ({ ...before, ...patch }))
    api('PATCH', `/api/bots/${bot.id}`, patch).catch((e) => (setChanged(null), Alert.alert('Not saved', (e as Error).message)))
  }
  const setSkill = (skill: Skill, on: boolean) => {
    const turn = () => api('PUT', `/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}`, { on }).catch((e) => Alert.alert('Not saved', (e as Error).message))
    if (!on || skill.bundled) return void turn()
    // Skills the owner added did not come with Open Bot; the bot would follow whatever they say.
    Alert.alert(`Switch on “${skill.title}”?`, `It did not come with Open Bot. ${bot.name} will follow its instructions with access to its browser and accounts.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Switch on', onPress: () => void turn() },
    ])
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
        footer="Show the browser window also opens it on the desktop of the computer running Open Bot. Some sites only allow signing in that way. It takes effect the next time the browser starts."
      >
        <Row
          icon="globe"
          label="Open its browser"
          detail={browser?.running ? `Running, with ${browser.tabs.length} ${browser.tabs.length === 1 ? 'tab' : 'tabs'} open` : 'Not running. It starts when the bot needs it.'}
          opens
          onPress={() => router.push({ pathname: '/browser/[botId]', params: { botId: bot.id } })}
        />
        <SwitchRow label="Show the browser window" value={!bot.headless} onChange={(shown) => save({ headless: !shown })} />
        {browser?.running && <Row label="Stop its browser" tone="action" onPress={() => api('POST', `/api/bots/${bot.id}/browser/stop`).catch((e) => Alert.alert('Not stopped', (e as Error).message))} />}
      </Section>

      <Section title="Skills" footer={skills.length ? 'Instructions the bot reads when a task calls for them. The catalog is kept on the computer; the bot cannot switch skills on itself.' : 'The skill catalog is empty.'}>
        {skills.map((skill) => (
          <SwitchRow
            key={skill.name}
            label={skill.title}
            detail={<Text style={{ color: theme.faint, fontSize: 13.5, lineHeight: 18 }} numberOfLines={2}>{skill.bundled ? skill.description : `Added by you · ${skill.description}`}</Text>}
            value={bot.skills.includes(skill.name)}
            onChange={(on) => setSkill(skill, on)}
          />
        ))}
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
