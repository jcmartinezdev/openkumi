// What a new bot starts with: the computer's Settings › General › New bots. Each bot can be
// changed afterwards, in its own settings.
import { Alert } from 'react-native'
import * as Haptics from 'expo-haptics'
import type { Settings } from '@openbot/shared'
import { saveSettings, useStore } from '@openbot/client/store'
import { ProviderIcon } from '../../src/icons'
import { useSession } from '../../src/session'
import { ICON_INSET, Row, Section, SettingsPage, Slot, SwitchRow } from '../../src/SettingsUi'
import { useTheme } from '../../src/theme'

export default function NewBotSettings() {
  const theme = useTheme()
  const { server } = useSession()
  const settings = useStore((s) => s.settings)
  const providers = useStore((s) => s.providers)
  // What a new bot could run on: what is ready, plus what is chosen now.
  const usable = providers.filter((p) => (p.connected && p.enabled !== false) || p.id === settings.defaultProvider)
  const save = (patch: Partial<Settings>) => saveSettings(patch).catch((e) => Alert.alert('Not saved', (e as Error).message))
  const runOn = (id: string) => {
    if (id === settings.defaultProvider) return
    void Haptics.selectionAsync()
    void save({ defaultProvider: id })
  }

  return (
    <SettingsPage title="New bots" subtitle={server?.name}>
      <Section title="Run on" inset={ICON_INSET} footer="What a new bot runs on. Each bot can be moved to another afterwards.">
        <Row icon="cpu" label="The first one connected" checked={!settings.defaultProvider} onPress={() => runOn('')} />
        {usable.map((p) => (
          <Row
            key={p.id}
            leading={<Slot><ProviderIcon provider={p} size={20} color={theme.text} /></Slot>}
            label={p.name}
            detail={p.connected ? undefined : 'Not connected'}
            checked={settings.defaultProvider === p.id}
            onPress={() => runOn(p.id)}
          />
        ))}
      </Section>

      <Section footer="Show the browser window opens a new bot’s browser on the desktop of the computer running Open Bot, as well as in the app. Some sites only allow signing in that way.">
        <SwitchRow label="Web search" detail="New bots may use the model’s built-in search." value={settings.defaultWebSearch} onChange={(defaultWebSearch) => void save({ defaultWebSearch })} />
        <SwitchRow label="Show the browser window" value={settings.defaultShowBrowser} onChange={(defaultShowBrowser) => void save({ defaultShowBrowser })} />
      </Section>
    </SettingsPage>
  )
}
