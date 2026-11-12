// The bots on the paired server. Each has one conversation, so a bot is a row, like a contact.
// Under them, as at the bottom of the computer's sidebar, the scheduled tasks; Settings is the gear.
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { mainThread, useStore } from '@openbot/client/store'
import { moment } from '@openbot/client/tasks'
import { Glyph } from '../src/icons'
import { forget, useSession } from '../src/session'
import { useTheme } from '../src/theme'
import { BotHead } from '../src/Mascot'

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
  const tasks = useStore((s) => s.tasks)

  const unpair = () => Alert.alert('Unpair this phone?', 'The phone forgets the server. To use it again, pair it again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Unpair', style: 'destructive', onPress: () => void forget() }])
  const header = (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Settings" onPress={() => router.push('/settings')} />
    </Stack.Toolbar>
  )
  // The task that runs soonest, for the line under Scheduled tasks.
  const next = tasks.reduce<number | null>((soonest, t) => (t.enabled && t.nextRunAt && (soonest === null || t.nextRunAt < soonest) ? t.nextRunAt : soonest), null)
  const scheduled = (
    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.bot, styles.tasks, { borderTopColor: theme.border }, pressed && { backgroundColor: theme.side }]} onPress={() => router.push('/tasks')}>
      <View style={styles.avatar}><Glyph name="clock" size={22} color={theme.muted} weight={1.7} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 17, fontWeight: '500' }}>Scheduled tasks</Text>
        <Text style={{ color: theme.faint, fontSize: 13 }} numberOfLines={1}>{!tasks.length ? 'None yet' : next ? `Next ${moment(next)}` : `${tasks.length} paused or done`}</Text>
      </View>
      {tasks.some((t) => t.lastStatus === 'running') && <ActivityIndicator size="small" color={theme.run} />}
    </Pressable>
  )

  if (!loaded) {
    // Nothing to show yet: the server has not answered, or no longer lets this phone in.
    const lead = refused ? `${server?.name ?? 'The server'} no longer lets this phone in. Unpair it, then pair again with a new code.` : failures >= 2 ? `${server?.name ?? 'The server'} cannot be reached. Check that this phone is on the same network. Still trying…` : 'Connecting…'
    return (
      <View style={styles.center}>
        {header}
        {!refused && <ActivityIndicator color={theme.muted} />}
        <Text accessibilityRole="alert" style={[styles.lead, { color: theme.muted }]}>{lead}</Text>
        {refused && (
          <Pressable accessibilityRole="button" style={[styles.unpair, { borderColor: theme.border }]} onPress={unpair}>
            <Text style={{ color: theme.err, fontSize: 16, fontWeight: '600' }}>Unpair this phone</Text>
          </Pressable>
        )}
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
              <BotHead bot={bot} size={40} />
              <Text style={[styles.botName, { color: theme.text }]} numberOfLines={1}>{bot.name}</Text>
              {thread?.status === 'running' ? <ActivityIndicator size="small" color={theme.run} /> : thread && <Text style={{ color: theme.faint, fontSize: 13 }}>{ago(thread.updatedAt)}</Text>}
            </Pressable>
          )
        }}
        ListEmptyComponent={<Text style={[styles.lead, { color: theme.muted, padding: 24 }]}>There are no bots on this server yet. Create one in the app on your computer.</Text>}
        ListFooterComponent={bots.length ? scheduled : undefined}
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
  tasks: { height: 64, marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  unpair: { height: 46, paddingHorizontal: 22, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
})
