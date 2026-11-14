// The automations, in the conversation's place: every automation of every bot with its runs beneath
// it, and a page to make or change one. Each run is a thread beneath the bot's conversation and
// opens like any other. Unlike the settings, an automation is a form: it is saved when it is whole.
// One starts at a time, or when something it watches changes. The form makes watches on web pages;
// a watch on one of a bot's apps is set up by the bot, which knows its tools, and can be changed here.
import { useState } from 'react'
import type { Automation, Bot, Schedule, Thread, Trigger, Watch } from '@openkumi/shared'
import { DAY_LETTERS, DAY_NAMES, WEEK, localZone, lookLabel, madeBy, nextRun, runStatus, runTime, standing, triggerLabel, trouble, useRuns, watchLabel } from '@openkumi/client/automations'
import { Icon } from './Icon'
import { Page, Pick, Row, Section, Switch } from './settingsUi'
import { api, openAutomations, useStore } from './store'
import { BotHead } from './Mascot'

export function Automations({ path, openNav }: { path: string[]; openNav: () => void }) {
  const id = path[0] ?? ''
  const automation = useStore((s) => s.automations.find((a) => a.id === id))
  const editing = id === 'new' || !!automation
  return (
    <div className="parts">
      <header>
        <button className="icon menu" aria-label="Menu" onClick={openNav}><Icon name="menu" size={18} /></button>
        {editing && <button className="icon" title="All automations" aria-label="All automations" onClick={() => openAutomations()}><Icon name="back" /></button>}
        <div className="heading"><span className="title">{id === 'new' ? 'New automation' : (automation?.title ?? 'Automations')}</span></div>
        {!editing && <button onClick={() => openAutomations('new')}><Icon name="plus" size={14} /> New automation</button>}
      </header>
      <div className="automations-body">{editing ? <Editor key={id} automation={automation} /> : <AutomationList />}</div>
    </div>
  )
}

// ---- every automation

function AutomationList() {
  const automations = useStore((s) => s.automations)
  const bots = useStore((s) => s.bots)
  const zone = useStore((s) => s.about.timeZone)
  const main = bots[0]
  // What runs (or looks) soonest first; what will not run again last.
  const sorted = [...automations].sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.title.localeCompare(b.title))
  return (
    <Page>
      <p className="set-intro">
        An automation gives a bot a prompt without you asking: at set times, or when something it watches changes. Each run happens in the background,
        beneath the bot’s conversation, and the bot tells you what came of it. Bots make automations too, only for themselves, and change only the ones
        they made
        {main && <>. {main.emoji} {main.name}, your first bot, is the main assistant: it can make, change and delete automations for every bot</>}.
      </p>
      {zone && zone !== localZone() && <p className="set-intro">Times of day are kept in {zone}, the time zone of the computer running OpenKumi.</p>}
      <section className="set-section">
        <div className="set-section-head"><h2>Automations</h2></div>
        {sorted.map((automation) => <AutomationCard key={automation.id} automation={automation} />)}
        {!sorted.length && (
          <div className="set-group">
            <Row title="No automations yet" description="Make one with New automation, or ask a bot, for example “every weekday at 8, send me a short news brief” or “tell me when a new issue is assigned to me”." />
          </div>
        )}
      </section>
    </Page>
  )
}

function RunRow({ run, automation }: { run: Thread; automation: Automation }) {
  return (
    <a className="automation-run" href={`#/${encodeURIComponent(run.botId)}/${encodeURIComponent(run.id)}`}>
      {run.status === 'running' ? <span className="spinner" aria-label="Running" /> : <span className={`dot ${run.status === 'error' ? 'error' : ''}`} />}
      <span className="grow">{runTime(run)}</span>
      <span className="faint">{runStatus(run, automation)}</span>
      <Icon name="chevron" size={12} />
    </a>
  )
}

