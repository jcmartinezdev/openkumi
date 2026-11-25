// One of a bot's secrets, or a new one (NEW_SECRET in place of a name): what it is, the sites it is sent to, and its
// value, which is typed here and never shown again on the phone. Only the computer that runs
// OpenKumi reads a value back.
import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { Stack, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { NEW_SECRET, addSecret, howKept, removeSecret, saveSecret, secretStanding, useSecrets } from '@openkumi/client/secrets'
import { useStore } from '@openkumi/client/store'
import { Field, Note, Row, Section, SettingsPage } from '../../../../src/SettingsUi'

export default function SecretPage() {
  const router = useRouter()
  const { botId, name: given } = useLocalSearchParams<{ botId: string; name: string }>()
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const { data, error: fetchError } = useSecrets(botId)
  const isNew = given === NEW_SECRET
  const secret = isNew ? undefined : data?.secrets.find((s) => s.name === given)
  const [name, setName] = useState('')
  const [what, setWhat] = useState('')
  const [sites, setSites] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A screen that goes away with a hidden field still filled has the phone ask whether to keep "the password" in
  // Passwords. So leaving waits a moment for the field to be emptied, whichever way the screen is left.
  usePreventRemove(!!value, ({ repeat }) => (setValue(''), void setTimeout(repeat, 150)))
  // The fields start from what is kept, once that has come.
  const known = secret ? `${secret.what}\n${secret.sites.join(', ')}` : ''
  useEffect(() => {
    if (!secret) return
    setWhat(secret.what)
    setSites(secret.sites.join(', '))
  }, [known])

  // Removed here or on another device: there is nothing left to show.
  useEffect(() => void (!isNew && data && !secret && router.back()), [isNew, data, secret])
  if (!bot) return null

  const changed = isNew ? !!(name.trim() && sites.trim() && value) : !!secret && (what !== secret.what || sites !== secret.sites.join(', ') || !!value)
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      // Adding never writes over one that is there: a name that is taken is said to be.
      if (isNew) await addSecret(bot.id, { name, what, sites, value })
      else await saveSecret(bot.id, given, { what, sites, ...(value ? { value } : {}) })
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setValue('')
      // Once the field is empty, which leaving waits for (see above).
      if (isNew) setTimeout(() => router.back(), 150)
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  const remove = () =>
    secret &&
    Alert.alert(`Remove “${secret.name}”?`, `Its value is deleted. ${secret.by === 'bot' ? `${bot.name} kept it itself, so it may be written down nowhere else.` : 'What needs it will ask for it again.'}`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removeSecret(bot.id, secret.name).catch((e) => setError((e as Error).message)) },
    ])

  return (
    <SettingsPage title={isNew ? 'New secret' : given} subtitle={isNew ? bot.name : `${bot.name} · Secret`} buttons={1}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={busy || !changed} onPress={() => void save()}>
          {isNew ? 'Add' : 'Save'}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      {!!(error || fetchError) && <Note tone="error">{error || fetchError}</Note>}
      {!!secret?.problem && <Note tone="error">{secret.problem}</Note>}

      {secret && (
        <Section>
          <Row label={secret.by === 'bot' ? `Kept by ${bot.name}` : 'Added by you'} value={secretStanding(secret, bot.name).split(' · ')[1]} />
        </Section>
      )}

      <Section footer={isNew ? `The name is what ${bot.name} calls it: lower-case letters, digits and “-”.` : undefined}>
        {isNew && <Field label="Name" value={name} placeholder="plausible" onChange={setName} autoCapitalize="none" maxLength={40} />}
        <Field label="What it is" value={what} placeholder="Plausible API key" onChange={setWhat} autoCapitalize="sentences" maxLength={120} />
      </Section>

      <Section footer="The site it is for, exactly as its address names it. It is sent nowhere else. Separate several with commas.">
        <Field label="Sent only to" value={sites} placeholder="plausible.io" onChange={setSites} autoCapitalize="none" keyboardType="url" />
      </Section>

      <Section footer={`${secret ? 'Leave it empty to keep the value it has. ' : ''}${howKept(data?.kept ?? null)} A value is read back only on that computer.`}>
        <Field label={secret ? 'New value' : 'Value'} value={value} placeholder={secret ? 'Unchanged' : 'Paste or type it'} onChange={setValue} autoCapitalize="none" secure />
      </Section>

      {secret && (
        <Section>
          <Row label="Remove secret" tone="destructive" disabled={busy} onPress={remove} />
        </Section>
      )}
    </SettingsPage>
  )
}
