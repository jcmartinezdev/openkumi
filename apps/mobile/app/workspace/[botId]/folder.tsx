// One folder of a bot's workspace: its folders, then its files, each opening to its own screen.
import { useLocalSearchParams } from 'expo-router'
import { useChanges, useFiles, useStore } from '@openkumi/client/store'
import { childrenOf, isRecorded, nameOf } from '@openkumi/client/workspace'
import { ICON_INSET, Row, Section, SettingsPage } from '../../../src/SettingsUi'
import { FileRow } from '../../../src/Workspace'

export default function Folder() {
  const { botId, path } = useLocalSearchParams<{ botId: string; path: string }>()
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const { entries } = useFiles(botId)
  const { data } = useChanges(botId)
  if (!bot) return null
  const inside = childrenOf(entries ?? [], path)
  return (
    <SettingsPage title={nameOf(path)} subtitle={`${bot.name}’s workspace`}>
      <Section inset={ICON_INSET} footer={isRecorded(path) ? undefined : 'Changes to working files are not recorded.'}>
        {inside.map(({ entry, count }) => <FileRow key={entry.path} botId={bot.id} botName={bot.name} entry={entry} count={count} changes={data?.changes ?? []} />)}
        {entries && !inside.length && <Row label="Nothing here yet" />}
      </Section>
    </SettingsPage>
  )
}
