// The title of a screen pushed over another, as T3 Code's phone app has it: next to the back button
// rather than centred, in bold, with a fainter line under it that says whose it is or what is going on.
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { Stack } from 'expo-router'
import { useTheme } from './theme'

/** `buttons` is how many buttons the bar has on its right, which the title leaves room for. */
export function ScreenTitle({ title, subtitle, buttons = 0 }: { title: string; subtitle?: string; buttons?: number }) {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  return (
    <>
      {/* The title is an item on the left of the bar; without this the back button would give way to it. */}
      <Stack.Screen options={{ title: '', headerBackVisible: true }} />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.View hidesSharedBackground>
          <View accessible accessibilityRole="header" accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title} style={[styles.box, { maxWidth: width - 96 - (buttons && 16 + 44 * buttons) }]}>
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
            {!!subtitle && <Text style={[styles.subtitle, { color: theme.faint }]} numberOfLines={1}>{subtitle}</Text>}
          </View>
        </Stack.Toolbar.View>
      </Stack.Toolbar>
    </>
  )
}

const styles = StyleSheet.create({
  box: { justifyContent: 'center', paddingHorizontal: 4 },
  title: { fontSize: 17, lineHeight: 21, fontWeight: '700' },
  subtitle: { fontSize: 13, lineHeight: 16 },
})
