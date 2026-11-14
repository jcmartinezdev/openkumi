// One recorded change to a bot's workspace: who made it and when, what it changed in each file, and
// Undo, which takes out this change alone and keeps whatever came after it.
import { useEffect, useState } from 'react'
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { HistoryEntry } from '@openkumi/shared'
import { moment } from '@openkumi/client/automations'
import { api, useFiles, useStore } from '@openkumi/client/store'
import { type DiffLine, authorOf, nameOf, parseDiff } from '@openkumi/client/workspace'
import { ICON_INSET, Note, Row, Section, SettingsPage } from '../../../src/SettingsUi'
import { useTheme } from '../../../src/theme'

export default function Change() {
  const router = useRouter()
  const { botId, id, message, author, time } = useLocalSearchParams<{ botId: string; id: string; message: string; author: HistoryEntry['author']; time: string }>()
  const bot = useStore((s) => s.bots.find((b) => b.id === botId))
  const { entries } = useFiles(botId)
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let current = true
    api<{ diff: string }>('GET', `/api/bots/${encodeURIComponent(botId)}/history/${encodeURIComponent(id)}`).then(
      (d) => current && setDiff(d.diff),
      (e) => current && setError((e as Error).message),
    )
    return () => {
      current = false
    }
  }, [botId, id])

  if (!bot) return null
  const change: HistoryEntry = { id, message, author, time: Number(time), files: [] }
  const files = diff === null ? [] : parseDiff(diff)
  const only = files.length === 1 && entries?.some((e) => e.path === files[0].file) ? files[0].file : null
  const when = moment(change.time)

  const undo = () =>
    Alert.alert(`Undo “${message}”?`, 'Only this change is taken out. Later changes stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Undo',
        style: 'destructive',
        onPress: async () => {
          setBusy(true)
          try {
            await api('POST', `/api/bots/${encodeURIComponent(bot.id)}/history/${encodeURIComponent(id)}/undo`)
            router.back()
          } catch (e) {
            Alert.alert('Not undone', (e as Error).message)
          }
          setBusy(false)
        },
      },
    ])

  return (
    <SettingsPage title="Change" subtitle={message}>
      <Section>
        <Row label="Made by" value={authorOf(change, bot.name)} />
        <Row label="When" value={when.charAt(0).toUpperCase() + when.slice(1)} />
      </Section>

      {diff === null && (error ? <Note tone="error">{error}</Note> : <ActivityIndicator />)}
      {files.map(({ file, lines }) => (
        <Section key={file} title={file} bare>
          <Diff lines={lines} />
        </Section>
      ))}

      <Section inset={ICON_INSET} footer={author === 'system' ? undefined : 'Undo asks first. It takes out only this change; what came after it stays.'}>
        {only && <Row icon="file" label={`Open ${nameOf(only)}`} opens onPress={() => router.push({ pathname: '/workspace/[botId]/file', params: { botId: bot.id, path: only } })} />}
        {author !== 'system' && <Row icon="undo" label="Undo this change…" tone="destructive" disabled={busy} onPress={undo} />}
      </Section>
    </SettingsPage>
  )
}

const SIGN = { add: '+', del: '−', same: ' ', gap: '' }

/** A file's lines in the change, a sign beside each. A list item wraps under its text, not under its dash. */
function Diff({ lines }: { lines: DiffLine[] }) {
  const theme = useTheme()
  const color = { add: theme.ok, del: theme.err, same: theme.muted, gap: theme.faint }
  return (
    <View style={[styles.card, { backgroundColor: theme.groupCard }]}>
      {lines.map((line, i) => {
        const bullet = line.text.match(/^(\s*[-*+] )(.*)$/)
        const tint = line.kind === 'add' || line.kind === 'del' ? `${color[line.kind]}1a` : undefined
        return (
          <View key={i} style={[styles.line, i === 0 && styles.first, i === lines.length - 1 && styles.last, tint ? { backgroundColor: tint } : null]}>
            <Text style={[styles.mono, styles.sign, { color: color[line.kind] }]}>{SIGN[line.kind]}</Text>
            {bullet && <Text style={[styles.mono, { color: color[line.kind] }]}>{bullet[1]}</Text>}
            <Text style={[styles.mono, styles.text, { color: color[line.kind] }]}>{line.kind === 'gap' ? '⋯' : bullet ? bullet[2] : line.text || ' '}</Text>
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, overflow: 'hidden' },
  line: { flexDirection: 'row', paddingHorizontal: 14 },
  first: { paddingTop: 10 },
  last: { paddingBottom: 10 },
  mono: { fontFamily: 'Menlo', fontSize: 13, lineHeight: 20 },
  sign: { width: 16 },
  text: { flex: 1 },
})
