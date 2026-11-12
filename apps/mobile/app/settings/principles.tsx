// What every bot is told before anything else: the computer's Settings › Principles. What each bot
// is for, which the others are told, is in that bot's own settings.
import { Alert } from 'react-native'
import { savePrinciples, useStore } from '@openbot/client/store'
import { useSession } from '../../src/session'
import { Field, Row, Section, SettingsPage } from '../../src/SettingsUi'

export default function PrinciplesSettings() {
  const { server } = useSession()
  const principles = useStore((s) => s.principles)
  const save = (text: string | null) => savePrinciples(text).catch((e) => Alert.alert('Not saved', (e as Error).message))
  const restore = () =>
    Alert.alert('Put back the principles Open Bot comes with?', 'Yours are replaced.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', style: 'destructive', onPress: () => void save(null) },
    ])

  return (
    <SettingsPage title="Principles" subtitle={server?.name}>
      <Section footer="What every bot is told before anything else: how to behave, and how to work with the other bots. After these, each bot follows its own rules from you and the instructions it writes itself. Bots cannot change them.">
        <Field label="Principles" multiline value={principles?.text ?? ''} placeholder="Nothing: bots are told no principles." onCommit={(text) => void save(text)} />
      </Section>
      {principles?.custom && (
        <Section footer="These are your own. Open Bot comes with principles of its own, which this puts back.">
          <Row label="Restore default" tone="action" onPress={restore} />
        </Section>
      )}
    </SettingsPage>
  )
}
