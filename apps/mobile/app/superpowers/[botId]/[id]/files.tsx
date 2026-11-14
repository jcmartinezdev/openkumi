// The files a superpower gives a bot to read, when it gives more than one: its instructions first,
// each opening to read. None of them can be changed.
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useStore } from '@openkumi/client/store'
import { ICON_INSET, Row, Section, SettingsPage } from '../../../../src/SettingsUi'

export default function SkillFiles() {
  const router = useRouter()
  const { botId, id } = useLocalSearchParams<{ botId: string; id: string }>()
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
