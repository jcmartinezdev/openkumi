// One scheduled task: how it stands and its runs (each opens like a conversation), then a form to
// change it, saved with the button in the bar. "new" makes one, for `botId` when given. Unlike the
// settings, a task is saved when it is whole, as on the computer.
import { useState } from 'react'
import { ActionSheetIOS, ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import DateTimePicker from '@react-native-community/datetimepicker'
import * as Haptics from 'expo-haptics'
import type { Schedule, ScheduledTask } from '@openkumi/shared'
import { api, useStore } from '@openkumi/client/store'
import { DAY_LETTERS, DAY_NAMES, STATUS_LABEL, WEEK, localZone, madeBy, moment, nextRun, runStatus, runTime, trouble, useRuns } from '@openkumi/client/tasks'
import { Avatar, Field, Note, Row, Section, Segments, SettingsPage, SwitchRow } from '../../src/SettingsUi'
import { useAppearance, useTheme } from '../../src/theme'

interface Draft {
  botId: string
  title: string
  prompt: string
  enabled: boolean
  kind: Schedule['type']
  /** For "once": when, as a moment in time. */
  at: number
  /** For "daily": "HH:MM" on the clock of the computer running OpenKumi. */
  time: string
  days: number[]
  /** For "interval": as typed. */
  every: string
  unit: 'minutes' | 'hours'
}

function draftOf(task: ScheduledTask | undefined, botId: string): Draft {
  const s = task?.schedule
  const nextHour = new Date()
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0)
  const hourly = s?.type === 'interval' && s.minutes % 60 === 0
  return {
    botId: task?.botId ?? botId,
    title: task?.title ?? '',
    prompt: task?.prompt ?? '',
    enabled: task?.enabled ?? true,
    kind: s?.type ?? 'daily',
    at: s?.type === 'once' ? s.at : nextHour.getTime(),
    time: s?.type === 'daily' ? s.time : '08:00',
    days: s?.type === 'daily' ? s.days : [],
    every: String(s?.type === 'interval' ? (hourly ? s.minutes / 60 : s.minutes) : 1),
    unit: s?.type === 'interval' && !hourly ? 'minutes' : 'hours',
  }
}

/** What the server is sent for a draft. */
function bodyOf(d: Draft) {
  const schedule: Schedule =
    d.kind === 'once' ? { type: 'once', at: d.at }
    : d.kind === 'daily' ? { type: 'daily', time: d.time, days: d.days }
    : { type: 'interval', minutes: Number(d.every) * (d.unit === 'hours' ? 60 : 1) }
  return { botId: d.botId, title: d.title.trim(), prompt: d.prompt.trim(), enabled: d.enabled, schedule }
}

/** A time of day as the picker takes it: today, at that time. Only the hours and minutes are read back. */
const clockDate = (time: string) => {
  const [h, m] = time.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}
const pad = (n: number) => String(n).padStart(2, '0')

const KINDS = [['daily', 'At a time'], ['interval', 'Every so often'], ['once', 'Once']] as const

