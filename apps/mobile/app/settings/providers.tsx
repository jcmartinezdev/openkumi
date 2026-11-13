// What bots can run on, and whether each is ready: the computer's Providers page, without what
// only the computer can do (signing in to a program, where it is, API keys). A provider switched
// off is not offered for bots, on any device.
import { useEffect, useState } from 'react'
import { Alert, Text } from 'react-native'
import type { ProviderInfo } from '@openkumi/shared'
import { api, saveSettings, useStore } from '@openkumi/client/store'
import { ProviderIcon } from '../../src/icons'
import { useSession } from '../../src/session'
import { ICON_INSET, Section, SettingsPage, Slot, SwitchRow } from '../../src/SettingsUi'
import { useTheme } from '../../src/theme'

/** How a provider stands, in a few words, as the computer says it. */
function standing(provider: ProviderInfo): string {
  if (provider.enabled === false) return 'Switched off'
  if (!provider.connected) return provider.hint ?? provider.detail
  return provider.kind === 'cli' ? `Signed in · ${provider.detail.replace(/^Signed in with /, '')}` : provider.detail
}

export default function ProviderSettings() {
  const theme = useTheme()
  const { server } = useSession()
  const providers = useStore((s) => s.providers)
  const off = useStore((s) => s.settings.disabledProviders) ?? []
  const [checking, setChecking] = useState(false)

  // The programs may have been installed, updated or signed in since the server last looked.
  const check = () => {
    setChecking(true)
    api('POST', '/api/providers/check')
      .catch(() => {})
      .finally(() => setChecking(false))
  }
  useEffect(check, [])

  const turn = (provider: ProviderInfo, on: boolean) =>
    saveSettings({ disabledProviders: on ? off.filter((id) => id !== provider.id) : [...off, provider.id] }).catch((e) => Alert.alert('Not saved', (e as Error).message))

  return (
    <SettingsPage title="Providers" subtitle={server?.name} refresh={{ busy: checking, run: check }}>
      <Section
        inset={ICON_INSET}
        footer="Switched off, a provider is not offered for bots. Signing in, where a program is and API keys are set in OpenKumi on the computer, in Settings › Providers. Pull down to look again."
      >
        {providers.map((p) => (
          <SwitchRow
            key={p.id}
            leading={<Slot><ProviderIcon provider={p} size={22} color={theme.text} /></Slot>}
            label={p.name}
            detail={<Text style={{ color: p.connected && p.enabled !== false ? theme.faint : theme.run, fontSize: 13.5, lineHeight: 18 }}>{standing(p)}</Text>}
            value={p.enabled !== false}
            onChange={(on) => void turn(p, on)}
          />
        ))}
      </Section>
    </SettingsPage>
  )
}
