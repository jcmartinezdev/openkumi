// What the catalog of superpowers and a bot's settings show of one: its row, with how it stands
// for the bot when it has it, and, while searching, the words that matched.
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import type { Superpower } from '@openkumi/shared'
import type { Standing } from '@openkumi/client/superpowers'
import { foundIn } from '@openkumi/client/superpowers'
import { Glyph, SuperpowerIcon } from './icons'
import { type Theme, useTheme } from './theme'

/** Text with the words looked for marked, wherever they are in it. */
export function Found({ text, words }: { text: string; words: string[] }) {
  const theme = useTheme()
  if (!words.length) return <>{text}</>
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return <>{text.split(pattern).map((part, i) => (i % 2 ? <Text key={i} style={{ backgroundColor: theme.found }}>{part}</Text> : part))}</>
}

/** How one a bot has stands, in the words a list has room for, with a mark before them. */
export function StandingLine({ standing }: { standing: Standing }) {
  const theme = useTheme()
  const color = tone(theme, standing)
  return (
    <View style={styles.standing}>
      {standing.tone === 'ok' ? <Glyph name="check" size={12} color={color} weight={2.6} /> : !standing.settled && <ActivityIndicator size="small" color={theme.muted} style={styles.spinner} />}
      <Text style={[styles.standingText, { color, fontWeight: standing.settled ? '600' : '500' }]} numberOfLines={1}>{standing.words}</Text>
    </View>
  )
}
const tone = (theme: Theme, standing: Standing) => (standing.tone === 'ok' ? theme.okText : standing.tone === 'bad' ? theme.err : theme.muted)

/**
 * A superpower in the catalog: its icon, name, how it stands when the bot has it, and what it is
 * for. While searching, a match the name and tagline do not show is shown too: the group after the
 * name, or the line of what it can do under the tagline.
 */
export function PowerRow({ power, standing, words, onPress }: { power: Superpower; standing?: Standing; words: string[]; onPress: () => void }) {
  const theme = useTheme()
  const found = foundIn(power, words)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[power.name, standing?.words, power.tagline].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.bubble }]}
      onPress={onPress}
    >
      <View style={styles.icon}><SuperpowerIcon power={power} /></View>
      <View style={styles.text}>
        <Text style={[styles.name, { color: theme.text }]}>
          <Found text={power.name} words={words} />
          {!!found.group && <Text style={{ color: theme.muted, fontSize: 15 }}> · <Found text={found.group} words={words} /></Text>}
        </Text>
        {standing && <StandingLine standing={standing} />}
        <Text style={[styles.detail, { color: theme.muted }]} numberOfLines={2}><Found text={power.tagline} words={words} /></Text>
        {!!found.can && <Text style={[styles.detail, { color: theme.muted }]} numberOfLines={1}><Found text={found.can} words={words} /></Text>}
      </View>
      <Glyph name="chevron" size={15} color={theme.faint} weight={2.2} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 16, paddingVertical: 11 },
  icon: { width: 24, alignItems: 'center', alignSelf: 'flex-start', marginTop: 2 },
  text: { flex: 1, gap: 2 },
  name: { fontSize: 16.5, lineHeight: 21 },
  detail: { fontSize: 13.5, lineHeight: 18 },
  standing: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  standingText: { fontSize: 13, lineHeight: 17 },
  spinner: { transform: [{ scale: 0.6 }], width: 12, height: 12 },
})
