// One chat with a bot: what was said, what the bot did, its reply as it is written, and a place to answer.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Item, Thread } from '@openbot/shared'
import { describe } from '@openbot/client/steps'
import { api, loadThread, useStore } from '@openbot/client/store'
import { type Theme, useTheme } from '../../src/theme'

/** What one line of the chat shows. Tool results and the bot's private reasoning are left out on a phone. */
type Row = { key: string; kind: 'user' | 'bot' | 'step' | 'notice'; text: string; error?: boolean }

function rows(items: Item[]): Row[] {
  return items.flatMap((item): Row[] => {
    const d = item.data
    const key = String(item.id)
    if (d.type === 'message') return d.role === 'assistant' ? [{ key, kind: 'bot', text: d.text }] : [{ key, kind: d.source === 'user' ? 'user' : 'notice', text: d.source === 'user' ? d.text : `From ${d.source === 'parent' ? 'the chat above' : 'a subagent'}: ${d.text}` }]
    if (d.type === 'function_call') return [{ key, kind: 'step', text: describe(d) }]
    if (d.type === 'web_search_call') return [{ key, kind: 'step', text: 'Search the web' }]
    if (d.type === 'notice') return [{ key, kind: 'notice', text: d.text, error: d.level === 'error' }]
    return []
  })
}

const Line = memo(function Line({ row, theme }: { row: Row; theme: Theme }) {
  if (row.kind === 'user') return <View style={[styles.user, { backgroundColor: theme.bubble }]}><Text selectable style={{ color: theme.text, fontSize: 16, lineHeight: 22 }}>{row.text}</Text></View>
  if (row.kind === 'bot') return <View style={styles.bot}><Markdown style={markdown(theme)}>{row.text}</Markdown></View>
  if (row.kind === 'step') return <Text style={[styles.step, { color: theme.muted }]} numberOfLines={1}>· {row.text}</Text>
  return <Text style={[styles.notice, { color: row.error ? theme.err : theme.faint }]}>{row.text}</Text>
})

const markdown = (theme: Theme) => ({
  body: { color: theme.text, fontSize: 16, lineHeight: 23 },
  paragraph: { marginTop: 0, marginBottom: 10 },
  heading1: { fontSize: 20, fontWeight: '600' as const, marginTop: 10, marginBottom: 6 },
  heading2: { fontSize: 18, fontWeight: '600' as const, marginTop: 10, marginBottom: 6 },
  heading3: { fontSize: 16, fontWeight: '600' as const, marginTop: 8, marginBottom: 4 },
  code_inline: { backgroundColor: theme.bubble, color: theme.text, fontSize: 14 },
  code_block: { backgroundColor: theme.side, borderColor: theme.border, color: theme.text, fontSize: 13, borderRadius: 10, padding: 10 },
  fence: { backgroundColor: theme.side, borderColor: theme.border, color: theme.text, fontSize: 13, borderRadius: 10, padding: 10 },
  blockquote: { backgroundColor: 'transparent', borderLeftColor: theme.border, color: theme.muted },
  link: { color: theme.text, textDecorationLine: 'underline' as const },
  hr: { backgroundColor: theme.border },
  table: { borderColor: theme.border },
  tr: { borderColor: theme.border },
})

