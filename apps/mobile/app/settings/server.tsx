// The server this phone is paired with: what the phone calls it, how the connection stands, and
// unpairing. Who may connect is decided only on the computer that runs the bots.
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { useStore } from '@openbot/client/store'
import { forget, rename, useServerStatus, useSession } from '../../src/session'
import { Field, Row, Section, SettingsPage } from '../../src/SettingsUi'

export default function ServerSettings() {
  const router = useRouter()
  const { server } = useSession()
  const status = useServerStatus()
  const about = useStore((s) => s.about)
  if (!server) return null
  const host = new URL(server.url).host

  const unpair = () =>
    Alert.alert('Unpair this phone?', `The phone forgets ${server.name}. To use it again, pair it again with a new code.`, [
      { text: 'Cancel', style: 'cancel' },
      // Back to the first screen before the server is forgotten, which then makes way for pairing.
      { text: 'Unpair', style: 'destructive', onPress: () => (router.dismissAll(), void forget()) },
    ])

  return (
    <SettingsPage title={server.name} subtitle="Server">
      <Section footer="What this phone calls it. Leave it empty to show its address.">
        <Field label="Name" value={server.name === host ? '' : server.name} placeholder={host} onCommit={(name) => void rename(name)} />
      </Section>

      <Section title="Connection">
        <Row label="Status" value={status.word} />
        <Row label="Address" value={host} />
        {!!about.version && <Row label="Open Bot" value={about.version} />}
        {!!about.timeZone && <Row label="Time zone" value={about.timeZone} />}
      </Section>

      <Section footer="This phone has a key of its own, kept in its keychain. The computer can shut it out at any time, in Settings › Environments.">
        <Row label="Unpair this phone" tone="destructive" onPress={unpair} />
      </Section>
    </SettingsPage>
  )
}
