// The recorded changes to a bot's instructions and memory, by day, newest first, as the computer's
// Changes view lists them. Each opens to what it changed, with a way to undo it.
import { Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useChanges, useStore } from '@openkumi/client/store'
import { byDay, clockOf } from '@openkumi/client/workspace'
import { Note, Row, Section, SettingsPage } from '../../../src/SettingsUi'
import { useTheme } from '../../../src/theme'
import { Author } from '../../../src/Workspace'

const FOOTER = 'Changes to its instructions and memory are recorded here, and each can be undone. Changes to working files are not recorded.'

export default function Changes() {
  const theme = useTheme()
  const router = useRouter()
  const { botId } = useLocalSearchParams<{ botId: string }>()
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const { data, error, showOlder } = useChanges(botId)
  if (!bot) return null
  const days = byDay(data?.changes ?? [])
  return (
    <SettingsPage title="Changes" subtitle={`${bot.name}’s workspace`}>
      {!!error && !data && <Note tone="error">{error}</Note>}
      {data && !data.available && <Note>Changes need git, which was not found on the computer running OpenKumi. Install git there and restart OpenKumi to record them.</Note>}
      {!!data?.problem && <Note tone="error">Changes are not being recorded right now: {data.problem}</Note>}
      {days.map(({ day, changes }, i) => (
        <Section key={day} title={day} footer={i === days.length - 1 ? FOOTER : undefined}>
          {changes.map((change) => (
            <Row
              key={change.id}
              label={change.message}
              detail={
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Author change={change} botName={bot.name} />
                  <Text style={{ color: theme.faint, fontSize: 13.5 }}>{clockOf(change.time)}</Text>
                </View>
              }
              opens
              onPress={() => router.push({ pathname: '/workspace/[botId]/change', params: { botId: bot.id, id: change.id, message: change.message, author: change.author, time: String(change.time) } })}
            />
          ))}
          {i === days.length - 1 && data?.more && <Row label="Show older changes" tone="action" onPress={showOlder} />}
        </Section>
      ))}
      {data?.available && !days.length && <Note>Nothing has changed yet. {FOOTER}</Note>}
    </SettingsPage>
  )
}