function AutomationCard({ automation }: { automation: Automation }) {
  const bots = useStore((s) => s.bots)
  const zone = useStore((s) => s.about.timeZone)
  const [error, setError] = useState('')
  const bot = bots.find((b) => b.id === automation.botId)
  const { runs } = useRuns(automation.id)
  const act = (fn: () => Promise<unknown>) => fn().then(() => setError(''), (e) => setError(e.message))
  const running = automation.lastStatus === 'running'
  return (
    <div className="set-group automation-card">
      <div className="set-row automation-head">
        <div className="set-row-main">
          <a className="automation-open" href={`#/automations/${encodeURIComponent(automation.id)}`}>
            {bot ? <BotHead bot={bot} /> : <span className="avatar">🤖</span>}
            <span className="set-row-text">
              <h3>{automation.title}</h3>
              <p>{triggerLabel(automation.trigger, zone)} · {bot?.name ?? automation.botId} · made by {madeBy(automation, bots)}</p>
              <p className="set-status">{standing(automation)}</p>
            </span>
          </a>
          <div className="set-control">
            <button className="icon" title="Run now" aria-label={`Run ${automation.title} now`} disabled={running} onClick={() => act(() => api('POST', `/api/automations/${automation.id}/run`))}>
              <Icon name="play" size={15} />
            </button>
            <Switch label={`${automation.title} is on`} checked={automation.enabled} onChange={(enabled) => act(() => api('PATCH', `/api/automations/${automation.id}`, { enabled }))} />
          </div>
        </div>
        {error && <p className="err">{error}</p>}
      </div>
      {runs.slice(0, 3).map((run) => <RunRow key={run.id} run={run} automation={automation} />)}
      {runs.length > 3 && <a className="automation-run automation-more" href={`#/automations/${encodeURIComponent(automation.id)}`}>All runs</a>}
    </div>
  )
}

// ---- one automation, as a form

interface Draft {
  botId: string
  title: string
  prompt: string
  enabled: boolean
  /** How it goes by the clock, or what it watches: a web page, or one of the bot's apps (which only a bot sets up). */
  kind: Schedule['type'] | 'page' | 'app'
  /** For "once": a date and time as a datetime-local field holds it, on this device's clock. */
  at: string
  time: string
  days: number[]
  every: number
  unit: 'minutes' | 'hours'
  /** For a watch on a page: its address. */
  url: string
  /** For a watch: the tracked fields as typed, with commas between them. */
  track: string
  /** For a watch: how many minutes apart it looks. */
  look: number
  /** For a watch on an app: the tool and arguments the bot gave, which stay as they are. */
  app: Extract<Watch, { on: 'tool' }> | null
}

const pad = (n: number) => String(n).padStart(2, '0')
const fieldTime = (time: number) => {
  const d = new Date(time)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function draftOf(automation: Automation | undefined, botId: string): Draft {
  const trigger = automation?.trigger
  const s = trigger?.kind === 'time' ? trigger.schedule : undefined
  const watch = trigger?.kind === 'watch' ? trigger.watch : undefined
  const nextHour = new Date()
  nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0)
  const hourly = s?.type === 'interval' && s.minutes % 60 === 0
  return {
    botId: automation?.botId ?? botId,
    title: automation?.title ?? '',
    prompt: automation?.prompt ?? '',
    enabled: automation?.enabled ?? true,
    kind: watch ? (watch.on === 'tool' ? 'app' : 'page') : (s?.type ?? 'daily'),
    at: fieldTime(s?.type === 'once' ? s.at : nextHour.getTime()),
    time: s?.type === 'daily' ? s.time : '08:00',
    days: s?.type === 'daily' ? s.days : [],
    every: s?.type === 'interval' ? (hourly ? s.minutes / 60 : s.minutes) : 1,
    unit: s?.type === 'interval' && !hourly ? 'minutes' : 'hours',
    url: watch?.on === 'page' ? watch.url : '',
    track: watch?.track.join(', ') ?? '',
    look: watch?.every ?? 15,
    app: watch?.on === 'tool' ? watch : null,
  }
}

/** What the server is sent for a draft. */
function bodyOf(d: Draft) {
  const track = d.track.split(',').map((f) => f.trim()).filter(Boolean)
  const trigger: Trigger =
    d.kind === 'page' ? { kind: 'watch', watch: { on: 'page', url: d.url.trim(), track, every: d.look } }
    : d.kind === 'app' && d.app ? { kind: 'watch', watch: { ...d.app, track, every: d.look } }
    : {
        kind: 'time',
        schedule:
          d.kind === 'once' ? { type: 'once', at: new Date(d.at).getTime() }
          : d.kind === 'daily' ? { type: 'daily', time: d.time, days: d.days }
          : { type: 'interval', minutes: d.every * (d.unit === 'hours' ? 60 : 1) },
      }
  return { botId: d.botId, title: d.title.trim(), prompt: d.prompt.trim(), enabled: d.enabled, trigger }
}

