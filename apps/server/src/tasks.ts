// Scheduled tasks: a prompt a bot is given at set times. Each run happens in the background, in a
// thread of its own beneath the bot's conversation (as a subagent's would), and what came of it is
// passed to the conversation for the bot to tell the user. The owner makes tasks in Settings; bots
// make them with their tools, within the rules at the end of this file: a bot schedules only for
// itself and changes or deletes only what it made, except the main assistant (the first bot), which
// may do all of that for every bot.
import type { Bot, Schedule, ScheduledTask, Thread } from '@openkumi/shared'
import * as agent from './agent.ts'
import { getBot, listBots } from './bots.ts'
import * as db from './db.ts'

/** The shortest time, in minutes, between two runs of a task that repeats. */
export const MIN_INTERVAL = 5
/** How late a run at a time of day may still start, after the computer was asleep or off. Any later and it is missed. */
const GRACE = 10 * 60_000
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** What a run says when it has nothing to pass on; such a run is not reported. */
const NOTHING = /^nothing to report\.?$/i

export const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone

// ---- when

const pad = (n: number) => String(n).padStart(2, '0')

function clock(time: string) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time.trim())
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null
}

/** A time as this computer's clock shows it, e.g. "Thu 2026-11-12 09:30". */
export function when(time: number): string {
  const d = new Date(time)
  return `${DAY_NAMES[d.getDay()].slice(0, 3)} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** When a task on this schedule runs next after `after`, or null when it does not. */
export function nextRun(schedule: Schedule, after: number): number | null {
  if (schedule.type === 'once') return schedule.at > after ? schedule.at : null
  if (schedule.type === 'interval') return after + schedule.minutes * 60_000
  const at = clock(schedule.time)
  if (!at) return null
  for (let offset = 0; offset <= 7; offset++) {
    // Set by the calendar, so a run at 08:00 stays at 08:00 when the clocks change.
    const day = new Date(after)
    day.setDate(day.getDate() + offset)
    day.setHours(at.hour, at.minute, 0, 0)
    if (day.getTime() <= after) continue
    if (schedule.days.length && !schedule.days.includes(day.getDay())) continue
    return day.getTime()
  }
  return null
}

/** A schedule in words, e.g. "every weekday at 08:00". */
export function describeSchedule(s: Schedule): string {
  if (s.type === 'once') return `once, on ${when(s.at)}`
  if (s.type === 'interval') {
    const hours = s.minutes / 60
    return Number.isInteger(hours) ? (hours === 1 ? 'every hour' : `every ${hours} hours`) : `every ${s.minutes} minutes`
  }
  const days = s.days.join()
  const on = !s.days.length ? 'every day' : days === '1,2,3,4,5' ? 'every weekday' : days === '0,6' ? 'at weekends' : `every ${s.days.map((d) => DAY_NAMES[d]).join(', ')}`
  return `${on} at ${s.time}`
}

/** A schedule from what was sent, checked. */
export function cleanSchedule(input: any): Schedule {
  if (input?.type === 'once') {
    const at = Number(input.at)
    if (!Number.isFinite(at) || at <= 0) throw new Error('A task that runs once needs a date and time.')
    return { type: 'once', at }
  }
  if (input?.type === 'daily') {
    const at = clock(String(input.time ?? ''))
    if (!at) throw new Error('A time of day is written like 08:30.')
    const days = [...new Set<number>((Array.isArray(input.days) ? input.days : []).map(Number))].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b)
    // All seven days is every day, which is said by giving none.
    return { type: 'daily', time: `${pad(at.hour)}:${pad(at.minute)}`, days: days.length === 7 ? [] : days }
  }
  if (input?.type === 'interval') {
    const minutes = Math.round(Number(input.minutes))
    if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL) throw new Error(`A task can repeat at most every ${MIN_INTERVAL} minutes.`)
    return { type: 'interval', minutes: Math.min(minutes, 366 * 24 * 60) }
  }
  throw new Error('A schedule is "once", "daily" or "interval".')
}

// ---- making and changing tasks

/**
 * Checks a task and works out when it runs next. A schedule that did not change keeps the run it
 * had coming; a new schedule, or a task that was paused, starts counting from now.
 */
function checked(task: ScheduledTask, before?: ScheduledTask): ScheduledTask {
  const title = String(task.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const prompt = String(task.prompt ?? '').trim().slice(0, 8000)
  if (!title) throw new Error('A task needs a name.')
  if (!prompt) throw new Error('A task needs a prompt: what the bot should do each time.')
  if (!getBot(task.botId)) throw new Error(`No bot with id ${task.botId}.`)
  const fresh = !before || JSON.stringify(before.schedule) !== JSON.stringify(task.schedule) || !before.enabled
  const nextRunAt = !task.enabled ? null : fresh ? nextRun(task.schedule, Date.now()) : before.nextRunAt
  if (task.enabled && fresh && nextRunAt === null) throw new Error('That time has already passed.')
  return { ...task, title, prompt, nextRunAt }
}

/** Makes a task. `by` is 'user' for the owner, or the id of the bot that is making it. */
export function createTask(input: Record<string, any>, by: string): ScheduledTask {
  const now = Date.now()
  const task = db.saveTask(
    checked({
      id: db.newTaskId(),
      botId: String(input.botId ?? ''),
      title: input.title,
      prompt: input.prompt,
      schedule: cleanSchedule(input.schedule),
      enabled: input.enabled !== false,
      createdBy: by,
      nextRunAt: null,
      lastRunAt: null,
      lastStatus: null,
      lastError: null,
      lastThreadId: null,
      createdAt: now,
      updatedAt: now,
    }),
  )
  plan()
  return task
}

/** Changes what a task is and when it runs. Who made it, and how it last went, stay as they were. */
export function updateTask(task: ScheduledTask, patch: Record<string, any>): ScheduledTask {
  const next = { ...task }
  if (typeof patch.botId === 'string') next.botId = patch.botId
  if (typeof patch.title === 'string') next.title = patch.title
  if (typeof patch.prompt === 'string') next.prompt = patch.prompt
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
  if (patch.schedule !== undefined) next.schedule = cleanSchedule(patch.schedule)
  const saved = db.saveTask(checked(next, task))
  plan()
  return saved
}

/** A run that is under way when its task is deleted finishes, and is reported as usual. */
export function deleteTask(task: ScheduledTask) {
  db.deleteTask(task.id)
  plan()
}

/** Removes the tasks a bot does, when the bot is deleted. Tasks it made for other bots stay theirs. */
export function forgetBot(botId: string) {
  for (const task of db.listTasks()) if (task.botId === botId) db.deleteTask(task.id)
  plan()
}

// ---- running them

/**
 * Starts a run: a thread beneath the bot's conversation, given the task's prompt. A run the
 * schedule starts moves the task on to its next time; one started by hand leaves that as it was.
 */
function start(task: ScheduledTask, scheduled: boolean): ScheduledTask {
  const now = Date.now()
  const next = scheduled ? nextRun(task.schedule, now) : task.nextRunAt
  const previous = task.lastThreadId ? db.getThread(task.lastThreadId) : undefined
  if (previous && agent.isRunning(previous.id)) {
    if (!scheduled) throw new Error('This task is still running from last time.')
    // Runs do not pile up: while one is at work, the next is let go.
    return db.saveTask({ ...task, nextRunAt: next })
  }
  const conversation = agent.conversation(task.botId)
  const thread = db.createThread({ botId: task.botId, parentId: conversation.id, kind: 'task', taskId: task.id, title: task.title })
  const saved = db.saveTask({ ...task, nextRunAt: next, lastRunAt: now, lastStatus: 'running', lastError: null, lastThreadId: thread.id })
  agent.postMessage(thread.id, { source: 'schedule', text: task.prompt })
  // Every run is kept, however many there are; the apps are only ever sent a page of them.
  return saved
}

/** Runs a task now, whether or not it is paused, without changing when it runs next. */
export function runNow(task: ScheduledTask): ScheduledTask {
  return start(task, false)
}

let timer: NodeJS.Timeout | undefined

/** Sets the timer for the next task that is due. It wakes at least once a minute, so a computer waking from sleep, or a clock that was changed, is noticed. */
function plan() {
  clearTimeout(timer)
  const due = db.nextDue()
  if (due === null) return
  timer = setTimeout(tick, Math.min(Math.max(due - Date.now(), 0), 60_000))
  timer.unref()
}

function tick() {
  const now = Date.now()
  for (const task of db.dueTasks(now)) {
    try {
      if (!getBot(task.botId)) {
        db.deleteTask(task.id)
        continue
      }
      // A run at a time of day that would start long after that time (the computer was asleep or
      // off) is no longer what was asked for: it is noted as missed, and the next one is awaited.
      if (task.schedule.type === 'daily' && now - task.nextRunAt! > GRACE) {
        db.saveTask({ ...task, lastStatus: 'missed', lastRunAt: task.nextRunAt, lastError: null, nextRunAt: nextRun(task.schedule, now) })
      } else start(task, true)
    } catch (e: any) {
      db.saveTask({ ...task, lastStatus: 'failed', lastError: String(e?.message ?? e), nextRunAt: nextRun(task.schedule, now) })
    }
  }
  plan()
}

/** Starts the schedule. Runs that fell due while OpenKumi was not running are dealt with at once. */
export function startScheduler() {
  tick()
}

/** A run has ended: notes how it went, and passes what came of it to the bot's conversation. */
export function finishRun(thread: Thread) {
  const { status, body } = agent.outcome(thread)
  const task = thread.taskId ? db.getTask(thread.taskId) : undefined
  if (task && task.lastThreadId === thread.id) {
    db.saveTask({ ...task, lastStatus: status, lastError: status === 'failed' ? body.replace(/^Error: /, '') : null })
  }
  // Stopped by the owner, or already passed on (the owner wrote in the run afterwards).
  if (thread.reported || status === 'stopped') return
  db.updateThread(thread.id, { reported: true })
  if (status === 'completed' && NOTHING.test(body.trim())) return
  const conversation = agent.conversation(thread.botId)
  agent.postMessage(conversation.id, {
    source: 'task',
    text: `<scheduled_task_result>\nScheduled task "${thread.title}" (task: ${thread.taskId}, run: ${thread.id}) — ${status}\n${body}\n</scheduled_task_result>`,
  })
}

// ---- what bots may do

/** The main assistant: the first bot, which may schedule, see, change and delete tasks for every bot. */
export const mainBot = (): Bot | undefined => listBots()[0]
export const isMain = (bot: Bot) => bot.id === mainBot()?.id

/** The tasks a bot can see: those it does and those it made. The main assistant sees them all. */
function visibleTo(bot: Bot): ScheduledTask[] {
  const main = isMain(bot)
  return db.listTasks().filter((t) => main || t.botId === bot.id || t.createdBy === bot.id)
}

const maker = (task: ScheduledTask, bot: Bot) =>
  task.createdBy === 'user' ? 'the user' : task.createdBy === bot.id ? 'you' : (getBot(task.createdBy)?.name ?? `a bot that was deleted (${task.createdBy})`)

const mayChange = (bot: Bot, task: ScheduledTask) => isMain(bot) || task.createdBy === bot.id

/** The task with this id, if the bot may change or delete it; otherwise an error that says why not. */
function changeable(bot: Bot, id: unknown): ScheduledTask {
  const task = visibleTo(bot).find((t) => t.id === id)
  if (!task) throw new Error(`You have no scheduled task with id ${id}. Use list_scheduled_tasks.`)
  if (!mayChange(bot, task)) {
    throw new Error(`You did not make the task "${task.title}" (${maker(task, bot)} did), so you cannot change or delete it. Only the main assistant, ${mainBot()?.name}, can.`)
  }
  return task
}

/** The bot a task a bot schedules is for: the bot itself, unless it is the main assistant. */
function target(bot: Bot, botId: unknown): string {
  if (botId === undefined || botId === null || botId === '' || botId === bot.id) return bot.id
  if (!isMain(bot)) throw new Error(`Only the main assistant, ${mainBot()?.name}, can schedule tasks for other bots. You can schedule tasks for yourself.`)
  if (!getBot(String(botId))) throw new Error(`No bot with id ${botId}. Use list_bots.`)
  return String(botId)
}

function dayNumber(day: unknown): number {
  const at = DAYS.indexOf(String(day).trim().slice(0, 3).toLowerCase())
  if (at < 0) throw new Error(`"${day}" is not a day of the week. Use mon, tue, wed, thu, fri, sat or sun.`)
  return at
}

/** The schedule a bot asked for with its tool's arguments, or null when it gave none. */
function scheduleFrom(a: Record<string, any>): Schedule | null {
  const given = ['at', 'in_minutes', 'time', 'every_minutes'].filter((k) => a[k] !== undefined && a[k] !== null && a[k] !== '')
  if (!given.length) {
    if (a.days !== undefined) throw new Error('days goes with time.')
    return null
  }
  if (given.length > 1) throw new Error(`Give only one of at, in_minutes, time and every_minutes (you gave ${given.join(' and ')}).`)
  if (a.at !== undefined && a.at !== null && a.at !== '') {
    // Without an offset, a date and time is read as this computer's local time.
    const at = Date.parse(String(a.at).trim().replace(' ', 'T'))
    if (Number.isNaN(at)) throw new Error('at must be a local date and time, like "2026-11-14 09:30".')
    return { type: 'once', at }
  }
  if (a.in_minutes !== undefined && a.in_minutes !== null && a.in_minutes !== '') {
    const minutes = Number(a.in_minutes)
    if (!(minutes > 0)) throw new Error('in_minutes must be more than 0.')
    return { type: 'once', at: Date.now() + Math.round(minutes * 60_000) }
  }
  if (a.time !== undefined && a.time !== null && a.time !== '') {
    const days = a.days === undefined || a.days === null ? [] : (Array.isArray(a.days) ? a.days : [a.days]).map(dayNumber)
    return cleanSchedule({ type: 'daily', time: String(a.time), days })
  }
  return cleanSchedule({ type: 'interval', minutes: a.every_minutes })
}

/** A task as a bot is shown it. */
function view(task: ScheduledTask, bot: Bot) {
  return {
    id: task.id,
    title: task.title,
    bot: task.botId === bot.id ? 'you' : `${getBot(task.botId)?.name ?? task.botId} (${task.botId})`,
    made_by: maker(task, bot),
    schedule: describeSchedule(task.schedule),
    paused: !task.enabled,
    next_run: task.nextRunAt ? when(task.nextRunAt) : null,
    last_run: task.lastRunAt ? `${when(task.lastRunAt)}, ${task.lastStatus}${task.lastError ? `: ${task.lastError}` : ''}` : null,
    you_can_change_it: mayChange(bot, task),
    prompt: task.prompt,
  }
}

const now = () => `${when(Date.now())} (${TIME_ZONE})`

export function listAs(bot: Bot): string {
  const tasks = visibleTo(bot)
  return JSON.stringify({ now: now(), tasks: tasks.map((t) => view(t, bot)) }, null, 1)
}

export function scheduleAs(bot: Bot, a: Record<string, any>): string {
  const schedule = scheduleFrom(a)
  if (!schedule) throw new Error('Say when the task runs: give one of at, in_minutes, time or every_minutes.')
  const task = createTask({ botId: target(bot, a.bot_id), title: a.title, prompt: a.prompt, schedule }, bot.id)
  return `Scheduled. It is now ${now()}.\n${JSON.stringify(view(task, bot), null, 1)}`
}

export function updateAs(bot: Bot, a: Record<string, any>): string {
  const task = changeable(bot, a.id)
  const patch: Record<string, unknown> = {}
  if (a.title !== undefined) patch.title = String(a.title)
  if (a.prompt !== undefined) patch.prompt = String(a.prompt)
  if (typeof a.paused === 'boolean') patch.enabled = !a.paused
  if (a.bot_id !== undefined && a.bot_id !== task.botId) patch.botId = target(bot, a.bot_id)
  const schedule = scheduleFrom(a)
  if (schedule) patch.schedule = schedule
  const saved = updateTask(task, patch)
  return `Changed. It is now ${now()}.\n${JSON.stringify(view(saved, bot), null, 1)}`
}

export function deleteAs(bot: Bot, id: unknown): string {
  const task = changeable(bot, id)
  deleteTask(task)
  return `Deleted the task "${task.title}".`
}
