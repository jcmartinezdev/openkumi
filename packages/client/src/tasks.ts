// Scheduled tasks in words, the same in every app: when one runs, and how its runs went.
import { useEffect, useRef, useState } from 'react'
import type { Schedule, ScheduledTask, Thread } from '@openkumi/shared'
import { api, useStore } from './store'

export const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_SHORT = DAY_NAMES.map((d) => d.slice(0, 3))
/** Monday first, as a week is usually laid out. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0]

const pad = (n: number) => String(n).padStart(2, '0')
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** The time zone of the device the app is on. */
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone

/** A moment in a few words: "today 08:00", "tomorrow 08:00", "Thu 13 Nov, 08:00". */
export function moment(time: number, now = Date.now()): string {
  const d = new Date(time)
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days === 0) return `today ${clock(d)}`
  if (days === 1) return `tomorrow ${clock(d)}`
  if (days === -1) return `yesterday ${clock(d)}`
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`
  return `${DAY_SHORT[d.getDay()]} ${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}${year}, ${clock(d)}`
}

/**
 * When a task runs, e.g. "Weekdays at 08:00". A time of day is kept in the time zone of the
 * computer running OpenKumi; `zone` names it when it is not this device's.
 */
export function scheduleLabel(s: Schedule, zone?: string): string {
  if (s.type === 'once') return `Once, ${moment(s.at)}`
  if (s.type === 'interval') {
    const hours = s.minutes / 60
    return Number.isInteger(hours) ? (hours === 1 ? 'Every hour' : `Every ${hours} hours`) : `Every ${s.minutes} minutes`
  }
  const days = s.days.join()
  const on = !s.days.length ? 'Every day' : days === '1,2,3,4,5' ? 'Weekdays' : days === '0,6' ? 'Weekends' : WEEK.filter((d) => s.days.includes(d)).map((d) => DAY_SHORT[d]).join(', ')
  return `${on} at ${s.time}${zone && zone !== localZone() ? ` (${zone})` : ''}`
}

export const STATUS_LABEL: Record<NonNullable<ScheduledTask['lastStatus']>, string> = {
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  missed: 'Missed',
}

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** When a task runs next, or why it does not. */
export const nextRun = (task: ScheduledTask) => (!task.enabled ? 'Paused' : task.nextRunAt ? upper(moment(task.nextRunAt)) : 'Will not run again')

/** What went wrong the last time, when the runs beneath the task cannot say it. */
export function trouble(task: ScheduledTask): string | null {
  if (task.lastStatus === 'missed' && task.lastRunAt) return `Missed ${moment(task.lastRunAt)}, when the computer was off or asleep`
  // A run that failed before it had a thread of its own has nowhere else to say so.
  if (task.lastStatus === 'failed' && task.lastError && !task.lastThreadId) return `Could not start: ${task.lastError}`
  return null
}

/** Where a task stands, in one line. */
export const standing = (task: ScheduledTask) => [task.enabled && task.nextRunAt ? `Next ${moment(task.nextRunAt)}` : nextRun(task), trouble(task)].filter(Boolean).join(' · ')

/** When a run started, as a list of runs shows it: "Today 08:00". */
export const runTime = (run: Thread) => upper(moment(run.createdAt))

/** How a run went. The task knows exactly how its latest run ended; for the earlier ones, the thread says enough. */
export function runStatus(run: Thread, task: ScheduledTask): string {
  if (run.status === 'running') return 'Running'
  if (run.status === 'error') return 'Failed'
  return run.id === task.lastThreadId && task.lastStatus ? STATUS_LABEL[task.lastStatus] : 'Done'
}

/**
 * A task's runs, newest first. The server keeps every run, so they are fetched a page at a time:
 * the newest when the view opens, older ones with `showOlder`. What the environment reports while
 * the view is open (a run starting, or finishing) is laid over them.
 */
export function useRuns(taskId: string | undefined): { runs: Thread[]; more: boolean; showOlder: () => void; error: string } {
  const threads = useStore((s) => s.threads)
  const connected = useStore((s) => s.connected)
  const [fetched, setFetched] = useState<{ taskId: string; runs: Thread[]; more: boolean } | null>(null)
  const [error, setError] = useState('')
  /** Counts the requests, so that an answer to one made before the last is dropped. */
  const asked = useRef(0)
  const fetchPage = (id: string, before?: number) => {
    const mine = ++asked.current
    api<{ runs: Thread[]; more: boolean }>('GET', `/api/tasks/${encodeURIComponent(id)}/runs${before ? `?before=${before}` : ''}`).then(
      (page) => {
        if (mine !== asked.current) return
        setError('')
        setFetched((had) => ({ taskId: id, runs: before && had?.taskId === id ? [...had.runs, ...page.runs] : page.runs, more: page.more }))
      },
      (e: Error) => mine === asked.current && setError(e.message),
    )
  }
  // Fetched again when the connection comes back: runs may have started and finished meanwhile.
  useEffect(() => {
    if (taskId && connected) fetchPage(taskId)
  }, [taskId, connected])
  const own = fetched && fetched.taskId === taskId ? fetched : null
  const byId = new Map((own?.runs ?? []).map((r) => [r.id, r]))
  for (const t of threads) if (taskId && t.taskId === taskId) byId.set(t.id, t)
  const runs = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
  const showOlder = () => taskId && own?.more && fetchPage(taskId, own.runs.at(-1)?.createdAt)
  return { runs, more: !!own?.more, showOlder, error }
}

/** Who made a task, in words: "you", or the bot's name. */
export function madeBy(task: ScheduledTask, bots: { id: string; name: string }[]): string {
  if (task.createdBy === 'user') return 'you'
  return bots.find((b) => b.id === task.createdBy)?.name ?? 'a bot that was deleted'
}
