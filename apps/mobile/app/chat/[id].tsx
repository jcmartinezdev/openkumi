// A bot's conversation (or the thread of one of its subagents): what was said, what the bot did,
// its reply as it is written, and a place to answer.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Item } from '@openbot/shared'
import { describe } from '@openbot/client/steps'
import { api, loadThread, mainThread, recentSubagents, useStore } from '@openbot/client/store'
import { Glyph } from '../../src/icons'
import { FileLinks, Markdown, copy } from '../../src/Markdown'
import { ModelChip } from '../../src/ModelChip'
import { PageSheet, PageView, Sheet } from '../../src/PageView'
import { useTextScale } from '../../src/prefs'
import { ScreenTitle } from '../../src/ScreenTitle'
import { type Theme, useTheme } from '../../src/theme'
import { Bobbing, BotHead, Mascot } from '../../src/Mascot'

/** What one line of the chat shows. Tool results and the bot's private reasoning are left out on a phone. */
type Row =
  | { key: string; kind: 'user' | 'bot' | 'notice'; text: string; error?: boolean }
  /** What the bot did between two messages, folded into one line. */
  | { key: string; kind: 'steps'; steps: string[] }
  | { key: string; kind: 'page'; title: string; html: string; height: number }

/** Who a message the user did not write is from. */
const FROM = { parent: 'From the chat above', subagent: 'From a subagent', schedule: 'Scheduled task', task: 'From a scheduled task' }

function rows(items: Item[]): Row[] {
  const failed = new Set(items.flatMap(({ data: d }) => (d.type === 'function_call_output' && d.output.startsWith('Error:') ? [d.call_id] : [])))
  const out: Row[] = []
  const step = (key: string, text: string) => {
    const last = out.at(-1)
    if (last?.kind === 'steps') last.steps.push(text)
    else out.push({ key, kind: 'steps', steps: [text] })
  }
  for (const item of items) {
    const d = item.data
    const key = String(item.id)
    if (d.type === 'message') out.push(d.role === 'assistant' ? { key, kind: 'bot', text: d.text } : d.source === 'user' ? { key, kind: 'user', text: d.text } : { key, kind: 'notice', text: `${FROM[d.source]}: ${d.text}` })
    // A page stands for the call that showed it; the call is only listed when it failed.
    else if (d.type === 'function_call' && (d.name !== 'show_page' || failed.has(d.call_id))) step(key, describe(d))
    else if (d.type === 'web_search_call') step(key, 'Search the web')
    else if (d.type === 'page') out.push({ key, kind: 'page', title: d.title, html: d.html, height: d.height })
    else if (d.type === 'notice') out.push({ key, kind: 'notice', text: d.text, error: d.level === 'error' })
    else if (d.type === 'summary') out.push({ key, kind: 'notice', text: 'The conversation has grown long: the bot now works from a summary of its older part.' })
  }
  return out
}

/** Long press on one of the user's messages: copy it. */
const offerCopy = (text: string) =>
  ActionSheetIOS.showActionSheetWithOptions({ options: ['Copy', 'Cancel'], cancelButtonIndex: 1 }, (choice) => {
    if (choice === 0) void copy(text)
  })

function Steps({ steps, theme }: { steps: string[]; theme: Theme }) {
  const [open, setOpen] = useState(false)
  if (steps.length === 1) return <Text style={[styles.step, { color: theme.muted }]} numberOfLines={1}>· {steps[0]}</Text>
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}>
      <Text style={[styles.step, { color: theme.muted }]} numberOfLines={1}>
        · {steps.length} steps{open ? '' : ` — ${steps.at(-1)}`} <Text style={{ color: theme.faint }}>{open ? '⌃' : '⌄'}</Text>
      </Text>
      {open && steps.map((text, i) => <Text key={i} style={[styles.step, styles.inner, { color: theme.muted, borderLeftColor: theme.border }]} numberOfLines={2}>{text}</Text>)}
    </Pressable>
  )
}

