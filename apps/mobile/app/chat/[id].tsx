// A bot's conversation (or the thread of one of its subagents): what was said, what the bot did,
// its reply as it is written, and a place to answer.
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ActionSheetIOS, ActivityIndicator, Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { LegendList, type LegendListRef } from '@legendapp/list/react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Attachment, Item } from '@openkumi/shared'
import { MAX, addFiles, ready, removeFile, sent, usePending } from '@openkumi/client/attachments'
import { runBrief } from '@openkumi/client/automations'
import { describe } from '@openkumi/client/steps'
import { api, loadOlder, loadThread, mainThread, openThread, recentSubagents, useStore } from '@openkumi/client/store'
import { SentFiles, Tray, chooseFiles } from '../../src/Attachments'
import { Glyph } from '../../src/icons'
import { FileLinks, Markdown, copy } from '../../src/Markdown'
import { BrowserPip } from '../../src/BrowserPip'
import { ModelChip } from '../../src/ModelChip'
import { PageSheet, PageView, Sheet } from '../../src/PageView'
import { useTextScale } from '../../src/prefs'
import { ScreenTitle } from '../../src/ScreenTitle'
import { type Theme, useTheme } from '../../src/theme'
import { Bobbing, BotHead, Mascot } from '../../src/Mascot'

/** What one line of the chat shows. Tool results and the bot's private reasoning are left out on a phone. */
type Row =
  | { key: string; kind: 'user' | 'bot' | 'notice'; text: string; error?: boolean; attachments?: Attachment[]; threadId?: string }
  /** What the bot did between two messages, folded into one line. */
  | { key: string; kind: 'steps'; steps: string[] }
  | { key: string; kind: 'page'; title: string; html: string; height: number }

/** Who a message the user did not write is from. */
/** A run's first message as a notice shows it: the prompt, then what its watch found changed. */
const brief = (text: string) => {
  const { prompt, change } = runBrief(text)
  return change ? `${prompt}\n\n${change}` : prompt
}
const FROM = { parent: 'From the chat above', subagent: 'From a subagent', trigger: 'Automation', automation: 'From an automation' }

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
    if (d.type === 'message') out.push(d.role === 'assistant' ? { key, kind: 'bot', text: d.text } : d.source === 'user' ? { key, kind: 'user', text: d.text, attachments: d.attachments, threadId: item.threadId } : { key, kind: 'notice', text: `${FROM[d.source]}: ${d.source === 'trigger' ? brief(d.text) : d.text}` })
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

/** Shows a text file that was sent, by its name, in the sheet the chat opens files in. */
const ShowText = createContext<(name: string, text: string) => void>(() => {})

/** What the owner said: the files they sent, then their words. */
function Said({ row, theme, scale }: { row: Row & { kind: 'user' }; theme: Theme; scale: number }) {
  const show = useContext(ShowText)
  return (
    <View style={styles.said}>
      {!!row.attachments?.length && <SentFiles threadId={row.threadId!} files={row.attachments} show={show} />}
      {!!row.text && (
        <Pressable onLongPress={() => offerCopy(row.text)} style={[styles.user, { backgroundColor: theme.bubble }]}>
          <Text style={{ color: theme.text, fontSize: 16 * scale, lineHeight: 22 * scale }}>{row.text}</Text>
        </Pressable>
      )}
    </View>
  )
}

