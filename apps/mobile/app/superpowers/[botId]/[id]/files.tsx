// The files a superpower gives a bot to read, when it gives more than one: its instructions first,
// each opening to read. None of them can be changed.
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useBotId } from '@openkumi/client/bots'
import { useStore } from '@openkumi/client/store'
import { ICON_INSET, Row, Section, SettingsPage } from '../../../../src/SettingsUi'

export default function SkillFiles() {
  const router = useRouter()
  const { botId: given, id } = useLocalSearchParams<{ botId: string; id: string }>()
  // Its id may change while this is open: the screen goes on with the bot.
  const botId = useBotId(given)
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const power = useStore((s) => s.superpowers.find((p) => p.id === id))
  if (!bot || !power) return null
  return (
    <SettingsPage title="The skill" subtitle={`Read-only · ${power.name}`}>
      <Section inset={ICON_INSET}>
        {power.files.map((path, i) => (
          <Row
            key={path}
            icon="file"
            label={path}
            detail={i === 0 ? `What ${bot.name} follows when a task calls for it` : undefined}
            opens
            onPress={() => router.push({ pathname: '/superpowers/[botId]/[id]/file', params: { botId: bot.id, id: power.id, path } })}
          />
        ))}
      </Section>
    </SettingsPage>
  )
}
