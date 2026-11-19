// What the server this phone is paired with tells OpenKumi's makers: whether it does, what that
// is and is not, and each thing it sent. The same page as on the computer (apps/web/src/Telemetry.tsx).
import { useEffect, useState } from 'react'
import { Alert, Linking, View } from 'react-native'
import type { TelemetryEvent, TelemetryReport } from '@openkumi/shared'
import { PRIVACY_POLICY_URL, TELEMETRY_ASK, TELEMETRY_CHOICE, TELEMETRY_HOW, TELEMETRY_URL } from '@openkumi/shared/telemetry'
import { api, saveSettings, useStore } from '@openkumi/client/store'
import { useSession } from '../../src/session'
import { Note, Row, Section, SettingsPage, SwitchRow } from '../../src/SettingsUi'
import { TelemetryLists } from '../../src/Telemetry'

const when = (at: string) => new Date(at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
/** What an event carried, in a line. What PostHog needs for its own bookkeeping begins with "$". */
const carried = (event: TelemetryEvent) =>
  Object.entries(event.properties)
    .filter(([name]) => !name.startsWith('$'))
    .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(', ') || 'none' : String(value)}`)
    .join(' · ')

export default function Privacy() {
  const { server } = useSession()
  const info = useStore((s) => s.about.telemetry)
  const answer = useStore((s) => s.settings.telemetry)
  const connected = useStore((s) => s.connected)
  const [report, setReport] = useState<TelemetryReport | null>(null)
  const [busy, setBusy] = useState(false)
  const failed = (e: unknown) => Alert.alert('That did not work', (e as Error).message)
  const load = () => {
    setBusy(true)
    return api<TelemetryReport>('GET', '/api/telemetry').then(setReport, failed).finally(() => setBusy(false))
  }
  useEffect(() => {
    if (connected && info) void load()
  }, [connected, answer])
  const name = server?.name ?? 'the server'
  const on = answer === true
  const policy = <Row label="Privacy policy" tone="action" accessibilityHint="Opens OpenKumi’s privacy policy" onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)} />

  // A server from before any of this sends nothing and has nothing to ask.
  if (!info) {
    return (
      <SettingsPage title="Privacy">
        <Note>{name} runs a version of OpenKumi that tells its makers nothing.</Note>
        <Section>{policy}</Section>
      </SettingsPage>
    )
  }
  return (
    <SettingsPage title="Privacy" refresh={{ busy, run: () => void load() }}>
      <Section
        title={`On ${name}`}
        footer={!info.can ? `Nothing is sent from there whatever this says. ${info.why}` : answer === null ? 'Not answered yet, so nothing is sent.' : `${TELEMETRY_HOW} It applies to every app that uses ${name}.`}
      >
        <SwitchRow label={TELEMETRY_CHOICE} detail={TELEMETRY_ASK} value={on} onChange={(next) => void saveSettings({ telemetry: next }).catch(failed)} />
      </Section>

      <View style={{ paddingHorizontal: 16 }}><TelemetryLists /></View>

      <Section>
        <Row label="Everything that can be sent" tone="action" accessibilityHint="Opens the page in OpenKumi’s docs" onPress={() => void Linking.openURL(TELEMETRY_URL)} />
        {policy}
      </Section>

      {on && info.can && (
        <Section title="Its id" footer="A random id, so that what is sent can be told apart from what another computer sends. It says nothing about you. Switching off throws it away; a new one starts afresh.">
          <Row label={report?.id ?? 'Made when something is first sent'} />
          <Row label="New id" tone="action" disabled={!report?.id} onPress={() => void api<TelemetryReport>('POST', '/api/telemetry/id').then(setReport, failed)} />
        </Section>
      )}

      {info.can && answer !== false && (
        <Section title="What was sent" footer={report?.waiting ? `${report.waiting} more ${on ? 'waiting to be sent, within half a minute.' : 'kept in memory until you answer: sent after a yes, dropped after a no.'}` : undefined}>
          {report?.sent.length ? report.sent.map((event, i) => <Row key={`${event.at}:${i}`} label={event.event === '$exception' ? 'error' : event.event} detail={`${when(event.at)}\n${carried(event)}`} />) : <Row label="Nothing yet" detail="Each thing that is sent shows here, exactly as it went." />}
        </Section>
      )}
    </SettingsPage>
  )
}
