// Automations in words, the same in every app: what starts one, when it runs next, and how its
// runs and its watch's looks went.
import { useEffect, useRef, useState } from 'react'
import type { Automation, Schedule, Thread, Trigger, Watch, WatchCheck } from '@openkumi/shared'
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

const upper = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

const every = (minutes: number) => {
  const hours = minutes / 60
  return Number.isInteger(hours) ? (hours === 1 ? 'every hour' : `every ${hours} hours`) : `every ${minutes} minutes`
}

/**
 * When an automation runs, e.g. "Weekdays at 08:00". A time of day is kept in the time zone of the
 * computer running OpenKumi; `zone` names it when it is not this device's.
 */
export function scheduleLabel(s: Schedule, zone?: string): string {
  if (s.type === 'once') return `Once, ${moment(s.at)}`
  if (s.type === 'interval') return upper(every(s.minutes))
  const days = s.days.join()
  const on = !s.days.length ? 'Every day' : days === '1,2,3,4,5' ? 'Weekdays' : days === '0,6' ? 'Weekends' : WEEK.filter((d) => s.days.includes(d)).map((d) => DAY_SHORT[d]).join(', ')
  return `${on} at ${s.time}${zone && zone !== localZone() ? ` (${zone})` : ''}`
}

/** What a watch looks at, in full: the app and its tool, or the page's address. */
export const watchLabel = (watch: Watch) => (watch.on === 'tool' ? `${watch.app}: ${watch.tool.replace(/^mcp__[A-Za-z0-9-]+?__/, '').replace(/_/g, ' ')}` : watch.url)

/** How often a watch looks: "every 15 minutes". */
export const watchEvery = (watch: Watch) => upper(every(watch.every))

/** Where a watched page is, without the rest of its address: "example.com". */
function site(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** What starts an automation, in a few words: "Weekdays at 08:00", "When Linear changes". */
export function triggerLabel(trigger: Trigger, zone?: string): string {
  if (trigger.kind === 'time') return scheduleLabel(trigger.schedule, zone)
  if (trigger.kind === 'hook') return `When ${trigger.hook.app} calls`
  return `When ${trigger.watch.on === 'tool' ? trigger.watch.app : site(trigger.watch.url)} changes`
}

const LOOK_LABEL: Record<WatchCheck['outcome'], string> = { baseline: 'First look', unchanged: 'No change', changed: 'Changed', failed: 'Failed' }

/** How a watch's latest look went, and when: "No change, today 08:00". */
export const lookLabel = (check: WatchCheck) => `${LOOK_LABEL[check.outcome]}, ${moment(check.at)}`

export const STATUS_LABEL: Record<NonNullable<Automation['lastStatus']>, string> = {
  running: 'Running',
  completed: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
  missed: 'Missed',
}

/** When an automation runs next (a watch: when it looks next), or why it does not. One that starts on an app's calls has no time until one comes. */
export const nextRun = (automation: Automation) =>
  !automation.enabled ? 'Paused' : automation.nextRunAt ? upper(moment(automation.nextRunAt)) : automation.trigger.kind === 'hook' ? `When ${automation.trigger.hook.app} calls` : 'Will not run again'

/** What went wrong the last time, when the runs beneath the automation cannot say it. */
export function trouble(automation: Automation): string | null {
  if (automation.lastStatus === 'missed' && automation.lastRunAt) return `Missed ${moment(automation.lastRunAt)}, when the computer was off or asleep`
  // A run that failed before it had a thread of its own has nowhere else to say so.
  if (automation.lastStatus === 'failed' && automation.lastError && !automation.lastThreadId) return `Could not start: ${automation.lastError}`
  // A look that failed starts no run, so only the automation can say it.
  if (automation.lastCheck?.outcome === 'failed') return `Could not look ${moment(automation.lastCheck.at)}: ${automation.lastCheck.detail ?? 'no reason given'}`
  return null
}

/** Where an automation stands, in one line. */
export const standing = (automation: Automation) =>
  [automation.enabled && automation.nextRunAt ? `${automation.trigger.kind === 'watch' ? 'Looks' : 'Next'} ${moment(automation.nextRunAt)}` : nextRun(automation), trouble(automation)].filter(Boolean).join(' · ')

/** When a run started, as a list of runs shows it: "Today 08:00". */
export const runTime = (run: Thread) => upper(moment(run.createdAt))

/** How a run went. The automation knows exactly how its latest run ended; for the earlier ones, the thread says enough. */
export function runStatus(run: Thread, automation: Automation): string {
  if (run.status === 'running') return 'Running'
  if (run.status === 'error') return 'Failed'
  return run.id === automation.lastThreadId && automation.lastStatus ? STATUS_LABEL[automation.lastStatus] : 'Done'
}

/**
 * An automation's runs, newest first. The server keeps every run, so they are fetched a page at a time:
 * the newest when the view opens, older ones with `showOlder`. What the environment reports while
 * the view is open (a run starting, or finishing) is laid over them.
 */
export function useRuns(automationId: string | undefined): { runs: Thread[]; more: boolean; showOlder: () => void; error: string } {
  const threads = useStore((s) => s.threads)
  const connected = useStore((s) => s.connected)
  const [fetched, setFetched] = useState<{ automationId: string; runs: Thread[]; more: boolean } | null>(null)
  const [error, setError] = useState('')
  /** Counts the requests, so that an answer to one made before the last is dropped. */
  const asked = useRef(0)
  const fetchPage = (id: string, before?: number) => {
    const mine = ++asked.current
    api<{ runs: Thread[]; more: boolean }>('GET', `/api/automations/${encodeURIComponent(id)}/runs${before ? `?before=${before}` : ''}`).then(
      (page) => {
        if (mine !== asked.current) return
        setError('')
        setFetched((had) => ({ automationId: id, runs: before && had?.automationId === id ? [...had.runs, ...page.runs] : page.runs, more: page.more }))
      },
      (e: Error) => mine === asked.current && setError(e.message),
    )
  }
  // Fetched again when the connection comes back: runs may have started and finished meanwhile.
  useEffect(() => {
    if (automationId && connected) fetchPage(automationId)
  }, [automationId, connected])
  const own = fetched && fetched.automationId === automationId ? fetched : null
  const byId = new Map((own?.runs ?? []).map((r) => [r.id, r]))
  for (const t of threads) if (automationId && t.automationId === automationId) byId.set(t.id, t)
  const runs = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt)
  const showOlder = () => automationId && own?.more && fetchPage(automationId, own.runs.at(-1)?.createdAt)
  return { runs, more: !!own?.more, showOlder, error }
}

/**
 * A run's first message: the automation's prompt and, when a watch or an app's call started it,
 * what OpenKumi added about that, with a heading for it.
 */
export function runBrief(text: string): { prompt: string; change: string | null; heading: string } {
  const m = text.match(/^([\s\S]*?)\n\n<(watch_change|hook_events)>\n([\s\S]*)\n<\/\2>$/)
  return m ? { prompt: m[1], change: m[3], heading: m[2] === 'hook_events' ? 'What happened' : 'What changed' } : { prompt: text, change: null, heading: '' }
}

/** Who made an automation, in words: "you", or the bot's name. */
export function madeBy(automation: Automation, bots: { id: string; name: string }[]): string {
  if (automation.createdBy === 'user') return 'you'
  return bots.find((b) => b.id === automation.createdBy)?.name ?? 'a bot that was deleted'
}
