// The bots on the paired server. Each has one conversation, so a bot is a row, like a contact.
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { mainThread, useStore } from '@openbot/client/store'
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

  const unpair = () => Alert.alert('Unpair this phone?', 'The phone forgets the server. To use it again, pair it again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Unpair', style: 'destructive', onPress: () => void forget() }])
  const header = (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="Server" title={server ? `Paired with ${server.name}` : undefined}>
        <Stack.Toolbar.MenuAction destructive onPress={unpair}>Unpair this phone</Stack.Toolbar.MenuAction>
      </Stack.Toolbar.Menu>
    </Stack.Toolbar>
  )

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

  return (
    <>
      {header}
      {!connected && <Text style={[styles.banner, { color: theme.muted, backgroundColor: theme.side }]}>Reconnecting…</Text>}
      <FlatList
        data={bots}
        keyExtractor={(bot) => bot.id}
        contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
        renderItem={({ item: bot }) => {
          const thread = mainThread(threads, bot.id)
          return (
            <Pressable accessibilityRole="button" accessibilityLabel={`Conversation with ${bot.name}`} style={({ pressed }) => [styles.bot, pressed && { backgroundColor: theme.side }]} onPress={() => router.push({ pathname: '/chat/[id]', params: { id: `bot:${bot.id}` } })}>
              <View style={[styles.avatar, { backgroundColor: theme.bubble }]}><Text style={{ fontSize: 20 }}>{bot.emoji}</Text></View>
              <Text style={[styles.botName, { color: theme.text }]} numberOfLines={1}>{bot.name}</Text>
              {thread?.status === 'running' ? <ActivityIndicator size="small" color={theme.run} /> : thread && <Text style={{ color: theme.faint, fontSize: 13 }}>{ago(thread.updatedAt)}</Text>}
            </Pressable>
          )
        }}
        ListEmptyComponent={<Text style={[styles.lead, { color: theme.muted, padding: 24 }]}>There are no bots on this server yet. Create one in the app on your computer.</Text>}
      />
    </>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  lead: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  banner: { textAlign: 'center', fontSize: 13, paddingVertical: 6 },
  bot: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: 60 },
  avatar: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  botName: { flex: 1, fontSize: 17, fontWeight: '600' },
})
