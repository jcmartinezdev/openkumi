// The one question a server has for its owner, as a sheet over the list of bots: whether it may
// tell OpenKumi's makers how it is used and what goes wrong. The switch is on: leaving it and
// going on is a yes. Closing the sheet is no answer, and nothing is sent meanwhile.
import { useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { TELEMETRY_ASK, TELEMETRY_CHOICE, TELEMETRY_HOW, TELEMETRY_TITLE, TELEMETRY_URL } from '@openkumi/shared/telemetry'
import { saveSettings } from '@openkumi/client/store'
import { Glyph } from '../src/icons'
import { TelemetryLists } from '../src/Telemetry'
import { useTheme } from '../src/theme'

export default function TelemetrySheet() {
  const theme = useTheme()
  const router = useRouter()
  const [yes, setYes] = useState(true)
  const [error, setError] = useState('')
  const save = () => saveSettings({ telemetry: yes }).then(() => router.back(), (e) => setError((e as Error).message))
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.sheet} bounces={false}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{TELEMETRY_TITLE}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={[styles.close, { backgroundColor: theme.bubble }]} onPress={() => router.back()}>
          <Glyph name="x" size={13} color={theme.muted} weight={2.4} />
        </Pressable>
      </View>
      <Text style={[styles.text, { color: theme.text }]}>{TELEMETRY_ASK}</Text>
      <View style={styles.inset}><TelemetryLists /></View>
      <Text style={[styles.small, { color: theme.muted }]}>
        {TELEMETRY_HOW}{' '}
        <Text accessibilityRole="link" style={{ textDecorationLine: 'underline' }} onPress={() => void Linking.openURL(TELEMETRY_URL)}>Everything that can be sent</Text>
      </Text>
      {!!error && <Text accessibilityRole="alert" style={[styles.small, { color: theme.err }]}>{error}</Text>}
      <View style={[styles.choice, { backgroundColor: theme.groupCard }]}>
        <Text style={[styles.choiceLabel, { color: theme.text }]}>{TELEMETRY_CHOICE}</Text>
        <Switch accessibilityLabel={TELEMETRY_CHOICE} value={yes} onValueChange={setYes} trackColor={{ true: theme.ok }} />
      </View>
      <Pressable accessibilityRole="button" style={[styles.button, { backgroundColor: theme.primary }]} onPress={() => void save()}>
        <Text style={[styles.buttonText, { color: theme.onPrimary }]}>Continue</Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 16, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  title: { flex: 1, fontSize: 19, fontWeight: '700' },
  close: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  text: { fontSize: 15.5, lineHeight: 21, paddingHorizontal: 4 },
  inset: { paddingHorizontal: 4 },
  small: { fontSize: 13.5, lineHeight: 18, paddingHorizontal: 4 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 10 },
  choiceLabel: { flex: 1, fontSize: 16, lineHeight: 21 },
  button: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
})