/** Under a reply: copy it. A reply is not pressable itself, which would stop its tables and code from scrolling sideways. */
function CopyReply({ text, theme }: { text: string; theme: Theme }) {
  const [copied, setCopied] = useState(false)
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Copy reply" hitSlop={10} style={styles.copy} onPress={() => copy(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
      <Text style={{ color: theme.faint, fontSize: 13 }}>{copied ? 'Copied' : 'Copy'}</Text>
    </Pressable>
  )
}

/** Whether the keyboard is up, so what sits above it can drop the room it keeps for the home indicator. */
function useKeyboardUp() {
  const [up, setUp] = useState(false)
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardWillShow', () => setUp(true))
    const hidden = Keyboard.addListener('keyboardWillHide', () => setUp(false))
    return () => (shown.remove(), hidden.remove())
  }, [])
  return up
}

const Line = memo(function Line({ row, theme, scale }: { row: Row; theme: Theme; scale: number }) {
  if (row.kind === 'user') return <Pressable onLongPress={() => offerCopy(row.text)} style={[styles.user, { backgroundColor: theme.bubble }]}><Text style={{ color: theme.text, fontSize: 16 * scale, lineHeight: 22 * scale }}>{row.text}</Text></Pressable>
  if (row.kind === 'bot') return <View style={styles.bot}><Markdown text={row.text} /><CopyReply text={row.text} theme={theme} /></View>
  if (row.kind === 'steps') return <Steps steps={row.steps} theme={theme} />
  if (row.kind === 'page') return <PageView title={row.title} html={row.html} height={row.height} />
  return <Text style={[styles.notice, { color: row.error ? theme.err : theme.faint }]}>{row.text}</Text>
})

