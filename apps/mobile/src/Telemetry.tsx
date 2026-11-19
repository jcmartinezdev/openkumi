// What the server tells OpenKumi's makers (apps/server/src/telemetry.ts), as its owner sees it on
// the phone: what is sent and what never is, in the words the desktop app uses
// (apps/web/src/Telemetry.tsx); keep the two alike.
import { useEffect } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useRouter, useSegments } from 'expo-router'
import { TELEMETRY_NEVER, TELEMETRY_SENT } from '@openkumi/shared/telemetry'
import { useStore } from '@openkumi/client/store'
import { Glyph } from './icons'
import { useTheme } from './theme'

/** What is sent and what never is, one under the other. */
export function TelemetryLists() {
  const theme = useTheme()
  const list = (title: string, lines: string[], sent: boolean) => (
    <View style={styles.list}>
      <View style={styles.head}>
        <Glyph name={sent ? 'check' : 'x'} size={14} color={sent ? theme.ok : theme.err} weight={2.4} />
        <Text accessibilityRole="header" style={[styles.title, { color: theme.muted }]}>{title}</Text>
      </View>
      {lines.map((line) => <Text key={line} style={[styles.line, { color: theme.text }]}>{line}</Text>)}
    </View>
  )
  return (
    <View style={styles.lists}>
      {list('Sent', TELEMETRY_SENT, true)}
      {list('Never sent', TELEMETRY_NEVER, false)}
    </View>
  )
}

/** The servers the question was closed on without an answer: it is not put again until the app is next opened. */
const later = new Set<string>()

/**
 * Puts the server's question, once, the first time the app shows a server that has not been
 * asked: a sheet over the list of bots (app/telemetry.tsx).
 */
export function useTelemetryQuestion() {
  const router = useRouter()
  const can = useStore((s) => s.loaded && s.connected && s.about.telemetry?.can)
  const answer = useStore((s) => s.settings.telemetry)
  const server = useStore((s) => s.database)
  // Only over the list of bots: not in the middle of a chat or a page of settings.
  const home = (useSegments() as string[]).length === 0
  useEffect(() => {
    if (!can || answer !== null || !home || !server || later.has(server)) return
    later.add(server)
    router.push('/telemetry')
  }, [can, answer, home, server])
}

const styles = StyleSheet.create({
  lists: { gap: 14 },
  list: { gap: 5 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { fontSize: 13, fontWeight: '600' },
  line: { fontSize: 15, lineHeight: 20 },
})
