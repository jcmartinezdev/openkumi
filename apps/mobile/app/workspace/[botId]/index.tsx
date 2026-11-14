// A bot's workspace, as the computer's Workspace tab is on the phone: what changed last, then the
// bot's instructions, its memory and its working files, each opening to a screen of its own. The
// newest notes and the top of files/ are shown here; the rest are a tap away.
import { useState } from 'react'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useChanges, useFiles, useStore } from '@openkumi/client/store'
import { INSTRUCTIONS, authorOf, childrenOf, findFiles, since, summarize } from '@openkumi/client/workspace'
import { ICON_INSET, Note, Row, Section, SettingsPage } from '../../../src/SettingsUi'
import { FileRow, SearchField, useAdd } from '../../../src/Workspace'

/** How many notes and working files are shown before "All …". */
const SHOWN = 3

export default function Workspace() {
  const router = useRouter()
  const { botId } = useLocalSearchParams<{ botId: string }>()
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const { entries, error } = useFiles(botId)
  const { data } = useChanges(botId)
  const { newNote, addFile } = useAdd(botId)
  const [query, setQuery] = useState('')
  if (!bot) return null

  const changes = data?.changes ?? []
  const summary = summarize(entries ?? [])
  const instructions = entries?.find((e) => e.path === INSTRUCTIONS)
  // The notes most recently changed first.
  const notes = (entries ?? []).filter((e) => !e.dir && e.path.startsWith('memory/')).sort((a, b) => b.modified - a.modified)
  const working = childrenOf(entries ?? [], 'files')
  const latest = changes[0]
  const found = query.trim() ? findFiles(entries ?? [], query) : null
  const row = (entry: (typeof notes)[number], count?: number, detail?: string) => <FileRow key={entry.path} botId={bot.id} botName={bot.name} entry={entry} count={count} changes={changes} detail={detail} />

  return (
    <SettingsPage title="Workspace" subtitle={bot.name} buttons={1}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="plus" accessibilityLabel="Add">
          <Stack.Toolbar.MenuAction icon="square.and.pencil" subtitle="A note in its memory" onPress={newNote}>New note</Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction icon="square.and.arrow.down" subtitle="From Photos, the camera or Files" onPress={addFile}>Add a file</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <SearchField value={query} onChange={setQuery} />
      {!!error && !entries && <Note tone="error">{error}</Note>}

      {found ? (
        found.length ? <Section inset={ICON_INSET}>{found.map((entry) => row(entry, 0, entry.path))}</Section> : <Note>No file is called that.</Note>
      ) : (
        <>
          <Section inset={ICON_INSET}>
            <Row
              icon="history"
              label="Changes"
              detail={
                data && !data.available ? 'Not recorded: git is missing on the computer'
                : latest ? `${authorOf(latest, bot.name)} · ${latest.message} · ${since(latest.time)}`
                : data ? 'Nothing has changed yet'
                : undefined
              }
              opens
              onPress={() => router.push({ pathname: '/workspace/[botId]/changes', params: { botId: bot.id } })}
            />
          </Section>

          {instructions && <Section title="Instructions" inset={ICON_INSET}>{row(instructions, 0, 'Its own instructions, read in every conversation')}</Section>}

          <Section title="Memory" inset={ICON_INSET}>
            {notes.slice(0, SHOWN).map((entry) => row(entry))}
            {notes.length > SHOWN && <Row label={`All ${summary.notes} notes`} tone="action" opens onPress={() => router.push({ pathname: '/workspace/[botId]/folder', params: { botId: bot.id, path: 'memory' } })} />}
            {entries && !notes.length && <Row label="No notes yet" detail={`${bot.name} writes down here what it learns.`} />}
          </Section>

          <Section title="Working files" inset={ICON_INSET} footer="Changes to working files are not recorded.">
            {working.slice(0, SHOWN + 1).map(({ entry, count }) => row(entry, count))}
            {working.length > SHOWN + 1 && <Row label={`All ${summary.working} working files`} tone="action" opens onPress={() => router.push({ pathname: '/workspace/[botId]/folder', params: { botId: bot.id, path: 'files' } })} />}
            {entries && !working.length && <Row label="No working files yet" detail="What the bot makes, and the files you send it, go here." />}
          </Section>
        </>
      )}
    </SettingsPage>
  )
}