export default function Chat() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id: string }>()
  // "new:<bot>" is a chat that does not exist until its first message is sent.
  const newFor = id.startsWith('new:') ? id.slice(4) : null
  const thread = useStore((s) => (newFor ? undefined : s.threads.find((t) => t.id === id)))
  const bot = useStore((s) => s.bots.find((b) => b.id === (newFor ?? thread?.botId)))
  const items = useStore((s) => (thread ? s.items[thread.id] : undefined))
  const partial = useStore((s) => (thread ? s.partial[thread.id] : undefined))
  const connected = useStore((s) => s.connected)
  const threads = useStore((s) => s.threads)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const list = useRef<FlatList<Row>>(null)
  /** Whether the newest line is in view; if it is, the view follows what is written. */
  const following = useRef(true)

  useEffect(() => {
    // Asked again when the connection comes back, in case the chat was opened while it was away.
    if (thread && !items && connected) loadThread(thread.id).then(() => setError(''), (e) => setError(e.message))
  }, [thread?.id, items, connected])

  const shown = useMemo(() => rows(items ?? []), [items])
  const running = thread?.status === 'running'
  const subagents = thread ? threads.filter((t) => t.parentId === thread.id) : []
  const parent = thread?.parentId ? threads.find((t) => t.id === thread.parentId) : undefined

  const send = async () => {
    const message = text.trim()
    if (!message || !bot) return
    setError('')
    setSending(true)
    try {
      const target = thread?.id ?? (await api<Thread>('POST', `/api/bots/${bot.id}/threads`)).id
      await api('POST', `/api/threads/${target}/messages`, { text: message })
      setText('')
      following.current = true
      if (!thread) router.setParams({ id: target })
    } catch (e) {
      setError((e as Error).message)
    }
    setSending(false)
  }

  const tail = (
    <View style={{ paddingBottom: 12 }}>
      {!!partial?.text && <View style={styles.bot}><Markdown style={markdown(theme)}>{partial.text}</Markdown></View>}
      {running && !partial?.text && <View style={styles.working}><ActivityIndicator size="small" color={theme.muted} /><Text style={{ color: theme.muted, fontSize: 14 }}>Working</Text></View>}
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
      <Stack.Screen
        options={{
          title: thread?.title ?? bot?.name ?? '',
          headerRight: () => bot && (
            <Pressable accessibilityRole="button" accessibilityLabel={`${bot.name}’s browser`} hitSlop={12} onPress={() => router.push({ pathname: '/browser/[botId]', params: { botId: bot.id, threadId: thread?.id ?? '' } })}>
              <Text style={{ fontSize: 20 }}>🌐</Text>
            </Pressable>
          ),
        }}
      />
      {!thread && bot ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 44 }}>{bot.emoji}</Text>
          <Text style={{ color: theme.text, fontSize: 20, fontWeight: '600' }}>{bot.name}</Text>
        </View>
      ) : !items ? (
        <View style={styles.empty}><ActivityIndicator color={theme.muted} /></View>
      ) : (
        <FlatList
          ref={list}
          data={shown}
          keyExtractor={(row) => row.key}
          renderItem={({ item }) => <Line row={item} theme={theme} />}
          ListHeaderComponent={parent ? <Text style={[styles.notice, { color: theme.faint }]}>A subagent of “{parent.title}”</Text> : undefined}
          ListFooterComponent={tail}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12 }}
          keyboardDismissMode="interactive"
          onScroll={({ nativeEvent: e }) => (following.current = e.contentOffset.y + e.layoutMeasurement.height > e.contentSize.height - 80)}
          scrollEventThrottle={100}
          onContentSizeChange={() => following.current && list.current?.scrollToEnd({ animated: false })}
          // The keyboard coming up makes the list shorter; the newest line stays in view.
          onLayout={() => following.current && list.current?.scrollToEnd({ animated: false })}
        />
      )}
      <View style={[styles.composer, { borderTopColor: theme.border, paddingBottom: Math.max(insets.bottom, 10) }]}>
        <TextInput
          accessibilityLabel="Message"
          style={[styles.input, { color: theme.text, backgroundColor: theme.side, borderColor: theme.border }]}
          value={text}
          onChangeText={setText}
          placeholder={bot ? `Message ${bot.name}` : 'Message'}
          placeholderTextColor={theme.faint}
          multiline
        />
        {running ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Stop" style={[styles.send, { backgroundColor: theme.bubble }]} onPress={() => api('POST', `/api/threads/${thread!.id}/stop`).catch((e) => setError(e.message))}>
            <View style={{ width: 12, height: 12, borderRadius: 2, backgroundColor: theme.text }} />
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={sending || !text.trim()} style={[styles.send, { backgroundColor: theme.primary, opacity: sending || !text.trim() ? 0.4 : 1 }]} onPress={send}>
            <Text style={{ color: theme.onPrimary, fontSize: 18, fontWeight: '700' }}>↑</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  user: { alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18, marginVertical: 6 },
  bot: { marginVertical: 4 },
  step: { fontSize: 13.5, paddingVertical: 3 },
  notice: { fontSize: 13, lineHeight: 18, paddingVertical: 6 },
  working: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', height: 32, paddingHorizontal: 12, borderWidth: 1, borderRadius: 16 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 42, maxHeight: 140, borderWidth: 1, borderRadius: 21, paddingHorizontal: 15, paddingTop: 10, paddingBottom: 10, fontSize: 16 },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
})
