// What the server tells OpenKumi's makers (apps/server/src/telemetry.ts), as its owner sees it:
// the question, asked once of a server that has not been asked, and the Privacy page of the
// settings, where the answer can be changed and everything that was sent can be read.
// The iPhone has the same two (apps/mobile/src/Telemetry.tsx); keep them alike.
import { useEffect, useState } from 'react'
import type { TelemetryEvent, TelemetryReport } from '@openkumi/shared'
import { PRIVACY_POLICY_URL, TELEMETRY_ASK, TELEMETRY_CHOICE, TELEMETRY_HOW, TELEMETRY_NEVER, TELEMETRY_SENT, TELEMETRY_TITLE, TELEMETRY_URL } from '@openkumi/shared/telemetry'
import { Icon } from './Icon'
import { Dialog } from './Modals'
import { Page, Row, Section, Switch, useSetting } from './settingsUi'
import { api, saveSettings, useStore } from './store'

/** The servers the question was closed on without an answer: it is not put again until the app is next opened. */
const later = new Set<string>()

/**
 * Asks whether the server may send, the first time the app meets one that has not been asked.
 * The box is ticked: leaving it and going on is a yes. Closing the question is no answer, and
 * nothing is sent meanwhile.
 */
export function TelemetryQuestion() {
  const can = useStore((s) => s.about.telemetry?.can)
  const answer = useStore((s) => s.settings.telemetry)
  const server = useStore((s) => s.database)
  const [yes, setYes] = useState(true)
  const [closed, setClosed] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => setClosed(later.has(server)), [server])
  if (!can || answer !== null || closed || later.has(server)) return null
  const close = () => (later.add(server), setClosed(true))
  const save = () => saveSettings({ telemetry: yes }).catch((e) => setError(e.message))
  return (
    <Dialog title={TELEMETRY_TITLE} close={close}>
      <div className="form telemetry-ask">
        <p>{TELEMETRY_ASK}</p>
        <Lists />
        <p className="faint">{TELEMETRY_HOW} <a href={TELEMETRY_URL} target="_blank" rel="noreferrer">Everything that can be sent</a></p>
        <label className="telemetry-choice">
          <input type="checkbox" checked={yes} onChange={(e) => setYes(e.target.checked)} />
          {TELEMETRY_CHOICE}
        </label>
        {error && <div className="notice error">{error}</div>}
        <div className="actions">
          <span className="grow" />
          <button className="primary" autoFocus onClick={save}>Continue</button>
        </div>
      </div>
    </Dialog>
  )
}

/** What is sent and what never is, side by side. */
function Lists() {
  return (
    <div className="telemetry-lists">
      <div>
        <h3><Icon name="check" size={14} /> Sent</h3>
        <ul>{TELEMETRY_SENT.map((line) => <li key={line}>{line}</li>)}</ul>
      </div>
      <div>
        <h3><Icon name="x" size={14} /> Never sent</h3>
        <ul>{TELEMETRY_NEVER.map((line) => <li key={line}>{line}</li>)}</ul>
      </div>
    </div>
  )
}

const WHEN = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
/** What an event carried, as "name: value" lines. What PostHog needs for its own bookkeeping begins with "$". */
const carried = (event: TelemetryEvent) => Object.entries(event.properties).filter(([name]) => !name.startsWith('$'))
const shown = (value: unknown) => (Array.isArray(value) ? value.join(', ') || 'none' : String(value))

export function PrivacyPage() {
  const telemetry = useSetting('telemetry')
  const info = useStore((s) => s.about.telemetry)
  const connected = useStore((s) => s.connected)
  const [report, setReport] = useState<TelemetryReport | null>(null)
  const [error, setError] = useState('')
  const load = () => api<TelemetryReport>('GET', '/api/telemetry').then(setReport, (e) => setError(e.message))
  useEffect(() => {
    if (connected && info) void load()
  }, [connected, telemetry.value])
  const on = telemetry.value === true
  const newId = () => api<TelemetryReport>('POST', '/api/telemetry/id').then(setReport, (e) => setError(e.message))
  const policy = <a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer">privacy policy</a>

  // A server from before any of this sends nothing and has nothing to ask.
  if (!info) {
    return (
      <Page>
        <p className="set-intro">What OpenKumi does with data is in its {policy}.</p>
        <Section title="Usage and errors">
          <Row title="Nothing is sent" description="The OpenKumi this app is connected to is a version that tells its makers nothing." />
        </Section>
      </Page>
    )
  }
  return (
    <Page>
      <p className="set-intro">This is about the computer that runs your bots, and applies to every app that uses it. What OpenKumi does with data is in its {policy}.</p>
      <Section title="Usage and errors">
        <Row
          id="telemetry"
          title={TELEMETRY_CHOICE}
          description={<>{TELEMETRY_ASK} <a href={TELEMETRY_URL} target="_blank" rel="noreferrer">Everything that can be sent</a></>}
          status={!info.can ? `Nothing is sent from here whatever this says. ${info.why}` : telemetry.value === null ? 'Not answered yet, so nothing is sent.' : undefined}
          control={<Switch label={TELEMETRY_CHOICE} checked={on} onChange={telemetry.set} />}
        >
          <Lists />
        </Row>
        {on && info.can && (
          <Row
            id="telemetry-id"
            title="This computer’s id"
            description="A random id, so that what is sent can be told apart from what another computer sends. It says nothing about you. Switching off throws it away; a new one starts afresh."
            status={report?.id ? <code>{report.id}</code> : 'Made when something is first sent.'}
            control={<button disabled={!report?.id} onClick={newId}>New id</button>}
          />
        )}
      </Section>
      {error && <div className="notice error">{error}</div>}
      {info.can && telemetry.value !== false && (
        <Section title="What was sent" action={<button className="ghost" onClick={load}><Icon name="reload" size={13} /> Refresh</button>}>
          {report?.waiting ? <Row title={`${report.waiting} waiting`} description={on ? 'Recorded, and sent within half a minute.' : 'Kept in memory until you answer: sent after a yes, dropped after a no.'} /> : null}
          {report?.sent.length ? (
            <div className="telemetry-sent">
              {report.sent.map((event, i) => (
                <details key={`${event.at}:${i}`}>
                  <summary>
                    <span>{event.event === '$exception' ? 'error' : event.event}</span>
                    <time>{WHEN.format(new Date(event.at))}</time>
                  </summary>
                  <dl>
                    {carried(event).map(([name, value]) => (
                      <div key={name}>
                        <dt>{name}</dt>
                        <dd>{shown(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              ))}
            </div>
          ) : (
            !report?.waiting && <Row title="Nothing yet" description="Each thing that is sent shows here, exactly as it went." />
          )}
        </Section>
      )}
    </Page>
  )
}
