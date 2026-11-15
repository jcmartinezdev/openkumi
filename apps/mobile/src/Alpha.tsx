// OpenKumi is an alpha, and the app says so beside its name: on the list of bots and on the welcome.
// Settings › About says what that means (ALPHA_NOTE); the computer's app does the same.
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from './theme'

/** The word Alpha in a small capsule, in the colour of something to keep in mind. */
export function AlphaBadge() {
  const theme = useTheme()
  return (
    <View style={[styles.badge, { backgroundColor: `${theme.run}24` }]} accessible accessibilityLabel="Alpha">
      <Text style={[styles.word, { color: theme.runText }]}>ALPHA</Text>
    </View>
  )
}

/** The name at the top of the list of bots, with the badge beside it. */
export function AppTitle() {
  const theme = useTheme()
  return (
    <View style={styles.title} accessible accessibilityRole="header" accessibilityLabel="OpenKumi, alpha">
      <Text style={[styles.name, { color: theme.text }]}>OpenKumi</Text>
      <AlphaBadge />
    </View>
  )
}

const styles = StyleSheet.create({
  badge: { height: 18, paddingHorizontal: 7, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  word: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5 },
  title: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  name: { fontSize: 17, fontWeight: '600' },
})