export default function Chat() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  // "bot:<bot>" is that bot's conversation, which does not exist until its first message is sent
  // and is another thread after its owner starts fresh. Anything else is a thread, such as a subagent's.
  const forBot = id.startsWith('bot:') ? id.slice(4) : null
  const thread = useStore((s) => (forBot ? mainThread(s.threads, forBot) : s.threads.find((t) => t.id === id)))
  const bot = useStore((s) => s.bots.find((b) => b.id === (forBot ?? thread?.botId)))
  const items = useStore((s) => (thread ? s.items[thread.id] : undefined))
  const partial = useStore((s) => (thread ? s.partial[thread.id] : undefined))
  const connected = useStore((s) => s.connected)
  const threads = useStore((s) => s.threads)
  const task = useStore((s) => (thread?.taskId ? s.tasks.find((t) => t.id === thread.taskId) : undefined))
  const scale = useTextScale()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const list = useRef<FlatList<Row>>(null)
  const keyboard = useKeyboardUp()
  /** Whether the newest line is in view; if it is, the view follows what is written. */
  const following = useRef(true)

  useEffect(() => {
    // Asked again when the connection comes back, in case the chat was opened while it was away.
    if (thread && !items && connected) loadThread(thread.id).then(() => setError(''), (e) => setError(e.message))
  }, [thread?.id, items, connected])

  const shown = useMemo(() => rows(items ?? []), [items])
  const running = thread?.status === 'running'
  const subagents = thread ? recentSubagents(threads, thread) : []

  // A reply's link to one of the bot's files: a page opens as one, Markdown and other text are shown as they are.
  const [file, setFile] = useState<{ path: string; content: string } | null>(null)
  const openFile = (path: string) => {
    if (!bot) return
    api<{ content: string; binary: boolean }>('GET', `/api/bots/${bot.id}/file?path=${encodeURIComponent(path)}`).then(
      (found) => (found.binary ? Alert.alert(path, 'This file can be opened in Open Bot on the computer, under the bot’s files.') : setFile({ path, content: found.content })),
      (e) => Alert.alert(path, (e as Error).message),
    )
  }
  const fileName = file?.path.split('/').pop() ?? ''
  const parent = thread?.parentId ? threads.find((t) => t.id === thread.parentId) : undefined

  const send = async () => {
    const message = text.trim()
    if (!message || !bot) return
    setError('')
    setSending(true)
    try {
      await api('POST', forBot ? `/api/bots/${forBot}/messages` : `/api/threads/${thread!.id}/messages`, { text: message })
      setText('')
      following.current = true
    } catch (e) {
      setError((e as Error).message)
    }
    setSending(false)
  }

  // Sets the conversation so far aside (it is kept, and found again in the app on the computer) and begins an empty one.
  const startFresh = () => bot && api('POST', `/api/bots/${bot.id}/fresh`).then(() => setError(''), (e) => setError(e.message))

  const tail = (
    <View style={{ paddingBottom: 12 }}>
      {!!partial?.text && <View style={styles.bot}><Markdown text={partial.text} live /></View>}
      {running && !partial?.text && <View style={styles.working}>{bot ? <Bobbing><BotHead bot={bot} size={24} /></Bobbing> : <ActivityIndicator size="small" color={theme.muted} />}<Text style={{ color: theme.muted, fontSize: 14 }}>Working</Text></View>}
      {subagents.length > 0 && (
        <View style={styles.chips}>
          {subagents.map((t) => (
            <Pressable key={t.id} accessibilityRole="button" style={[styles.chip, { borderColor: theme.border }]} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: t.id } })}>
              {t.status === 'running' && <ActivityIndicator size="small" color={theme.run} />}
              <Text style={{ color: theme.text, fontSize: 13 }} numberOfLines={1}>{t.title}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!!error && <Text accessibilityRole="alert" style={[styles.notice, { color: theme.err }]}>{error}</Text>}
    </View>
  )

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={insets.top + 44}>
      {/* A subagent's thread says whose it is, as on the computer; a bot's conversation says when the bot is at work. */}
      <ScreenTitle title={(forBot ? bot?.name : thread?.title) ?? ''} subtitle={forBot ? (running ? 'Working…' : undefined) : bot?.name} buttons={forBot ? 2 : 1} />
      {bot && (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button icon="globe" accessibilityLabel={`${bot.name}’s browser`} onPress={() => router.push({ pathname: '/browser/[botId]', params: { botId: bot.id, threadId: thread?.id ?? '' } })} />
          {forBot && (
            <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
              <Stack.Toolbar.MenuAction icon="square.and.pencil" subtitle="Sets this conversation aside. The bot keeps what it learned." disabled={running || !items?.length} onPress={startFresh}>
                Start fresh
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction icon="gearshape" onPress={() => router.push({ pathname: '/settings/bot/[botId]', params: { botId: bot.id } })}>
                Bot settings
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
          )}
        </Stack.Toolbar>
      )}
      {bot && (!thread || items?.length === 0) ? (
        <View style={styles.empty}>
          <Mascot look={bot.look} emoji={bot.emoji} size={130} live />
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '600' }}>{bot.name}</Text>
          {bot.choosingLook && <Text style={{ color: theme.faint, fontSize: 14 }}>Choosing its look…</Text>}
        </View>
      ) : !items ? (
        <View style={styles.empty}><ActivityIndicator color={theme.muted} /></View>
      ) : (
        <FileLinks.Provider value={openFile}>
        <FlatList
          ref={list}
          data={shown}
          keyExtractor={(row) => row.key}
          renderItem={({ item }) => <Line row={item} theme={theme} scale={scale} />}
          extraData={scale}
          ListHeaderComponent={
            // A run leads back to its task, as on the computer.
            task ? (
              <Pressable accessibilityRole="link" hitSlop={6} onPress={() => router.push({ pathname: '/tasks/[id]', params: { id: task.id } })}>
                <Text style={[styles.notice, { color: theme.faint }]}>A run of the scheduled task <Text style={{ color: theme.text, textDecorationLine: 'underline' }}>{task.title}</Text></Text>
              </Pressable>
            ) : parent ? <Text style={[styles.notice, { color: theme.faint }]}>{thread?.kind === 'task' ? 'A run of a scheduled task' : parent.parentId ? `A subagent of “${parent.title}”` : 'A subagent of this bot’s conversation'}</Text> : undefined
          }
          ListFooterComponent={tail}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12 }}
          keyboardDismissMode="interactive"
          onScroll={({ nativeEvent: e }) => (following.current = e.contentOffset.y + e.layoutMeasurement.height > e.contentSize.height - 80)}
          scrollEventThrottle={100}
          onContentSizeChange={() => following.current && list.current?.scrollToEnd({ animated: false })}
          // The keyboard coming up makes the list shorter; the newest line stays in view.
          onLayout={() => following.current && list.current?.scrollToEnd({ animated: false })}
        />
        </FileLinks.Provider>
      )}
      {file && /\.html?$/i.test(file.path) && <PageSheet title={fileName} html={file.content} close={() => setFile(null)} />}
      {file && !/\.html?$/i.test(file.path) && (
        <Sheet title={fileName} visible close={() => setFile(null)}>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {/\.(md|markdown)$/i.test(file.path) ? <Markdown text={file.content} /> : <Text selectable style={{ color: theme.text, fontFamily: 'Menlo', fontSize: 13, lineHeight: 19 }}>{file.content}</Text>}
          </ScrollView>
        </Sheet>
      )}
      {/* A card with the message on top and, under it, what the bot runs on and the send button. Above the keyboard it sits close to it. */}
      <View style={[styles.dock, { paddingBottom: keyboard ? 8 : Math.max(insets.bottom, 10) }]}>
        <View style={[styles.composer, { backgroundColor: theme.raised, borderColor: theme.border }]}>
          <TextInput
            accessibilityLabel="Message"
            style={[styles.input, { color: theme.text }]}
            value={text}
            onChangeText={setText}
            placeholder={thread?.kind === 'subagent' ? 'Message this subagent' : bot ? `Message ${bot.name}` : 'Message'}
            placeholderTextColor={theme.faint}
            multiline
          />
          <View style={styles.bar}>
            {bot && <ModelChip bot={bot} onPress={() => (Keyboard.dismiss(), router.push({ pathname: '/model/[botId]', params: { botId: bot.id } }))} />}
            <View style={{ flex: 1 }} />
            {running ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Stop" style={[styles.send, { backgroundColor: theme.bubble }]} onPress={() => api('POST', `/api/threads/${thread!.id}/stop`).catch((e) => setError(e.message))}>
                <View style={{ width: 12, height: 12, borderRadius: 2.5, backgroundColor: theme.text }} />
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={sending || !text.trim()} style={[styles.send, { backgroundColor: theme.primary, opacity: sending || !text.trim() ? 0.35 : 1 }]} onPress={send}>
                <Glyph name="up" size={19} color={theme.onPrimary} weight={2.4} />
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  user: { alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, marginVertical: 6 },
  bot: { marginVertical: 4 },
  copy: { alignSelf: 'flex-start', paddingVertical: 2, marginTop: -4 },
  step: { fontSize: 13.5, paddingVertical: 3 },
  inner: { marginLeft: 4, paddingLeft: 10, borderLeftWidth: StyleSheet.hairlineWidth },
  notice: { fontSize: 13, lineHeight: 18, paddingVertical: 6 },
  working: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', height: 32, paddingHorizontal: 12, borderWidth: 1, borderRadius: 16 },
  dock: { paddingHorizontal: 10, paddingTop: 6 },
  composer: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 26 },
  input: { minHeight: 44, maxHeight: 160, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 4, fontSize: 17, lineHeight: 22 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 8, paddingBottom: 8 },
  send: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
})
