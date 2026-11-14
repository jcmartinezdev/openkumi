// What the screens of a bot's workspace share: a row for a file or folder, the search field, who
// made a change, and adding a note or a file from the phone.
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { FileEntry, HistoryEntry } from '@openkumi/shared'
import { sizeOf } from '@openkumi/client/attachments'
import { api, request } from '@openkumi/client/store'
import { fileUrl, isRecorded, kindOfFile, lastChange, nameOf, since, authorOf } from '@openkumi/client/workspace'
import { chooseFiles } from './Attachments'
import { Glyph, type GlyphName } from './icons'
import { Row } from './SettingsUi'
import { useTheme } from './theme'

const ICONS: Record<ReturnType<typeof kindOfFile>, GlyphName> = { instructions: 'book', markdown: 'file', picture: 'image', table: 'table', text: 'file' }

/**
 * A file or folder, opening to its own screen. A file says who changed it last and when, from the
 * recorded changes, or for a working file only when; a folder says how many files are in it.
 */
export function FileRow({ botId, botName, entry, count = 0, changes, detail }: { botId: string; botName: string; entry: FileEntry; count?: number; changes: HistoryEntry[]; detail?: string }) {
  const router = useRouter()
  if (entry.dir) {
    const said = entry.path === 'files/inbox' ? `${count} ${count === 1 ? 'file' : 'files'} you sent` : `${count} ${count === 1 ? 'file' : 'files'}`
    return (
      <Row
        icon={entry.path === 'files/inbox' ? 'inbox' : 'folder'}
        label={nameOf(entry.path)}
        detail={detail ?? said}
        opens
        onPress={() => router.push({ pathname: '/workspace/[botId]/folder', params: { botId, path: entry.path } })}
      />
    )
  }
  const last = isRecorded(entry.path) ? lastChange(changes, entry.path) : undefined
  const said = last ? `${authorOf(last, botName)} · ${since(last.time)}` : `${sizeOf(entry.size)} · ${since(entry.modified)}`
  return (
    <Row icon={ICONS[kindOfFile(entry.path)]} label={nameOf(entry.path)} detail={detail ?? said} opens onPress={() => router.push({ pathname: '/workspace/[botId]/file', params: { botId, path: entry.path } })} />
  )
}

/** Finds files by name as it is typed. */
export function SearchField({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const theme = useTheme()
  return (
    <View style={[styles.search, { backgroundColor: theme.bubble }]}>
      <Glyph name="search" size={17} color={theme.faint} weight={2} />
      <TextInput
        accessibilityLabel="Find a file"
        style={[styles.searchInput, { color: theme.text }]}
        value={value}
        onChangeText={onChange}
        placeholder="Find a file"
        placeholderTextColor={theme.faint}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
    </View>
  )
}

/** Who made a change: the bot stands out from you and from OpenKumi itself. */
export function Author({ change, botName }: { change: HistoryEntry; botName: string }) {
  const theme = useTheme()
  const bot = change.author === 'bot'
  return (
    <Text style={[styles.tag, { color: bot ? theme.run : theme.muted, backgroundColor: bot ? `${theme.run}26` : theme.bubble }]}>{authorOf(change, botName)}</Text>
  )
}

/** Adding to a bot's workspace from the phone: a new note in memory/, or files from Photos, the camera or Files into files/. */
export function useAdd(botId: string) {
  const router = useRouter()
  const newNote = () =>
    Alert.prompt('New note', 'A note in the bot’s memory. What is it about?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Create',
        onPress: (name?: string) => {
          const title = (name ?? '').trim().replace(/[/\\]/g, '-')
          if (!title) return
          const path = `memory/${/\.(md|markdown|txt)$/i.test(title) ? title : `${title}.md`}`
          api<{ content: string }>('GET', fileUrl(botId, path)).then(
            () => Alert.alert(`${nameOf(path)} is there already`, 'Give the note another name, or open that one.'),
            () =>
              api('PUT', fileUrl(botId, path), { content: '' }).then(
                () => router.push({ pathname: '/workspace/[botId]/file', params: { botId, path, edit: '1' } }),
                (e) => Alert.alert('The note was not made', (e as Error).message),
              ),
          )
        },
      },
    ])
  const addFile = () =>
    chooseFiles(10, (picked) => {
      for (const file of picked) {
        void (async () => {
          try {
            const { body, name } = await file.read()
            await request('POST', `/api/bots/${encodeURIComponent(botId)}/upload?name=${encodeURIComponent(name)}`, body)
          } catch (e) {
            Alert.alert(`${file.name} was not added`, (e as Error).message)
          }
        })()
      }
    })
  return { newNote, addFile }
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 12, borderRadius: 12 },
  searchInput: { flex: 1, height: 40, fontSize: 16.5 },
  tag: { fontSize: 11.5, fontWeight: '600', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: 'hidden' },
})
