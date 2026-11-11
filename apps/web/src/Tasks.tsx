// The scheduled tasks, in the conversation's place: every task of every bot with its runs beneath
// it, and a page to make or change one. Each run is a thread beneath the bot's conversation and
// opens like any other. Unlike the settings, a task is a form: it is saved when it is whole.
import { useState } from 'react'
import type { Bot, Schedule, ScheduledTask, Thread } from '@openbot/shared'
import { DAY_LETTERS, DAY_NAMES, STATUS_LABEL, WEEK, localZone, madeBy, moment, runsOf, scheduleLabel } from '@openbot/client/tasks'
import { Icon } from './Icon'
import { Page, Pick, Row, Section, Switch } from './settingsUi'
import { api, openTasks, useStore } from './store'

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

export function Tasks({ path, openNav }: { path: string[]; openNav: () => void }) {
  const id = path[0] ?? ''
  const task = useStore((s) => s.tasks.find((t) => t.id === id))
  const editing = id === 'new' || !!task
  return (
    <div className="parts">
      <header>
        <button className="icon menu" aria-label="Menu" onClick={openNav}><Icon name="menu" size={18} /></button>
        {editing && <button className="icon" title="All scheduled tasks" aria-label="All scheduled tasks" onClick={() => openTasks()}><Icon name="back" /></button>}
        <div className="heading"><span className="title">{id === 'new' ? 'New task' : (task?.title ?? 'Scheduled tasks')}</span></div>
        {!editing && <button onClick={() => openTasks('new')}><Icon name="plus" size={14} /> New task</button>}
      </header>
      <div className="tasks-body">{editing ? <Editor key={id} task={task} /> : <TaskList />}</div>
    </div>
  )
}

// ---- every task

function TaskList() {
  const tasks = useStore((s) => s.tasks)
  const bots = useStore((s) => s.bots)
  const zone = useStore((s) => s.about.timeZone)
  const main = bots[0]
  // What runs soonest first; what will not run again last.
  const sorted = [...tasks].sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.title.localeCompare(b.title))
  return (
    <Page>
      <p className="set-intro">
        A scheduled task gives a bot a prompt at set times. Each run happens in the background, beneath the bot’s conversation, and the bot tells you
        what came of it. Bots schedule tasks too, only for themselves, and change only the ones they made
        {main && <>. {main.emoji} {main.name}, your first bot, is the main assistant: it can schedule, change and delete tasks for every bot</>}.
      </p>
      {zone && zone !== localZone() && <p className="set-intro">Times of day are kept in {zone}, the time zone of the computer running Open Bot.</p>}
      <section className="set-section">
        <div className="set-section-head"><h2>Tasks</h2></div>
        {sorted.map((task) => <TaskCard key={task.id} task={task} />)}
        {!sorted.length && (
          <div className="set-group">
            <Row title="No scheduled tasks yet" description="Make one with New task, or ask a bot, for example “every weekday at 8, send me a short news brief”." />
          </div>
        )}
      </section>
    </Page>
  )
}

/** When a task runs next, or why it does not. */
const nextRun = (task: ScheduledTask) => (!task.enabled ? 'Paused' : task.nextRunAt ? upper(moment(task.nextRunAt)) : 'Will not run again')

/** What went wrong the last time, when the runs beneath the task cannot say it. */
function trouble(task: ScheduledTask): string | null {
  if (task.lastStatus === 'missed' && task.lastRunAt) return `Missed ${moment(task.lastRunAt)}, when the computer was off or asleep`
  // A run that failed before it had a thread of its own has nowhere else to say so.
  if (task.lastStatus === 'failed' && task.lastError && !task.lastThreadId) return `Could not start: ${task.lastError}`
  return null
}

/** Where a task stands, in one line. */
const standing = (task: ScheduledTask) => [task.enabled && task.nextRunAt ? `Next ${moment(task.nextRunAt)}` : nextRun(task), trouble(task)].filter(Boolean).join(' · ')

/** How a run went. The task knows exactly how its latest run ended; for the earlier ones, the thread says enough. */
function runStatus(run: Thread, task: ScheduledTask): string {
  if (run.status === 'running') return 'Running'
  if (run.status === 'error') return 'Failed'
  return run.id === task.lastThreadId && task.lastStatus ? STATUS_LABEL[task.lastStatus] : 'Done'
}

