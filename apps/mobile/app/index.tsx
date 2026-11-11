// The bots on the paired server, each with its recent chats.
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import type { Thread } from '@openbot/shared'
import { useStore } from '@openbot/client/store'
import { forget, useSession } from '../src/session'
import { useTheme } from '../src/theme'

function ago(time: number): string {
  const minutes = Math.floor((Date.now() - time) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / (60 * 24))}d`
}

export default function Home() {
  const theme = useTheme()
  const router = useRouter()
  const { server } = useSession()
  const bots = useStore((s) => s.bots)
  const threads = useStore((s) => s.threads)
  const loaded = useStore((s) => s.loaded)
  const connected = useStore((s) => s.connected)
  const refused = useStore((s) => s.refused)
  const failures = useStore((s) => s.failures)

  const menu = () =>
    ActionSheetIOS.showActionSheetWithOptions({ title: server ? `Paired with ${server.name}` : undefined, options: ['Unpair this phone', 'Cancel'], destructiveButtonIndex: 0, cancelButtonIndex: 1 }, (choice) => {
      if (choice === 0) Alert.alert('Unpair this phone?', 'The phone forgets the server. To use it again, pair it again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Unpair', style: 'destructive', onPress: () => void forget() }])
    })
  const header = <Stack.Screen options={{ headerRight: () => <Pressable accessibilityRole="button" accessibilityLabel="Server" hitSlop={12} onPress={menu}><Text style={{ color: theme.muted, fontSize: 22, lineHeight: 24 }}>⋯</Text></Pressable> }} />

  if (!loaded) {
    // Nothing to show yet: the server has not answered, or no longer lets this phone in.
    const lead = refused ? `${server?.name ?? 'The server'} no longer lets this phone in. Unpair it, then pair again with a new code.` : failures >= 2 ? `${server?.name ?? 'The server'} cannot be reached. Check that this phone is on the same network. Still trying…` : 'Connecting…'
    return (
      <View style={styles.center}>
        {header}
        {!refused && <ActivityIndicator color={theme.muted} />}
        <Text accessibilityRole="alert" style={[styles.lead, { color: theme.muted }]}>{lead}</Text>
      </View>
    )
  }

  const sections = bots.map((bot) => ({
    bot,
    data: threads.filter((t) => t.botId === bot.id && !t.parentId).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6),
  }))
  return (
    <>
      {header}
      {!connected && <Text style={[styles.banner, { color: theme.muted, backgroundColor: theme.side }]}>Reconnecting…</Text>}
      <SectionList
        sections={sections}
        keyExtractor={(thread: Thread) => thread.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section: { bot } }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={`New chat with ${bot.name}`} style={styles.bot} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: `new:${bot.id}` } })}>
            <View style={[styles.avatar, { backgroundColor: theme.bubble }]}><Text style={{ fontSize: 20 }}>{bot.emoji}</Text></View>
            <Text style={[styles.botName, { color: theme.text }]} numberOfLines={1}>{bot.name}</Text>
            <Text style={{ color: theme.muted, fontSize: 22 }}>＋</Text>
          </Pressable>
        )}
        renderItem={({ item: thread }) => (
          <Pressable accessibilityRole="button" style={({ pressed }) => [styles.chat, pressed && { backgroundColor: theme.side }]} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: thread.id } })}>
            <Text style={[styles.chatTitle, { color: theme.text }]} numberOfLines={1}>{thread.title}</Text>
            {thread.status === 'running' ? <ActivityIndicator size="small" color={theme.run} /> : <Text style={{ color: theme.faint, fontSize: 13 }}>{ago(thread.updatedAt)}</Text>}
          </Pressable>
        )}
        ListEmptyComponent={<Text style={[styles.lead, { color: theme.muted, padding: 24 }]}>There are no bots on this server yet. Create one in the app on your computer.</Text>}
      />
    </>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  lead: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  banner: { textAlign: 'center', fontSize: 13, paddingVertical: 6 },
  bot: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8 },
  avatar: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  botName: { flex: 1, fontSize: 17, fontWeight: '600' },
  chat: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 64, paddingRight: 16, height: 44 },
  chatTitle: { flex: 1, fontSize: 15 },
})
