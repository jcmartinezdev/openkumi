// The server this phone is paired with: what the phone calls it, how the connection stands, the
// addresses it is reached at, and unpairing. Who may connect is decided only on the computer that
// runs the bots.
import { useState } from 'react'
import { Alert } from 'react-native'
import { useRouter } from 'expo-router'
import { KIND_NAMES, kindOf, ordered } from '@openbot/client/addresses'
import { useStore } from '@openbot/client/store'
import { addAddress, forget, hostOf, removeAddress, rename, useServerStatus, useSession } from '../../src/session'
import { Field, Row, Section, SettingsPage } from '../../src/SettingsUi'

export default function ServerSettings() {
  const router = useRouter()
  const { server } = useSession()
  const status = useServerStatus()
  const about = useStore((s) => s.about)
  const inUse = useStore((s) => s.address)
  const [note, setNote] = useState('')
  if (!server) return null
  const host = hostOf(server)

  const unpair = () =>
    Alert.alert('Unpair this phone?', `The phone forgets ${server.name}. To use it again, pair it again with a new code.`, [
      { text: 'Cancel', style: 'cancel' },
      // Back to the first screen before the server is forgotten, which then makes way for pairing.
      { text: 'Unpair', style: 'destructive', onPress: () => (router.dismissAll(), void forget()) },
    ])

  const add = async (address: string) => {
    if (!address) return
    setNote('')
    try {
      const { checked } = await addAddress(address)
      if (!checked) setNote(`Added. Nothing answers there right now: it is sent this phone’s key only once it has shown it is ${server.name}.`)
    } catch (e) {
      Alert.alert('That address was not added', (e as Error).message)
    }
  }
  const remove = (url: string) =>
    Alert.alert('Remove this address?', new URL(url).host, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeAddress(url) },
    ])

  return (
    <SettingsPage title={server.name} subtitle="Server">
      <Section footer="What this phone calls it. Leave it empty to show its address.">
        <Field label="Name" value={server.name === host ? '' : server.name} placeholder={host} onCommit={(name) => void rename(name)} />
      </Section>

      <Section title="Connection">
        <Row label="Status" value={status.word} />
        {!!inUse && <Row label="Through" value={KIND_NAMES[kindOf(inUse)]} />}
        {!!about.version && <Row label="Open Bot" value={about.version} />}
        {!!about.timeZone && <Row label="Time zone" value={about.timeZone} />}
      </Section>

      <Section
        title="Addresses"
        footer={
          note ||
          `Tried from the top: the home network, then Tailscale, then the rest. The ones the server reports itself stay up to date by themselves. This phone’s key goes to an address only after whatever answers there has shown it is ${server.name}. Plain http works at home and over Tailscale; anywhere else the address needs https.`
        }
      >
        {ordered(server.addresses).map((url) => {
          const found = server.addresses.find((a) => a.url === url)?.found
          const removable = !found && server.addresses.length > 1
          return (
            <Row
              key={url}
              label={new URL(url).host}
              detail={[KIND_NAMES[kindOf(url)], url === inUse && 'in use', found && 'reported by the server'].filter(Boolean).join(' · ')}
              onPress={removable ? () => remove(url) : undefined}
              accessibilityHint={removable ? 'Removes this address' : undefined}
            />
          )
        })}
        <Field key={server.addresses.length} label="Add" value="" placeholder="mac-mini.tail1234.ts.net:4317" autoCapitalize="none" keyboardType="url" onCommit={(address) => void add(address)} />
      </Section>

      <Section footer="This phone has a key of its own, kept in its keychain. The computer can shut it out at any time, in Settings › Environments.">
        <Row label="Unpair this phone" tone="destructive" onPress={unpair} />
      </Section>
    </SettingsPage>
  )
}
