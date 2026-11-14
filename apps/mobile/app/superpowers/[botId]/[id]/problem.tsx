// Why a superpower's app could not be reached, in full: the error as the computer sent it, to read
// or copy, as a sheet over the superpower's page, which says it in a sentence.
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { useStore } from '@openkumi/client/store'
import { useTheme } from '../../../../src/theme'

export default function Problem() {
  const theme = useTheme()
  const router = useRouter()
  const { botId, id } = useLocalSearchParams<{ botId: string; id: string }>()
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const power = useStore((s) => s.superpowers.find((p) => p.id === id))
  const status = useStore((s) => s.superpowerStatus[botId]?.[id])
  if (!bot || !power) return null
  const text = status?.error ?? (status?.state === 'error' ? 'The computer did not say why.' : `${power.name} works again.`)
  const copy = () => void Clipboard.setStringAsync(text).then(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.sheet}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>Couldn’t connect to {power.name}</Text>
        <Pressable accessibilityRole="button" hitSlop={12} onPress={copy}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>Copy</Text>
        </Pressable>
        <Pressable accessibilityRole="button" hitSlop={12} onPress={() => router.back()}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>Done</Text>
        </Pressable>
      </View>
      <Text selectable style={[styles.error, { color: theme.text }]}>{text}</Text>
      <Text style={[styles.note, { color: theme.muted }]}>Try again on the page also retries {bot.name}’s other connections that are down.</Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 34, gap: 14 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  title: { flex: 1, fontSize: 17, fontWeight: '700' },
  error: { fontFamily: 'Menlo', fontSize: 13.5, lineHeight: 20 },
  note: { fontSize: 13.5, lineHeight: 18 },
})