const Line = memo(function Line({ row, theme, scale }: { row: Row; theme: Theme; scale: number }) {
  if (row.kind === 'user') return <Said row={row as Row & { kind: 'user' }} theme={theme} scale={scale} />
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
  const older = useStore((s) => (thread ? !!s.older[thread.id] : false))
  const partial = useStore((s) => (thread ? s.partial[thread.id] : undefined))
  const connected = useStore((s) => s.connected)
  const threads = useStore((s) => s.threads)
  const automation = useStore((s) => (thread?.automationId ? s.automations.find((a) => a.id === thread.automationId) : undefined))
  const scale = useTextScale()
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const list = useRef<LegendListRef>(null)
  const keyboard = useKeyboardUp()

  useEffect(() => {
    // Shows what is kept of the chat at once, then brings it up to date; again when the connection comes back.
    if (thread) openThread(thread.id).then(() => setError(''), (e) => setError(e.message))
  }, [thread?.id, connected])
  // A subagent or run older than what the list holds is fetched, which puts it in the list.
  useEffect(() => {
    if (!forBot && !thread && connected) loadThread(id).catch((e) => setError(e.message))
  }, [id, !!thread, connected])

  // Earlier messages are fetched a page at a time as the reader nears the top; the list keeps what
  // was on screen in its place while they are put in above.
  const [fetchingOlder, setFetchingOlder] = useState(false)
  const fetching = useRef(false)
  const showOlder = () => {
    if (!thread || !older || fetching.current) return
    fetching.current = true
    setFetchingOlder(true)
    loadOlder(thread.id)
      .catch((e) => setError(e.message))
      .finally(() => ((fetching.current = false), setFetchingOlder(false)))
  }

  const shown = useMemo(() => rows(items ?? []), [items])
  const running = thread?.status === 'running'
  const subagents = thread ? recentSubagents(threads, thread) : []

  // A reply's link to one of the bot's files: a page opens as one, Markdown and other text are shown as they are.
  const [file, setFile] = useState<{ path: string; content: string } | null>(null)
  const openFile = (path: string) => {
    if (!bot) return
    api<{ content: string; binary: boolean }>('GET', `/api/bots/${bot.id}/file?path=${encodeURIComponent(path)}`).then(
      (found) => (found.binary ? Alert.alert(path, 'This file can be opened in OpenKumi on the computer, under the bot’s files.') : setFile({ path, content: found.content })),
      (e) => Alert.alert(path, (e as Error).message),
    )
  }
  const showText = useMemo(() => (name: string, content: string) => setFile({ path: name, content }), [])
  const fileName = file?.path.split('/').pop() ?? ''
  const parent = thread?.parentId ? threads.find((t) => t.id === thread.parentId) : undefined

  // Files to send with the message, each on its way to the server from when it is picked. Kept per conversation, like on the computer.
  const files = usePending(id)
  const uploading = !ready(files)
  const sendable = files.some((f) => f.staged)

  const send = async () => {
    const message = text.trim()
    // The files go once they are all on the server; any that failed stay behind in the composer.
    const going = files.filter((f) => f.staged)
    if ((!message && !going.length) || uploading || !bot || !connected) return
    setError('')
    setSending(true)
    try {
      await api('POST', forBot ? `/api/bots/${forBot}/messages` : `/api/threads/${thread!.id}/messages`, { text: message, attachments: going.map((f) => f.staged) })
      setText('')
      sent(id, going.map((f) => f.id))
      void list.current?.scrollToEnd({ animated: true })
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
      {running && !partial?.text && <View style={styles.working}>{bot ? <Bobbing><BotHead bot={bot} size={24} sign={false} /></Bobbing> : <ActivityIndicator size="small" color={theme.muted} />}<Text style={{ color: theme.muted, fontSize: 14 }}>Working</Text></View>}
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
        <ShowText.Provider value={showText}>
        <LegendList
          ref={list}
          data={shown}
          keyExtractor={(row) => row.key}
          renderItem={({ item }) => <Line row={item} theme={theme} scale={scale} />}
          extraData={scale}
          estimatedItemSize={64}
          // Lines differ too much (pages, tables, a word or two) to be drawn into one another's places.
          recycleItems={false}
          // Opens at the newest line, and stays there as the reply is written, the keyboard comes up or
          // more arrives, until the reader scrolls away from it.
          initialScrollAtEnd
          maintainScrollAtEnd
          maintainVisibleContentPosition={{ data: true }}
          onStartReached={showOlder}
          ListHeaderComponent={
            older ? (
              <View style={styles.older}>{fetchingOlder ? <ActivityIndicator size="small" color={theme.muted} /> : <Pressable accessibilityRole="button" hitSlop={8} onPress={showOlder}><Text style={{ color: theme.faint, fontSize: 13 }}>Show earlier messages</Text></Pressable>}</View>
            ) : // A run leads back to its automation, as on the computer.
            automation ? (
              <Pressable accessibilityRole="link" hitSlop={6} onPress={() => router.push({ pathname: '/automations/[id]', params: { id: automation.id } })}>
                <Text style={[styles.notice, { color: theme.faint }]}>A run of the automation <Text style={{ color: theme.text, textDecorationLine: 'underline' }}>{automation.title}</Text></Text>
              </Pressable>
            ) : parent ? <Text style={[styles.notice, { color: theme.faint }]}>{thread?.kind === 'automation' ? 'A run of an automation' : parent.parentId ? `A subagent of “${parent.title}”` : 'A subagent of this bot’s conversation'}</Text> : undefined
          }
          ListFooterComponent={tail}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12 }}
          keyboardDismissMode="interactive"
        />
        </ShowText.Provider>
        </FileLinks.Provider>
      )}
      {/* The bot's browser, small, while one of its threads browses. */}
      {bot && (
        <BrowserPip
          botId={bot.id}
          open={(threadId, take) => router.push({ pathname: '/browser/[botId]', params: { botId: bot.id, threadId, ...(take ? { take: '1' } : {}) } })}
        />
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
          <Tray files={files} remove={(file) => removeFile(id, file)} />
          <TextInput
            accessibilityLabel="Message"
            style={[styles.input, { color: theme.text }]}
            value={text}
            onChangeText={setText}
            placeholder={!connected ? 'Offline. You can send once the connection is back.' : thread?.kind === 'subagent' ? 'Message this subagent' : bot ? `Message ${bot.name}` : 'Message'}
            placeholderTextColor={theme.faint}
            multiline
          />
          <View style={styles.bar}>
            {bot && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add photos and files"
                hitSlop={6}
                style={({ pressed }) => [styles.attach, { borderColor: theme.border }, pressed && { backgroundColor: theme.bubble }]}
                onPress={() => chooseFiles(MAX - files.length, (picked) => addFiles(id, bot.id, picked))}
              >
                <Glyph name="plus" size={18} color={theme.text} weight={2} />
              </Pressable>
            )}
            <View style={{ flex: 1 }} />
            {bot && <ModelChip bot={bot} onPress={() => (Keyboard.dismiss(), router.push({ pathname: '/model/[botId]', params: { botId: bot.id } }))} />}
            {running ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Stop" style={[styles.send, { backgroundColor: theme.bubble }]} onPress={() => api('POST', `/api/threads/${thread!.id}/stop`).catch((e) => setError(e.message))}>
                <View style={{ width: 12, height: 12, borderRadius: 2.5, backgroundColor: theme.text }} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={!connected ? 'Send, once the connection is back' : uploading ? 'Send, once the files are added' : 'Send'}
                disabled={sending || uploading || !connected || (!text.trim() && !sendable)}
                style={[styles.send, { backgroundColor: theme.primary, opacity: sending || uploading || !connected || (!text.trim() && !sendable) ? 0.35 : 1 }]}
                onPress={send}
              >
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
  older: { alignItems: 'center', justifyContent: 'center', minHeight: 32 },
  said: { alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '86%', marginVertical: 6, gap: 6 },
  user: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18 },
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
  attach: { width: 36, height: 36, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
})
