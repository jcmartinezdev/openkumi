// Says over a screen that what it shows may be behind: while the phone connects to the server
// again, and while it catches up on what changed meanwhile (see @openkumi/client/sync). A strip
// across the top of the list of bots; over a chat, a pill that floats, so the conversation under it
// does not move when it comes and goes.
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { SYNC_WORDS, type Sync } from '@openkumi/client/sync'
import { useTheme } from './theme'

/** How far down a chat the pill reaches, for what floats beside it to keep clear of it. */
export const PILL_ROOM = 8 + 30

export function SyncNote({ sync, floating = false }: { sync: Sync | null; floating?: boolean }) {
  const theme = useTheme()
  if (!sync) return null
  const word = SYNC_WORDS[sync]
  return (
    <View
      pointerEvents="none"
      accessible
      accessibilityRole="text"
      accessibilityLabel={word}
      accessibilityLiveRegion="polite"
      style={floating ? [styles.pill, { backgroundColor: theme.raised, borderColor: theme.border }] : [styles.strip, { backgroundColor: theme.side }]}
    >
      <ActivityIndicator size="small" color={theme.muted} style={styles.spinner} />
      <Text style={[styles.word, { color: theme.muted }]}>{word}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  strip: { height: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  pill: {
    position: 'absolute', top: 8, alignSelf: 'center', zIndex: 2, height: 30, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8, paddingRight: 13,
    borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  // The small spinner is 20 points across; a little smaller sits better beside 13-point words.
  spinner: { transform: [{ scale: 0.75 }] },
  word: { fontSize: 13, fontWeight: '500' },
})
