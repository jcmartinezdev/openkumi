// Settings, opened from the gear on the list of bots. Laid out as T3 Code's phone app has it: the
// server this phone is paired with at the top, then a row per page. What this phone prefers is
// kept on it; the rest is kept on the server and is the same on every device, as on the computer.
import { Alert, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { Bot } from '@openkumi/shared'
import { saveSettings, useStore } from '@openkumi/client/store'
import { Glyph } from '../../src/icons'
import { useBotModel } from '../../src/ModelChip'
import { THEME_LABEL, usePrefs } from '../../src/prefs'
import { useServerStatus, useSession } from '../../src/session'
import { Avatar, ICON_INSET, Row, Section, SettingsPage, SwitchRow } from '../../src/SettingsUi'
import { useTheme } from '../../src/theme'

export default function Settings() {
  const theme = useTheme()
  const router = useRouter()
  const { server } = useSession()
  const status = useServerStatus()
  const prefs = usePrefs()
  const loaded = useStore((s) => s.loaded)
  const bots = useStore((s) => s.bots)
  const providers = useStore((s) => s.providers)
  const automations = useStore((s) => s.automations)
  const version = useStore((s) => s.about.version)
  const botMessages = useStore((s) => s.settings.botMessages)
  const connected = providers.filter((p) => p.connected && p.enabled !== false).length
  const name = server?.name ?? 'the server'

  return (
    <SettingsPage title="Settings">
      <Section inset={68}>
        <Row
          leading={
            <View style={[styles.server, { backgroundColor: theme.bubble }]}>
              <Glyph name="monitor" size={22} color={theme.text} weight={1.7} />
              <View style={[styles.dot, { backgroundColor: status.ok ? theme.ok : theme.run, borderColor: theme.groupCard }]} />
            </View>
          }
          label={name}
          detail={status.text}
          opens
          onPress={() => router.push('/settings/server')}
        />
      </Section>

      <Section title="This phone" inset={ICON_INSET}>
        <Row icon="sun" label="Appearance" value={THEME_LABEL[prefs.theme]} opens onPress={() => router.push('/settings/appearance')} />
      </Section>

      {loaded && (
        <Section title="Bots" inset={60} footer={bots.length ? 'Name, what it is for, rules, model, browser and superpowers of each bot.' : 'There are no bots on this server yet. Create one in the app on your computer, or ask a bot to make one.'}>
          {bots.map((bot, i) => <BotRow key={bot.id} bot={bot} main={i === 0 && bots.length > 1} />)}
        </Section>
      )}

      {loaded && (
        <Section footer="A bot can write into another bot’s conversation, to pass it work or ask it for something. You see the message in both.">
          <SwitchRow label="Bots can message each other" value={botMessages} onChange={(on) => void saveSettings({ botMessages: on }).catch((e) => Alert.alert('Not saved', (e as Error).message))} />
        </Section>
      )}

      {loaded && (
        <Section title={`On ${name}`} inset={ICON_INSET} footer="Kept on the computer that runs your bots, and the same on every device.">
          <Row icon="cpu" label="Providers" value={`${connected} connected`} opens onPress={() => router.push('/settings/providers')} />
          <Row icon="sliders" label="New bots" opens onPress={() => router.push('/settings/new-bots')} />
          <Row icon="clock" label="Automations" value={automations.length ? String(automations.length) : 'None'} opens onPress={() => router.push('/automations')} />
        </Section>
      )}

      <Section inset={ICON_INSET}>
        <Row icon="info" label="About" value={version ? `OpenKumi ${version}` : undefined} opens onPress={() => router.push('/settings/about')} />
      </Section>
    </SettingsPage>
  )
}

function BotRow({ bot, main }: { bot: Bot; main: boolean }) {
  const router = useRouter()
  const { name, effort } = useBotModel(bot)
  return (
    <Row
      leading={<Avatar bot={bot} />}
      label={bot.name}
      detail={[main && 'Main assistant', name, effort].filter(Boolean).join(' · ')}
      opens
      onPress={() => router.push({ pathname: '/settings/bot/[botId]', params: { botId: bot.id } })}
    />
  )
}

const styles = StyleSheet.create({
  server: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: -2, bottom: -2, width: 13, height: 13, borderRadius: 7, borderWidth: 2.5 },
})
