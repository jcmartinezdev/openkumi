// One file a superpower gives a bot to read, to read here too: Markdown formatted as on the
// computer, its wrapped lines joined into paragraphs, or as written. Nobody can change it, the bot
// included, so there is nothing to edit; its links lead out to the web, never into the bot's files.
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { unwrap } from '@openkumi/client/superpowers'
import { api, useStore } from '@openkumi/client/store'
import { Markdown } from '../../../../src/Markdown'
import { ScreenTitle } from '../../../../src/ScreenTitle'
import { Segments } from '../../../../src/SettingsUi'
import { useTheme } from '../../../../src/theme'
import { useTextScale } from '../../../../src/prefs'

export default function SkillFile() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const scale = useTextScale()
  const { id, path } = useLocalSearchParams<{ botId: string; id: string; path: string }>()
  const power = useStore((s) => s.superpowers.find((p) => p.id === id))
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<'formatted' | 'source'>('formatted')
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let current = true
    setText(null)
    setError('')
    api<{ text: string }>('GET', `/api/superpowers/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`).then(
      (d) => current && setText(d.text),
      (e) => current && setError((e as Error).message),
    )
    return () => {
      current = false
    }
  }, [id, path, tries])
  if (!power) return null
  const markdown = /\.md$/i.test(path)
  const source = !markdown || view === 'source'

  return (
    <>
      <ScreenTitle title={path.split('/').pop()!} subtitle={`Read-only · ${power.name}`} />
      {markdown && (
        <View style={[styles.bar, { backgroundColor: theme.bg, borderBottomColor: theme.border }]}>
          <Segments label="Show the file" value={view} options={[['formatted', 'Formatted'], ['source', 'Source']]} onChange={setView} />
        </View>
      )}
      <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 24 }}>
        {text === null ? (
          error ? (
            <View style={styles.failed}>
              <Text style={[styles.failedTitle, { color: theme.text }]}>Couldn’t load this file</Text>
              <Text style={[styles.failedText, { color: theme.muted }]}>{error}</Text>
              <Pressable accessibilityRole="button" hitSlop={12} onPress={() => setTries(tries + 1)}>
                <Text style={[styles.again, { color: theme.text }]}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <ActivityIndicator style={{ marginTop: 40 }} color={theme.muted} />
          )
        ) : source ? (
          <Text selectable accessibilityLabel={`Contents of ${path}`} style={[styles.read, styles.mono, { color: theme.text, fontSize: 13.5 * scale, lineHeight: 20 * scale }]}>{text}</Text>
        ) : (
          <View style={styles.read}><Markdown text={unwrap(text)} /></View>
        )}
      </ScrollView>
    </>
  )
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  read: { paddingHorizontal: 20, paddingTop: 14 },
  mono: { fontFamily: 'Menlo' },
  failed: { alignItems: 'center', gap: 5, paddingTop: 48, paddingHorizontal: 24 },
  failedTitle: { fontSize: 16.5, fontWeight: '600' },
  failedText: { fontSize: 14, lineHeight: 19, textAlign: 'center' },
  again: { fontSize: 15, fontWeight: '600', marginTop: 8, textDecorationLine: 'underline' },
})