function Editor({ automation }: { automation?: Automation }) {
  const bots = useStore((s) => s.bots)
  const zone = useStore((s) => s.about.timeZone)
  const [draft, setDraft] = useState(() => draftOf(automation, bots[0]?.id ?? ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const bot: Bot | undefined = bots.find((b) => b.id === draft.botId)
  const watching = draft.kind === 'page' || draft.kind === 'app'

  // Only what was changed is sent, so that an automation's schedule is not started over by renaming it.
  const body = bodyOf(draft)
  const saved = automation && bodyOf(draftOf(automation, automation.botId))
  const changed = saved ? (Object.keys(body) as (keyof typeof body)[]).filter((k) => JSON.stringify(body[k]) !== JSON.stringify(saved[k])) : []
  const ready = !!body.title && !!body.prompt && !!bot && (draft.kind !== 'page' || !!draft.url.trim())

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const save = () =>
    run(async () => {
      if (automation) await api('PATCH', `/api/automations/${automation.id}`, Object.fromEntries(changed.map((k) => [k, body[k]])))
      else {
        await api('POST', '/api/automations', body)
        openAutomations()
      }
    })
  const remove = () => {
    if (!automation || !confirm(`Delete “${automation.title}”? Its earlier runs stay beneath ${bot?.name ?? 'the bot'}’s conversation.`)) return
    void run(async () => {
      await api('DELETE', `/api/automations/${automation.id}`)
      openAutomations()
    })
  }
  const toggleDay = (day: number) => change({ days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day].sort((a, b) => a - b) })
  const { runs, more, showOlder, error: runsError } = useRuns(automation?.id)
  const looked = automation?.trigger.kind === 'watch' ? automation.lastCheck : null
  // What a bot's app is watched for can only be chosen by the bot, so it is offered only where it is already so.
  const starts = [['daily', 'At a time of day'], ['interval', 'Every so often'], ['once', 'Once'], ['page', 'When a web page changes'], ...(draft.app ? [['app', `When ${draft.app.app} changes`] as const] : [])] as const

  return (
    <Page>
      {/* An automation that exists is mostly looked at for what it did, so that comes before the form. */}
      {automation && (
        <Section title="Status">
          <Row title="Made by" description={automation.createdBy === 'user' ? 'You.' : `${madeBy(automation, bots)}, with its tools. Only it and the main assistant can change it; you can change any automation.`} />
          <Row title={automation.trigger.kind === 'watch' ? 'Next look' : 'Next run'} description={nextRun(automation)} status={trouble(automation)} />
          {looked && <Row title="Last look" description={`${lookLabel(looked)}.${looked.detail && looked.outcome !== 'failed' ? ` ${looked.detail.replace(/\n/g, ' · ')}` : ''}`} />}
        </Section>
      )}
      {automation && (
        <section className="set-section">
          <div className="set-section-head"><h2>Runs</h2></div>
          <div className="set-group">
            {runs.map((r) => <RunRow key={r.id} run={r} automation={automation} />)}
            {!runs.length && !runsError && <Row title="No runs yet" description="Each run will be listed here, and opens like a conversation." />}
            {runsError && <Row title="The runs could not be fetched" status={runsError} />}
            {more && <button className="automation-run automation-more" onClick={showOlder}>Show older runs</button>}
          </div>
        </section>
      )}
      <Section title="Automation">
        <Row title="Bot" description="The bot that does it." control={<Pick label="Bot" value={draft.botId} options={bots.map((b) => [b.id, `${b.emoji} ${b.name}`] as const)} onChange={(botId) => change({ botId })} />} />
        <Row title="Name" control={<input className="set-input" aria-label="Name" value={draft.title} placeholder="Morning brief" onChange={(e) => change({ title: e.target.value })} />} />
        <Row title="Prompt" description="What the bot does each time. A run sees nothing of the conversation, so say everything it needs, and what to tell you.">
          <textarea
            className="set-input set-area"
            aria-label="Prompt"
            rows={5}
            value={draft.prompt}
            placeholder="Read the main headlines on a few news sites and give me the five that matter most, with a line on each."
            onChange={(e) => change({ prompt: e.target.value })}
          />
        </Row>
      </Section>

      <Section title="When">
        <Row title="Starts" control={<Pick label="Starts" value={draft.kind} options={starts} onChange={(kind) => change({ kind })} />} />
        {draft.kind === 'once' && <Row title="Date and time" control={<input type="datetime-local" className="set-input" aria-label="Date and time" value={draft.at} onChange={(e) => change({ at: e.target.value })} />} />}
        {draft.kind === 'daily' && (
          <>
            <Row
              title="Time"
              description={zone && zone !== localZone() ? `In ${zone}, the time zone of the computer running OpenKumi.` : undefined}
              control={<input type="time" className="set-input time" aria-label="Time" value={draft.time} onChange={(e) => change({ time: e.target.value })} />}
            />
            <Row
              title="Days"
              description={draft.days.length ? undefined : 'Every day. Choose days to run on those only.'}
              control={
                <div className="days" role="group" aria-label="Days">
                  {WEEK.map((d) => (
                    <button key={d} className={`day ${draft.days.includes(d) ? 'on' : ''}`} title={DAY_NAMES[d]} aria-label={DAY_NAMES[d]} aria-pressed={draft.days.includes(d)} onClick={() => toggleDay(d)}>
                      {DAY_LETTERS[d]}
                    </button>
                  ))}
                </div>
              }
            />
          </>
        )}
        {draft.kind === 'interval' && (
          <Row
            title="Every"
            description="Counted from when it is turned on, or from the run before."
            control={
              <>
                <input type="number" className="set-input number" aria-label="How many" min={1} value={draft.every} onChange={(e) => change({ every: Number(e.target.value) })} />
                <Pick label="Unit" value={draft.unit} options={[['minutes', 'minutes'], ['hours', 'hours']] as const} onChange={(unit) => change({ unit })} />
              </>
            }
          />
        )}
        {draft.kind === 'page' && (
          <Row title="Address" description="A public page, read without a sign-in. OpenKumi looks at it itself and starts a run only when it changed, so nothing is spent while it stays the same.">
            <input className="set-input" aria-label="Address" type="url" value={draft.url} placeholder="https://example.com/prices" onChange={(e) => change({ url: e.target.value })} />
          </Row>
        )}
        {draft.kind === 'app' && draft.app && (
          <Row
            title="Watches"
            description={`${watchLabel(draft.app)}${Object.keys(draft.app.arguments).length ? `, with ${JSON.stringify(draft.app.arguments)}` : ''}. OpenKumi makes this call itself and starts a run only when what comes back changed. To watch something else in ${draft.app.app}, ask ${bot?.name ?? 'the bot'}.`}
          />
        )}
        {watching && (
          <>
            <Row
              title="Tracked fields"
              description="For JSON that lists items: the field that tells items apart, then the fields that matter, with commas between them (id, price). The run is told which items are new, updated or gone. Left empty, any change starts a run."
              control={<input className="set-input" aria-label="Tracked fields" value={draft.track} placeholder="None" onChange={(e) => change({ track: e.target.value })} />}
            />
            <Row
              title="Looks every"
              description="Minutes, 5 at the least."
              control={<input type="number" className="set-input number" aria-label="Looks every" min={5} max={1440} value={draft.look} onChange={(e) => change({ look: Number(e.target.value) })} />}
            />
          </>
        )}
        <Row title="Turned on" description="An automation that is off does not run by itself, and can still be run by hand." control={<Switch label="Turned on" checked={draft.enabled} onChange={(enabled) => change({ enabled })} />} />
      </Section>

      {/* Next to the buttons, which are what fail. */}
      {error && <div className="notice error">{error}</div>}
      <div className="automation-actions">
        <button className="primary" disabled={busy || !ready || (!!automation && !changed.length)} onClick={save}>{automation ? (changed.length ? 'Save' : 'Saved') : 'Create automation'}</button>
        {automation && (
          <button disabled={busy || automation.lastStatus === 'running'} onClick={() => run(() => api('POST', `/api/automations/${automation.id}/run`))}>
            <Icon name="play" size={13} /> Run now
          </button>
        )}
        {automation?.trigger.kind === 'watch' && (
          <button title="Look at what it watches now, and run if it changed" disabled={busy || automation.lastStatus === 'running'} onClick={() => run(() => api('POST', `/api/automations/${automation.id}/look`))}>
            <Icon name="search" size={13} /> Look now
          </button>
        )}
        <span className="grow" />
        {automation && <button className="danger" disabled={busy} onClick={remove}><Icon name="trash" size={14} /> Delete</button>}
      </div>

    </Page>
  )
}