function RunRow({ run, task }: { run: Thread; task: ScheduledTask }) {
  return (
    <a className="task-run" href={`#/${encodeURIComponent(run.botId)}/${encodeURIComponent(run.id)}`}>
      {run.status === 'running' ? <span className="spinner" aria-label="Running" /> : <span className={`dot ${run.status === 'error' ? 'error' : ''}`} />}
      <span className="grow">{upper(moment(run.createdAt))}</span>
      <span className="faint">{runStatus(run, task)}</span>
      <Icon name="chevron" size={12} />
    </a>
  )
}

function TaskCard({ task }: { task: ScheduledTask }) {
  const bots = useStore((s) => s.bots)
  const threads = useStore((s) => s.threads)
  const zone = useStore((s) => s.about.timeZone)
  const [error, setError] = useState('')
  const bot = bots.find((b) => b.id === task.botId)
  const runs = runsOf(threads, task.id)
  const act = (fn: () => Promise<unknown>) => fn().then(() => setError(''), (e) => setError(e.message))
  const running = runs[0]?.status === 'running'
  return (
    <div className="set-group task-card">
      <div className="set-row task-head">
        <div className="set-row-main">
          <a className="task-open" href={`#/tasks/${encodeURIComponent(task.id)}`}>
            <span className="avatar">{bot?.emoji ?? '🤖'}</span>
            <span className="set-row-text">
              <h3>{task.title}</h3>
              <p>{scheduleLabel(task.schedule, zone)} · {bot?.name ?? task.botId} · made by {madeBy(task, bots)}</p>
              <p className="set-status">{standing(task)}</p>
            </span>
          </a>
          <div className="set-control">
            <button className="icon" title="Run now" aria-label={`Run ${task.title} now`} disabled={running} onClick={() => act(() => api('POST', `/api/tasks/${task.id}/run`))}>
              <Icon name="play" size={15} />
            </button>
            <Switch label={`${task.title} is on`} checked={task.enabled} onChange={(enabled) => act(() => api('PATCH', `/api/tasks/${task.id}`, { enabled }))} />
          </div>
        </div>
        {error && <p className="err">{error}</p>}
      </div>
      {runs.slice(0, 3).map((run) => <RunRow key={run.id} run={run} task={task} />)}
      {runs.length > 3 && <a className="task-run task-more" href={`#/tasks/${encodeURIComponent(task.id)}`}>All {runs.length} runs</a>}
    </div>
  )
}

// ---- one task, as a form

interface Draft {
  botId: string
  title: string
  prompt: string
  enabled: boolean
  kind: Schedule['type']
  /** For "once": a date and time as a datetime-local field holds it, on this device's clock. */
  at: string
  time: string
  days: number[]
  every: number
  unit: 'minutes' | 'hours'
}

const pad = (n: number) => String(n).padStart(2, '0')
const fieldTime = (time: number) => {
  const d = new Date(time)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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
    at: fieldTime(s?.type === 'once' ? s.at : nextHour.getTime()),
    time: s?.type === 'daily' ? s.time : '08:00',
    days: s?.type === 'daily' ? s.days : [],
    every: s?.type === 'interval' ? (hourly ? s.minutes / 60 : s.minutes) : 1,
    unit: s?.type === 'interval' && !hourly ? 'minutes' : 'hours',
  }
}

/** What the server is sent for a draft. */
function bodyOf(d: Draft) {
  const schedule: Schedule =
    d.kind === 'once' ? { type: 'once', at: new Date(d.at).getTime() }
    : d.kind === 'daily' ? { type: 'daily', time: d.time, days: d.days }
    : { type: 'interval', minutes: d.every * (d.unit === 'hours' ? 60 : 1) }
  return { botId: d.botId, title: d.title.trim(), prompt: d.prompt.trim(), enabled: d.enabled, schedule }
}

