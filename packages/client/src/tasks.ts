// Scheduled tasks in words, the same in every app: when one runs, and how its runs went.
import type { Schedule, ScheduledTask, Thread } from '@openbot/shared'

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
 * computer running Open Bot; `zone` names it when it is not this device's.
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

/** The runs of a task, newest first. */
export const runsOf = (threads: Thread[], taskId: string) => threads.filter((t) => t.taskId === taskId).sort((a, b) => b.createdAt - a.createdAt)

/** Who made a task, in words: "you", or the bot's name. */
export function madeBy(task: ScheduledTask, bots: { id: string; name: string }[]): string {
  if (task.createdBy === 'user') return 'you'
  return bots.find((b) => b.id === task.createdBy)?.name ?? 'a bot that was deleted'
}
