// The bots on the paired server. Each has one conversation, so a bot is a row, like a contact.
// Under them, as at the bottom of the computer's sidebar, the automations; Settings is the gear.
// Their order is chosen from the arrows in the top bar; in the owner's own order, a bot that is
// held can be dragged to its place.
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import type { BotSort } from '@openkumi/shared'
import { mainThread, useStore } from '@openkumi/client/store'
import { type Attention, MARK_WORDS, attentionOf } from '@openkumi/client/attention'
import { moment } from '@openkumi/client/automations'
import { BOT_SORTS, useBotOrder } from '@openkumi/client/bots'
import { useSync } from '@openkumi/client/sync'
import { Glyph } from '../src/icons'
import { forget, useSession } from '../src/session'
import { SortableList } from '../src/SortableList'
import { SyncNote } from '../src/SyncNote'
import { type Theme, useTheme } from '../src/theme'
import { BotHead } from '../src/Mascot'

const ROW = 60
/** What each order of the bots does, said under its name where it is chosen. */
const SORT_HINTS: Record<BotSort, string> = {
  created: 'The oldest bot first',
  recent: 'The one you last talked with first',
  manual: 'Hold a bot, then drag it into place',
}

function ago(time: number): string {
  const minutes = Math.floor((Date.now() - time) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / (60 * 24))}d`
}

/**
 * What a bot has for its owner, at the end of its row (@openkumi/client/attention): that it needs
 * them or has something to be read now, in words; that it is at work or failed; or when something
 * last happened in its conversation, with a dot before it when that is still to be read.
 */
function BotMark({ attention, at, theme }: { attention: Attention; at?: number; theme: Theme }) {
  switch (attention.mark) {
    case 'needs':
      return <View style={[styles.pill, { backgroundColor: theme.runTint }]}><Text style={[styles.pillText, { color: theme.runText }]}>{MARK_WORDS.needs}</Text></View>
    case 'read':
      return <View style={[styles.pill, { backgroundColor: theme.freshTint }]}><Text style={[styles.pillText, { color: theme.freshText }]}>{MARK_WORDS.read}</Text></View>
    case 'working':
      // Not in the colour of "needs you": at work is nothing to act on.
      return <ActivityIndicator size="small" color={theme.muted} />
    case 'failed':
      return <View style={[styles.dot, { backgroundColor: theme.err }]} />
    default:
      return at === undefined ? null : (
        <View style={styles.when}>
          {attention.mark === 'new' && <View style={[styles.dot, { backgroundColor: theme.fresh }]} />}
          <Text style={{ color: theme.faint, fontSize: 13 }}>{ago(at)}</Text>
        </View>
      )
  }
}

export default function Home() {
  const theme = useTheme()
  const router = useRouter()
  const { server } = useSession()
  const { bots, sort, choosable, choose, move } = useBotOrder()
  const threads = useStore((s) => s.threads)
  const browsers = useStore((s) => s.browsers)
  const queue = useStore((s) => s.queue)
  const loaded = useStore((s) => s.loaded)
  // Reconnecting, or catching up on what changed while the phone was away (at its owner's computer, say).
  const sync = useSync()
  const refused = useStore((s) => s.refused)
  const outdated = useStore((s) => s.outdated)
  const newer = useStore((s) => s.newer)
  const failures = useStore((s) => s.failures)
  const automations = useStore((s) => s.automations)

  const unpair = () => Alert.alert('Unpair this phone?', 'The phone forgets the server. To use it again, pair it again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Unpair', style: 'destructive', onPress: () => void forget() }])
  const notSaved = (e: Error) => Alert.alert('Not saved', e.message)
  const manual = sort === 'manual'
  const header = (
    <Stack.Toolbar placement="right">
      {loaded && !outdated && !newer && choosable && bots.length > 1 && (
        <Stack.Toolbar.Menu icon="arrow.up.arrow.down" title="Order of the bots" accessibilityLabel="Order of the bots">
          {BOT_SORTS.map(([value, label]) => (
            <Stack.Toolbar.MenuAction key={value} isOn={sort === value} subtitle={SORT_HINTS[value]} onPress={() => void choose(value).catch(notSaved)}>
              {label}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
      )}
      <Stack.Toolbar.Button icon="gearshape" accessibilityLabel="Settings" onPress={() => router.push('/settings')} />
    </Stack.Toolbar>
  )
  // The one that runs (or looks) soonest, for the line under Automations.
  const next = automations.reduce<number | null>((soonest, t) => (t.enabled && t.nextRunAt && (soonest === null || t.nextRunAt < soonest) ? t.nextRunAt : soonest), null)
  const scheduled = (
    <Pressable accessibilityRole="button" style={({ pressed }) => [styles.bot, styles.automations, { borderTopColor: theme.border }, pressed && { backgroundColor: theme.side }]} onPress={() => router.push('/automations')}>
      <View style={styles.avatar}><Glyph name="clock" size={22} color={theme.muted} weight={1.7} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 17, fontWeight: '500' }}>Automations</Text>
        <Text style={{ color: theme.faint, fontSize: 13 }} numberOfLines={1}>{!automations.length ? 'None yet' : next ? `Next ${moment(next)}` : `${automations.length} paused or done`}</Text>
      </View>
      {automations.some((t) => t.lastStatus === 'running') && <ActivityIndicator size="small" color={theme.run} />}
    </Pressable>
  )

  if (!loaded || outdated || newer) {
    // Nothing to show: the server has not answered, no longer lets this phone in, or runs a
    // version this app cannot work with, whatever the phone still holds from before.
    const name = server?.name ?? 'The server'
    const lead = refused
      ? `${name} no longer lets this phone in. Unpair it, then pair again with a new code.`
      : outdated
        ? `${name} runs an older OpenKumi than this app can work with. Update it there (“openkumi update”, or by updating the desktop app that runs it); the phone connects by itself once it is.`
        : newer
          ? `${name} runs a newer OpenKumi than this app can work with. Update the app on this phone.`
          : failures >= 2
            ? `${name} cannot be reached. Check that this phone is on the same network, or, away from home, that it has an https address for it under Settings. Still trying…`
            : 'Connecting…'
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
      <SyncNote sync={sync} />
      <SortableList
        items={bots}
        rowHeight={ROW}
        sortable={manual}
        onMove={(id, to) => void move(id, to).catch(notSaved)}
        liftedStyle={{ backgroundColor: theme.raised, borderRadius: 14 }}
        contentContainerStyle={{ paddingVertical: 8, paddingBottom: 40 }}
        renderRow={(bot, row) => {
          const thread = mainThread(threads, bot.id)
          const place = bots.indexOf(bot)
          const attention = attentionOf(bot.id, { threads, browsers, queue })
          const said = attention.mark ? `, ${MARK_WORDS[attention.mark].toLowerCase()}${attention.reason ? `: ${attention.reason}` : ''}` : ''
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Conversation with ${bot.name}${said}`}
              accessibilityHint={manual ? 'Hold, then drag, to move it in the list' : undefined}
              // For VoiceOver, which cannot drag: a place up or down.
              accessibilityActions={manual ? [...(place > 0 ? [{ name: 'up', label: 'Move up' }] : []), ...(place < bots.length - 1 ? [{ name: 'down', label: 'Move down' }] : [])] : undefined}
              onAccessibilityAction={(e) => void move(bot.id, place + (e.nativeEvent.actionName === 'up' ? -1 : 1)).catch(notSaved)}
              style={({ pressed }) => [styles.bot, pressed && { backgroundColor: theme.side }]}
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: `bot:${bot.id}` } })}
              delayLongPress={300}
              onLongPress={manual ? row.lift : undefined}
              onPressOut={row.release}
            >
              <BotHead bot={bot} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.botName, { color: theme.text }]} numberOfLines={1}>{bot.name}</Text>
                {/* Why it needs its owner, or what there is to read, in the bot's own few words. */}
                {!!attention.reason && <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 17 }} numberOfLines={1}>{attention.reason}</Text>}
              </View>
              <BotMark attention={attention} at={thread?.updatedAt} theme={theme} />
            </Pressable>
          )
        }}
        empty={<Text style={[styles.lead, { color: theme.muted, padding: 24 }]}>There are no bots on this server yet. Create one in the app on your computer.</Text>}
        footer={bots.length ? scheduled : undefined}
      />
    </>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 14 },
  lead: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  bot: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, height: ROW, borderRadius: 14 },
  avatar: { width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  botName: { fontSize: 17, fontWeight: '600' },
  pill: { height: 24, paddingHorizontal: 10, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 12.5, fontWeight: '600' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  when: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  automations: { height: 64, marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  unpair: { height: 46, paddingHorizontal: 22, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
})