function Editor({ task }: { task?: ScheduledTask }) {
  const bots = useStore((s) => s.bots)
  const threads = useStore((s) => s.threads)
  const zone = useStore((s) => s.about.timeZone)
  const [draft, setDraft] = useState(() => draftOf(task, bots[0]?.id ?? ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const change = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const bot: Bot | undefined = bots.find((b) => b.id === draft.botId)

  // Only what was changed is sent, so that a task's schedule is not started over by renaming it.
  const body = bodyOf(draft)
  const saved = task && bodyOf(draftOf(task, task.botId))
  const changed = saved ? (Object.keys(body) as (keyof typeof body)[]).filter((k) => JSON.stringify(body[k]) !== JSON.stringify(saved[k])) : []
  const ready = !!body.title && !!body.prompt && !!bot

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
      if (task) await api('PATCH', `/api/tasks/${task.id}`, Object.fromEntries(changed.map((k) => [k, body[k]])))
      else {
        await api('POST', '/api/tasks', body)
        openTasks()
      }
    })
  const remove = () => {
    if (!task || !confirm(`Delete “${task.title}”? Its earlier runs stay beneath ${bot?.name ?? 'the bot'}’s conversation.`)) return
    void run(async () => {
      await api('DELETE', `/api/tasks/${task.id}`)
      openTasks()
    })
  }
  const toggleDay = (day: number) => change({ days: draft.days.includes(day) ? draft.days.filter((d) => d !== day) : [...draft.days, day].sort((a, b) => a - b) })
  const runs = task ? runsOf(threads, task.id) : []

  return (
    <Page>
      {/* A task that exists is mostly looked at for what it did, so that comes before the form. */}
      {task && (
        <Section title="Status">
          <Row title="Made by" description={task.createdBy === 'user' ? 'You.' : `${madeBy(task, bots)}, with its tools. Only it and the main assistant can change it; you can change any task.`} />
          <Row title="Next run" description={nextRun(task)} status={trouble(task)} />
        </Section>
      )}
      {task && (
        <section className="set-section">
          <div className="set-section-head"><h2>Runs</h2></div>
          <div className="set-group">
            {runs.map((r) => <RunRow key={r.id} run={r} task={task} />)}
            {!runs.length && <Row title="No runs yet" description="Each run will be listed here, and opens like a conversation." />}
            {runs.length >= 50 && <Row title="" description="The latest 50 runs are kept." />}
          </div>
        </section>
      )}
      <Section title="Task">
        <Row title="Bot" description="The bot that does the task." control={<Pick label="Bot" value={draft.botId} options={bots.map((b) => [b.id, `${b.emoji} ${b.name}`] as const)} onChange={(botId) => change({ botId })} />} />
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
        <Row title="Runs" control={<Pick label="Runs" value={draft.kind} options={[['daily', 'At a time of day'], ['interval', 'Every so often'], ['once', 'Once']] as const} onChange={(kind) => change({ kind })} />} />
        {draft.kind === 'once' && <Row title="Date and time" control={<input type="datetime-local" className="set-input" aria-label="Date and time" value={draft.at} onChange={(e) => change({ at: e.target.value })} />} />}
        {draft.kind === 'daily' && (
          <>
            <Row
              title="Time"
              description={zone && zone !== localZone() ? `In ${zone}, the time zone of the computer running Open Bot.` : undefined}
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
        <Row title="Turned on" description="A task that is off does not run by itself, and can still be run by hand." control={<Switch label="Turned on" checked={draft.enabled} onChange={(enabled) => change({ enabled })} />} />
      </Section>

      {/* Next to the buttons, which are what fail. */}
      {error && <div className="notice error">{error}</div>}
      <div className="task-actions">
        <button className="primary" disabled={busy || !ready || (!!task && !changed.length)} onClick={save}>{task ? (changed.length ? 'Save' : 'Saved') : 'Create task'}</button>
        {task && (
          <button disabled={busy || runs[0]?.status === 'running'} onClick={() => run(() => api('POST', `/api/tasks/${task.id}/run`))}>
            <Icon name="play" size={13} /> Run now
          </button>
        )}
        <span className="grow" />
        {task && <button className="danger" disabled={busy} onClick={remove}><Icon name="trash" size={14} /> Delete</button>}
      </div>

    </Page>
  )
}
