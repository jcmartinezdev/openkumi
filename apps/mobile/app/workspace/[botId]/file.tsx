// One file of a bot's workspace, opened to read: Markdown drawn as in a conversation, other text as
// it is, pictures as pictures. Edit in the bar turns it into a field; Save writes it back. Above it,
// who changed it last (for the instructions and memory, which are recorded) or that it is a working
// file, whose changes are not. "edit" opens it ready to write, as a new note does.
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Stack, useLocalSearchParams, usePreventRemove, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import { sizeOf } from '@openkumi/client/attachments'
import { api, useChanges, useFiles, useServerFile, useStore } from '@openkumi/client/store'
import { INSTRUCTIONS, authorOf, fileUrl, folderOf, isRecorded, kindOfFile, lastChange, nameOf, since } from '@openkumi/client/workspace'
import { Glyph } from '../../../src/icons'
import { FileLinks, Markdown } from '../../../src/Markdown'
import { ScreenTitle } from '../../../src/ScreenTitle'
import { useTheme } from '../../../src/theme'

interface OpenFile {
  path: string
  content: string
  binary: boolean
  size: number
}

export default function FileScreen() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { botId, path, edit } = useLocalSearchParams<{ botId: string; path: string; edit?: string }>()
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const version = useStore((s) => s.filesVersion[botId] ?? 0)
  // Above this the bot's instructions are cut off when they are loaded.
  const limit = useStore((s) => s.settings.instructionsLimit)
  const { entries } = useFiles(botId)
  const { data } = useChanges(botId)
  const picture = useServerFile(`${fileUrl(botId, path)}&download=1`)
  const [file, setFile] = useState<OpenFile | null>(null)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(edit === '1')
  const [busy, setBusy] = useState(false)
  const [shape, setShape] = useState(1)
  /** Set once leaving is meant: after Discard, or once the file is deleted. */
  const [leaving, setLeaving] = useState(false)
  const dirty = editing && !!file && draft !== file.content
  const unsaved = useRef(false)
  unsaved.current = dirty

  // The file follows the bot's own edits, unless the owner is in the middle of changing it.
  useEffect(() => {
    if (unsaved.current) return
    let current = true
    api<OpenFile>('GET', fileUrl(botId, path)).then(
      (f) => current && (setFile(f), setDraft(f.content), setError('')),
      (e) => current && setError((e as Error).message),
    )
    return () => {
      current = false
    }
  }, [botId, path, version])

  usePreventRemove(dirty && !leaving, ({ repeat }) =>
    Alert.alert('Discard your changes?', `What you changed in ${nameOf(path)} is not saved.`, [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => (setLeaving(true), repeat()) },
    ]),
  )
  useEffect(() => void (leaving && !dirty && router.back()), [leaving])

  if (!bot) return null
  const kind = kindOfFile(path)
  const text = !!file && !file.binary
  const entry = entries?.find((e) => e.path === path)
  const last = isRecorded(path) ? lastChange(data?.changes ?? [], path) : undefined

  const save = async () => {
    setBusy(true)
    try {
      await api('PUT', fileUrl(bot.id, path), { content: draft })
      setFile((f) => f && { ...f, content: draft })
      setEditing(false)
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e) {
      Alert.alert('Not saved', (e as Error).message)
    }
    setBusy(false)
  }
  const remove = () =>
    Alert.alert(`Delete ${nameOf(path)}?`, isRecorded(path) ? 'It can be brought back from its changes.' : 'Working files are not recorded, so it cannot be brought back.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void api('DELETE', fileUrl(bot.id, path)).then(() => (setEditing(false), setLeaving(true)), (e) => Alert.alert('Not deleted', (e as Error).message)),
      },
    ])
  const openLinked = (linked: string) => router.push({ pathname: '/workspace/[botId]/file', params: { botId: bot.id, path: linked } })

  return (
    <>
      <ScreenTitle title={nameOf(path)} subtitle={`${folderOf(path) || 'workspace'} · ${bot.name}`} buttons={2} />
      <Stack.Toolbar placement="right">
        {text &&
          (editing ? (
            <Stack.Toolbar.Button variant="done" disabled={busy} onPress={dirty ? save : () => setEditing(false)}>{dirty ? 'Save' : 'Done'}</Stack.Toolbar.Button>
          ) : (
            <Stack.Toolbar.Button onPress={() => setEditing(true)}>Edit</Stack.Toolbar.Button>
          ))}
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
          {isRecorded(path) && (
            <Stack.Toolbar.MenuAction icon="clock.arrow.circlepath" onPress={() => router.push({ pathname: '/workspace/[botId]/changes', params: { botId: bot.id } })}>
              Changes
            </Stack.Toolbar.MenuAction>
          )}
          <Stack.Toolbar.MenuAction icon="trash" destructive onPress={remove}>Delete file</Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>

      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {isRecorded(path) ? (
          <Pressable
            accessibilityRole={last ? 'button' : undefined}
            disabled={!last}
            onPress={() => last && router.push({ pathname: '/workspace/[botId]/change', params: { botId: bot.id, id: last.id, message: last.message, author: last.author, time: String(last.time) } })}
            style={[styles.meta, { backgroundColor: theme.bubble }]}
          >
            <Glyph name="history" size={16} color={theme.muted} weight={1.9} />
            <Text style={[styles.metaText, { color: theme.muted }]} numberOfLines={2}>
              {last ? <><Text style={{ color: theme.text, fontWeight: '500' }}>{authorOf(last, bot.name)}</Text> changed this {since(last.time)}</> : entry ? `Changed ${since(entry.modified)}` : ' '}
            </Text>
            {last && <Text style={[styles.metaAction, { color: theme.text }]}>See change</Text>}
          </Pressable>
        ) : (
          <View style={[styles.meta, { backgroundColor: theme.bubble }]}>
            <Glyph name="file" size={16} color={theme.muted} weight={1.9} />
            <Text style={[styles.metaText, { color: theme.muted }]}>
              Working file{entry ? ` · changed ${since(entry.modified)}` : ''}{file ? ` · ${sizeOf(file.size)}` : ''}. Changes to working files are not recorded.
            </Text>
          </View>
        )}
        {path === INSTRUCTIONS && (
          <Text style={[styles.note, { color: theme.faint }]}>
            {bot.name}’s own instructions, read at the start of every conversation. It keeps this file up to date itself; you can edit it too.
            {draft.length > limit && <Text style={{ color: theme.err }}> It is {draft.length.toLocaleString()} characters long; only the first {limit.toLocaleString()} are read.</Text>}
          </Text>
        )}

        {!file ? (
          error ? <Text style={[styles.note, { color: theme.err }]}>{error}</Text> : <ActivityIndicator style={{ marginTop: 40 }} color={theme.muted} />
        ) : file.binary ? (
          kind === 'picture' && picture ? (
            <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Open ${nameOf(path)}`} onPress={() => router.push({ pathname: '/picture', params: { path: `${fileUrl(bot.id, path)}&download=1`, name: nameOf(path) } })} style={styles.picture}>
              <Image source={picture} style={{ width: '100%', aspectRatio: shape, borderRadius: 12 }} resizeMode="contain" onLoad={(e) => e.nativeEvent.source.height && setShape(e.nativeEvent.source.width / e.nativeEvent.source.height)} />
            </Pressable>
          ) : (
            <Text style={[styles.note, { color: theme.muted }]}>This file cannot be shown on the phone ({sizeOf(file.size)}). It opens on the computer, in {bot.name}’s workspace.</Text>
          )
        ) : editing ? (
          <TextInput
            accessibilityLabel={`Contents of ${nameOf(path)}`}
            style={[styles.editor, { color: theme.text }, kind === 'text' || kind === 'table' ? styles.mono : null]}
            value={draft}
            onChangeText={setDraft}
            multiline
            autoFocus
            scrollEnabled={false}
            autoCapitalize="sentences"
            placeholder="Write here"
            placeholderTextColor={theme.faint}
          />
        ) : kind === 'markdown' || kind === 'instructions' ? (
          <View style={styles.read}>
            <FileLinks.Provider value={openLinked}>
              <Markdown text={draft} />
            </FileLinks.Provider>
            {!draft.trim() && <Text style={{ color: theme.faint, fontSize: 15 }}>This file is empty. Tap Edit to write something.</Text>}
          </View>
        ) : (
          <Text selectable style={[styles.read, styles.mono, { color: theme.text }]}>{draft}</Text>
        )}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  metaText: { flex: 1, fontSize: 13.5, lineHeight: 18 },
  metaAction: { fontSize: 13.5, fontWeight: '600' },
  note: { marginHorizontal: 20, marginTop: 12, fontSize: 13.5, lineHeight: 19 },
  read: { paddingHorizontal: 20, paddingTop: 12 },
  editor: { minHeight: 320, paddingHorizontal: 20, paddingTop: 14, fontSize: 16.5, lineHeight: 23, textAlignVertical: 'top' },
  mono: { fontFamily: 'Menlo', fontSize: 13.5, lineHeight: 20 },
  picture: { margin: 16 },
})
