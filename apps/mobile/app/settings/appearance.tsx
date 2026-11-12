// How the app looks on this phone: light or dark, and how big messages are written. Kept on the
// phone, as the computer keeps its own.
import { Pressable, StyleSheet, Text, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { type Prefs, TEXT_SIZE_LABEL, THEME_LABEL, setPref, textScaleOf, usePrefs } from '../../src/prefs'
import { Section, Segments, SettingsPage } from '../../src/SettingsUi'
import { THEMES, type Theme, useTheme } from '../../src/theme'

export default function AppearanceSettings() {
  const theme = useTheme()
  const prefs = usePrefs()
  const scale = textScaleOf(prefs.textSize)
  const pick = <K extends keyof Prefs>(key: K, value: Prefs[K]) => (void Haptics.selectionAsync(), setPref(key, value))

  return (
    <SettingsPage title="Appearance" subtitle="This phone">
      <Section bare title="Theme" footer="System follows the phone’s own setting, light by day and dark by night if it is set to.">
        <View accessibilityRole="radiogroup" accessibilityLabel="Theme" style={styles.modes}>
          {(Object.keys(THEME_LABEL) as Prefs['theme'][]).map((mode) => (
            <Pressable
              key={mode}
              accessibilityRole="radio"
              accessibilityLabel={THEME_LABEL[mode]}
              accessibilityState={{ checked: prefs.theme === mode }}
              style={({ pressed }) => [styles.mode, { backgroundColor: theme.groupCard, borderColor: prefs.theme === mode ? theme.text : 'transparent' }, pressed && { transform: [{ scale: 0.97 }] }]}
              onPress={() => prefs.theme !== mode && pick('theme', mode)}
            >
              <View style={[styles.phone, { borderColor: theme.border }]}>
                {mode === 'system' ? (
                  <>
                    <Preview look={THEMES.light} />
                    <Preview look={THEMES.dark} />
                  </>
                ) : (
                  <Preview look={THEMES[mode]} />
                )}
              </View>
              <Text style={{ color: prefs.theme === mode ? theme.text : theme.muted, fontSize: 15, fontWeight: prefs.theme === mode ? '600' : '400' }}>{THEME_LABEL[mode]}</Text>
            </Pressable>
          ))}
        </View>
      </Section>

      <Section title="Message text size" footer="For what is said in a conversation. The rest of the app follows the phone’s own text size.">
        <View style={styles.sample}>
          <View style={[styles.bubble, { backgroundColor: theme.bubble }]}>
            <Text style={{ color: theme.text, fontSize: 16 * scale, lineHeight: 22 * scale }}>What’s on my calendar tomorrow?</Text>
          </View>
          <Text style={{ color: theme.text, fontSize: 16 * scale, lineHeight: 23 * scale }}>Two meetings: the design review at 10:00 and lunch with Sam at 13:00.</Text>
          <Segments label="Message text size" value={prefs.textSize} options={(Object.keys(TEXT_SIZE_LABEL) as Prefs['textSize'][]).map((size) => [size, TEXT_SIZE_LABEL[size]] as const)} onChange={(size) => pick('textSize', size)} />
        </View>
      </Section>
    </SettingsPage>
  )
}

/** A small picture of a conversation in one of the dresses: a reply, then a message of the user's. */
function Preview({ look }: { look: Theme }) {
  return (
    <View style={[styles.half, { backgroundColor: look.bg }]}>
      <View style={[styles.bar, { backgroundColor: look.faint, width: '70%' }]} />
      <View style={[styles.bar, { backgroundColor: look.faint, width: '45%' }]} />
      <View style={{ flex: 1 }} />
      <View style={[styles.pill, { backgroundColor: look.bubble }]} />
      <View style={[styles.composer, { borderColor: look.border, backgroundColor: look.raised }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  modes: { flexDirection: 'row', gap: 10 },
  mode: { flex: 1, alignItems: 'center', gap: 10, paddingTop: 14, paddingBottom: 12, borderRadius: 18, borderWidth: 2 },
  phone: { flexDirection: 'row', width: 58, height: 100, borderRadius: 14, borderWidth: 1.5, overflow: 'hidden' },
  half: { flex: 1, paddingHorizontal: 5, paddingTop: 12, paddingBottom: 5, gap: 4 },
  bar: { height: 4, borderRadius: 2, opacity: 0.6 },
  pill: { alignSelf: 'flex-end', width: '75%', height: 10, borderRadius: 5, marginBottom: 2 },
  composer: { height: 12, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  sample: { padding: 16, gap: 12 },
  bubble: { alignSelf: 'flex-end', maxWidth: '86%', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 18 },
})