export default function TaskPage() {
  const theme = useTheme()
  const appearance = useAppearance()
  const router = useRouter()
  const { id, botId } = useLocalSearchParams<{ id: string; botId?: string }>()
  const task = useStore((s) => s.tasks.find((t) => t.id === id))
  const bots = useStore((s) => s.bots)
  const zone = useStore((s) => s.about.timeZone)
  const [draft, setDraft] = useState(() => draftOf(task, botId || (bots[0]?.id ?? '')))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const bot = bots.find((b) => b.id === draft.botId)

  // Deleted, here or elsewhere, while open.
  if (id !== 'new' && !task) return null

  // Only what was changed is sent, so that a task's schedule is not started over by renaming it.
  const body = bodyOf(draft)
  const saved = task && bodyOf(draftOf(task, task.botId))
  const changed = saved ? (Object.keys(body) as (keyof typeof body)[]).filter((k) => JSON.stringify(body[k]) !== JSON.stringify(saved[k])) : []
  const ready = !!body.title && !!body.prompt && !!bot && (draft.kind !== 'interval' || Number(draft.every) > 0)
  const { runs, more, showOlder, error: runsError } = useRuns(task?.id)
  const running = task?.lastStatus === 'running'
  const otherZone = !!zone && zone !== localZone()

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    }
    setBusy(false)
  }
  const save = () =>
    run(async () => {
      if (task) await api('PATCH', `/api/tasks/${task.id}`, Object.fromEntries(changed.map((k) => [k, body[k]])))
      else {
        await api('POST', '/api/tasks', body)
        router.back()
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    })
  const remove = () =>
    task &&
    Alert.alert(`Delete “${task.title}”?`, `Its earlier runs stay beneath ${bot?.name ?? 'the bot'}’s conversation.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => void run(async () => (await api('DELETE', `/api/tasks/${task.id}`), router.back())) },
    ])
  const pickBot = () =>
    ActionSheetIOS.showActionSheetWithOptions({ title: 'The bot that does the task', options: [...bots.map((b) => `${b.emoji} ${b.name}`), 'Cancel'], cancelButtonIndex: bots.length }, (i) => i < bots.length && change({ botId: bots[i].id }))
  const toggleDay = (day: number) => (void Haptics.selectionAsync(), change({ days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day].sort((a, b) => a - b) }))

  return (
    <SettingsPage title={task ? task.title : 'New task'} subtitle={task ? bot?.name : 'Scheduled task'} buttons={1}>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button variant="done" disabled={busy || !ready || (!!task && !changed.length)} onPress={save}>
          {task ? 'Save' : 'Create'}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>

      {!!error && <Note tone="error">{error}</Note>}

      {/* A task that exists is mostly looked at for what it did, so that comes before the form. */}
      {task && (
        <Section>
          <Row label="Next run" value={nextRun(task)} />
          {!!task.lastRunAt && !!task.lastStatus && <Row label="Last run" value={`${STATUS_LABEL[task.lastStatus]}, ${moment(task.lastRunAt)}`} />}
          <Row label="Made by" value={task.createdBy === 'user' ? 'You' : madeBy(task, bots)} />
          <Row icon="play" label={running ? 'Running now' : 'Run now'} tone="action" disabled={busy || running} onPress={() => void run(() => api('POST', `/api/tasks/${task.id}/run`))} />
        </Section>
      )}
      {task && !!trouble(task) && <Note tone="error">{trouble(task)}</Note>}

      {task && (
        <Section title="Runs" inset={40} footer={runsError ? `The runs could not be fetched: ${runsError}` : runs.length ? undefined : 'Each run will be listed here, and opens like a conversation.'}>
          {runs.map((r) => (
            <Row
              key={r.id}
              leading={r.status === 'running' ? <ActivityIndicator size="small" color={theme.run} style={styles.mark} /> : <View style={[styles.mark, styles.dot, { backgroundColor: r.status === 'error' ? theme.err : theme.faint }]} />}
              label={runTime(r)}
              value={runStatus(r, task)}
              opens
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: r.id } })}
            />
          ))}
          {more && <Row label="Show older runs" tone="action" onPress={showOlder} />}
        </Section>
      )}

      <Section title="Task">
        <Row leading={bot && <Avatar bot={bot} size={28} />} label="Bot" value={bot?.name ?? 'Choose a bot'} opens onPress={pickBot} />
        <Field label="Name" value={draft.title} placeholder="Morning brief" onChange={(title) => change({ title })} autoCapitalize="sentences" />
      </Section>

      <Section title="Prompt" footer="What the bot does each time. A run sees nothing of the conversation, so say everything it needs, and what to tell you.">
        <Field label="Prompt" multiline value={draft.prompt} placeholder="Read the main headlines on a few news sites and give me the five that matter most, with a line on each." onChange={(prompt) => change({ prompt })} />
      </Section>

      <Section
        title="When"
        footer={
          draft.kind === 'daily' ? (otherZone ? `In ${zone}, the time zone of the computer running OpenKumi.` : draft.days.length ? undefined : 'Every day. Choose days to run on those only.')
          : draft.kind === 'interval' ? 'Counted from when it is turned on, or from the run before. At most every 5 minutes.'
          : undefined
        }
      >
        <View style={styles.pad}>
          <Segments label="Runs" value={draft.kind} options={KINDS} onChange={(kind) => change({ kind })} />
        </View>
        {draft.kind === 'daily' && (
          <Row label="Time">
            <DateTimePicker
              value={clockDate(draft.time)}
              mode="time"
              display="compact"
              themeVariant={appearance}
              onValueChange={(_, d) => change({ time: `${pad(d.getHours())}:${pad(d.getMinutes())}` })}
            />
          </Row>
        )}
        {draft.kind === 'daily' && (
          <View accessibilityRole="none" accessibilityLabel="Days" style={styles.days}>
            {WEEK.map((d) => {
              const on = draft.days.includes(d)
              return (
                <Pressable
                  key={d}
                  accessibilityRole="checkbox"
                  accessibilityLabel={DAY_NAMES[d]}
                  accessibilityState={{ checked: on }}
                  hitSlop={4}
                  style={[styles.day, { backgroundColor: on ? theme.primary : theme.bubble }]}
                  onPress={() => toggleDay(d)}
                >
                  <Text style={{ color: on ? theme.onPrimary : theme.text, fontSize: 14, fontWeight: '600' }}>{DAY_LETTERS[d]}</Text>
                </Pressable>
              )
            })}
          </View>
        )}
        {draft.kind === 'interval' && (
          <Row label="Every">
            <View style={styles.every}>
              <TextInput
                accessibilityLabel="How many"
                style={[styles.number, { color: theme.text, backgroundColor: theme.bubble }]}
                value={draft.every}
                onChangeText={(every) => change({ every: every.replace(/[^0-9]/g, '') })}
                keyboardType="number-pad"
                maxLength={4}
                selectTextOnFocus
              />
              <View style={{ width: 150 }}>
                <Segments label="Unit" value={draft.unit} options={[['minutes', 'minutes'], ['hours', 'hours']]} onChange={(unit) => change({ unit })} />
              </View>
            </View>
          </Row>
        )}
        {draft.kind === 'once' && (
          <Row label="Date">
            <DateTimePicker value={new Date(draft.at)} mode="datetime" display="compact" minimumDate={new Date()} themeVariant={appearance} onValueChange={(_, d) => change({ at: d.getTime() })} />
          </Row>
        )}
        <SwitchRow label="Turned on" detail="When off, it does not run by itself. It can still be run by hand." value={draft.enabled} onChange={(enabled) => change({ enabled })} />
      </Section>

      {task && (
        <Section>
          <Row label="Delete task" tone="destructive" disabled={busy} onPress={remove} />
        </Section>
      )}
    </SettingsPage>
  )
}

const styles = StyleSheet.create({
  pad: { padding: 12 },
  mark: { width: 14, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginHorizontal: 3 },
  days: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  every: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  number: { width: 56, height: 34, borderRadius: 8, textAlign: 'center', fontSize: 16 },
})
