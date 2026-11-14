// Automations: a prompt a bot is given without being asked, at set times, when something it
// watches changes (watch.ts), or when one of its apps calls (hooks.ts). Each run happens in the background, in a thread of its own beneath the
// bot's conversation (as a subagent's would), and what came of it is passed to the conversation for
// the bot to tell the user. The owner makes automations in the app; bots make them with their
// tools, within the rules at the end of this file: a bot makes them only for itself and changes or
// deletes only what it made, except the main assistant (the first bot), which may do all of that
// for every bot.
import type { Automation, Bot, Schedule, Thread, Trigger, Watch } from '@openkumi/shared'
import * as agent from './agent.ts'
import { getBot, listBots } from './bots.ts'
import * as db from './db.ts'
import * as hooks from './hooks.ts'
import * as watching from './watch.ts'

/** The shortest time, in minutes, between two runs of an automation that repeats. */
export const MIN_INTERVAL = 5
/** How late a run at a time of day may still start, after the computer was asleep or off. Any later and it is missed. */
const GRACE = 10 * 60_000
/** How long a watch's looks may go on failing before it is paused. Long, because a computer that is offline fails every look and nothing is wrong. */
const PATIENCE = 24 * 60 * 60_000
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

/** When an automation on this schedule runs next after `after`, or null when it does not. */
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

const minutes = (n: number) => {
  const hours = n / 60
  return Number.isInteger(hours) ? (hours === 1 ? 'hour' : `${hours} hours`) : `${n} minutes`
}

/** A schedule in words, e.g. "every weekday at 08:00". */
export function describeSchedule(s: Schedule): string {
  if (s.type === 'once') return `once, on ${when(s.at)}`
  if (s.type === 'interval') return `every ${minutes(s.minutes)}`
  const days = s.days.join()
  const on = !s.days.length ? 'every day' : days === '1,2,3,4,5' ? 'every weekday' : days === '0,6' ? 'at weekends' : `every ${s.days.map((d) => DAY_NAMES[d]).join(', ')}`
  return `${on} at ${s.time}`
}

/** What starts an automation, in words. */
export function describeTrigger(t: Trigger): string {
  if (t.kind === 'time') return describeSchedule(t.schedule)
  if (t.kind === 'hook') return `when ${t.hook.app} calls${t.hook.events.length ? ` about ${t.hook.events.join(', ')}` : ''}`
  return `when ${watching.describeWatch(t.watch)} changes, looked at every ${minutes(t.watch.every)}`
}

/** A schedule from what was sent, checked. */
export function cleanSchedule(input: any): Schedule {
  if (input?.type === 'once') {
    const at = Number(input.at)
    if (!Number.isFinite(at) || at <= 0) throw new Error('An automation that runs once needs a date and time.')
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
    if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL) throw new Error(`An automation can repeat at most every ${MIN_INTERVAL} minutes.`)
    return { type: 'interval', minutes: Math.min(minutes, 366 * 24 * 60) }
  }
  throw new Error('A schedule is "once", "daily" or "interval".')
}

/** A trigger from what was sent, checked. A watch is checked as the bot that will do it: the tool has to be one of its own. */
async function cleanTrigger(botId: string, input: any): Promise<Trigger> {
  if (input?.kind === 'time') return { kind: 'time', schedule: cleanSchedule(input.schedule) }
  if (input?.kind === 'watch') return { kind: 'watch', watch: await watching.cleanWatch(botId, input.watch) }
  if (input?.kind === 'hook') return { kind: 'hook', hook: hooks.cleanHook(botId, input.hook) }
  throw new Error('An automation starts at a "time", on a "watch" or on a "hook".')
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
/** What a trigger looks at, apart from how often: a watch that only looks more or less often still knows what it saw. */
const looksAt = (t: Trigger) => (t.kind === 'watch' ? { ...t.watch, every: 0 } : null)

// ---- making and changing automations

/**
 * Checks an automation and works out when it runs next. A trigger that did not change keeps the
 * run (or the look) it had coming; a new one, or an automation that was paused, starts counting
 * from now. A watch that is resumed looks at once, to catch up with what changed while it was off,
 * and one that starts on a webhook's calls is given the calls that came meanwhile. Otherwise that
 * one has no time coming: it waits for a call.
 */
function checked(automation: Automation, before?: Automation): Automation {
  const title = String(automation.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  const prompt = String(automation.prompt ?? '').trim().slice(0, 8000)
  if (!title) throw new Error('An automation needs a name.')
  if (!prompt) throw new Error('An automation needs a prompt: what the bot should do each time.')
  if (!getBot(automation.botId)) throw new Error(`No bot with id ${automation.botId}.`)
  const { trigger } = automation
  const changed = !before || !same(before.trigger, trigger)
  let nextRunAt: number | null = null
  if (!automation.enabled) nextRunAt = null
  else if (before && !changed && before.enabled) nextRunAt = before.nextRunAt
  else if (trigger.kind === 'watch') nextRunAt = Date.now() + (changed ? trigger.watch.every * 60_000 : 0)
  else if (trigger.kind === 'hook') nextRunAt = changed ? null : Date.now()
  else {
    nextRunAt = nextRun(trigger.schedule, Date.now())
    if (nextRunAt === null) throw new Error('That time has already passed.')
  }
  return { ...automation, title, prompt, nextRunAt }
}

/** A first look at what a watch watches, which notes where things stand without starting a run. */
async function baseline(automation: Automation): Promise<{ automation: Automation; reading: watching.Reading | null }> {
  if (automation.trigger.kind !== 'watch') return { automation: { ...automation, lastCheck: null }, reading: null }
  const reading = await watching.read(automation.botId, automation.trigger.watch)
  return { automation: { ...automation, lastCheck: { at: Date.now(), ...watching.compare(null, reading) } }, reading }
}

/** Makes an automation. `by` is 'user' for the owner, or the id of the bot that is making it. */
export async function createAutomation(input: Record<string, any>, by: string): Promise<Automation> {
  const now = Date.now()
  const botId = String(input.botId ?? '')
  if (!getBot(botId)) throw new Error(`No bot with id ${botId}.`)
  const draft = checked({
    id: db.newAutomationId(),
    botId,
    title: input.title,
    prompt: input.prompt,
    trigger: await cleanTrigger(botId, input.trigger),
    enabled: input.enabled !== false,
    createdBy: by,
    nextRunAt: null,
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
    lastThreadId: null,
    lastCheck: null,
    createdAt: now,
    updatedAt: now,
  })
  // A watch that cannot be looked at is refused here, where whoever is making it can still put it right.
  const { automation, reading } = await baseline(draft)
  const saved = db.saveAutomation(automation)
  if (reading) db.setSeen(saved.id, reading)
  // One that starts on a webhook's calls is for the calls from now on.
  if (saved.trigger.kind === 'hook') db.setCursor(saved.id, db.lastHookEvent())
  plan()
  return saved
}

/** Changes what an automation is and what starts it. Who made it, and how it last went, stay as they were. */
export async function updateAutomation(automation: Automation, patch: Record<string, any>): Promise<Automation> {
  const next = { ...automation }
  if (typeof patch.botId === 'string') next.botId = patch.botId
  if (typeof patch.title === 'string') next.title = patch.title
  if (typeof patch.prompt === 'string') next.prompt = patch.prompt
  if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled
  if (!getBot(next.botId)) throw new Error(`No bot with id ${next.botId}.`)
  // Moved to another bot, a watched tool has to be one that bot has too, and so has a webhook; one turned on again has to be there still.
  const resumed = next.enabled && !automation.enabled
  if (patch.trigger !== undefined || next.botId !== automation.botId || (resumed && next.trigger.kind === 'hook')) next.trigger = await cleanTrigger(next.botId, patch.trigger ?? next.trigger)
  const draft = checked(next, automation)
  // A watch on something else, or by another bot's account, starts from where things stand now.
  if (draft.trigger.kind !== automation.trigger.kind || !same(looksAt(draft.trigger), looksAt(automation.trigger)) || draft.botId !== automation.botId) {
    const { automation: looked, reading } = await baseline(draft)
    const saved = db.saveAutomation(looked)
    db.setSeen(saved.id, reading)
    if (saved.trigger.kind === 'hook') db.setCursor(saved.id, db.lastHookEvent())
    plan()
    return saved
  }
  const saved = db.saveAutomation(draft)
  // Other events of the same webhook: from now on, like a new one.
  if (saved.trigger.kind === 'hook' && !same(saved.trigger, automation.trigger)) db.setCursor(saved.id, db.lastHookEvent())
  // Turned on again, a watch that was paused for failing is given its time again.
  const seen = db.getSeen(saved.id)
  if (seen?.failingSince && resumed) db.setSeen(saved.id, { ...seen, failingSince: undefined })
  plan()
  return saved
}

/** A run that is under way when its automation is deleted finishes, and is reported as usual. */
export function deleteAutomation(automation: Automation) {
  db.deleteAutomation(automation.id)
  plan()
}

/** Removes the automations a bot does, when the bot is deleted. Ones it made for other bots stay theirs. */
export function forgetBot(botId: string) {
  for (const automation of db.listAutomations()) if (automation.botId === botId) db.deleteAutomation(automation.id)
  plan()
}

// ---- running them

/** Whether the run an automation started last is still at work. */
const stillRunning = (automation: Automation) => !!automation.lastThreadId && agent.isRunning(automation.lastThreadId)

/**
 * Starts a run: a thread beneath the bot's conversation, given the automation's prompt and, for a
 * watch, what changed. A run the clock starts moves the automation on to its next time; one started
 * by hand, or by a watch (which keeps its own time), leaves that as it was.
 */
function start(automation: Automation, scheduled: boolean, told = ''): Automation {
  const now = Date.now()
  const next = scheduled && automation.trigger.kind === 'time' ? nextRun(automation.trigger.schedule, now) : automation.nextRunAt
  if (stillRunning(automation)) {
    if (!scheduled) throw new Error('This automation is still running from last time.')
    // Runs do not pile up: while one is at work, the next is let go.
    return db.saveAutomation({ ...automation, nextRunAt: next })
  }
  const conversation = agent.conversation(automation.botId)
  const thread = db.createThread({ botId: automation.botId, parentId: conversation.id, kind: 'automation', automationId: automation.id, title: automation.title })
  const saved = db.saveAutomation({ ...automation, nextRunAt: next, lastRunAt: now, lastStatus: 'running', lastError: null, lastThreadId: thread.id })
  agent.postMessage(thread.id, { source: 'trigger', text: automation.prompt + told })
  // Every run is kept, however many there are; the apps are only ever sent a page of them.
  return saved
}

/** Runs an automation now, whether or not it is paused, without changing when it runs next. */
export function runNow(automation: Automation): Automation {
  const { trigger } = automation
  return start(automation, false, trigger.kind === 'watch' ? watching.note(trigger.watch, null) : trigger.kind === 'hook' ? hooks.note(trigger.hook, null) : '')
}

// ---- starting on a webhook's calls

/**
 * A bot's webhook took a call about `event`. The automations that start on it and are waiting are
 * made due at once; one that ran a moment ago already has its next time, and is given the call then.
 */
export function called(botId: string, power: string, event: string) {
  let woken = false
  for (const automation of db.listAutomations()) {
    const { trigger } = automation
    if (automation.botId !== botId || !automation.enabled || automation.nextRunAt !== null || trigger.kind !== 'hook' || trigger.hook.power !== power) continue
    if (trigger.hook.events.length && !trigger.hook.events.includes(event)) continue
    db.saveAutomation({ ...automation, nextRunAt: Date.now() })
    woken = true
  }
  if (woken) plan()
}

/** A bot's webhook was removed: the automations that started on its calls are paused, since none will come. */
export function unhooked(botId: string, power: string) {
  for (const automation of db.listAutomations()) {
    const { trigger } = automation
    if (automation.botId === botId && automation.enabled && trigger.kind === 'hook' && trigger.hook.power === power) db.saveAutomation({ ...automation, enabled: false, nextRunAt: null })
  }
  plan()
}

/**
 * Gives an automation the calls of its webhook that it has not had yet, in one run, and has it look
 * again after the shortest time between two runs for what came meanwhile: so calls that come close
 * together are answered together. With none left, it goes back to waiting.
 */
function fire(automation: Automation, hook: Extract<Trigger, { kind: 'hook' }>['hook']): Automation {
  const now = Date.now()
  const events = hooks.pending(automation.botId, hook, db.getCursor(automation.id))
  if (!events.length) return db.saveAutomation({ ...automation, nextRunAt: null })
  // While its last run is at work the calls wait, and the next run is given them together.
  if (stillRunning(automation)) return db.saveAutomation({ ...automation, nextRunAt: now + 60_000 })
  db.setCursor(automation.id, events.at(-1)!.id)
  return start({ ...automation, nextRunAt: now + MIN_INTERVAL * 60_000 }, true, hooks.note(hook, events))
}

/** The watches being looked at right now, so that none is looked at twice at once. */
const looking = new Set<string>()

/**
 * Looks at what a watch watches, and starts a run when it changed. `byHand` is the owner asking for
 * a look now, which a paused watch gets too. Nothing is lost by a look that cannot happen: the next
 * one is compared with the same last look.
 */
export async function check(automation: Automation, byHand = false): Promise<Automation> {
  const { trigger } = automation
  if (trigger.kind !== 'watch') throw new Error('Only an automation that watches something can be looked at.')
  if (looking.has(automation.id) || stillRunning(automation)) {
    if (byHand) throw new Error(looking.has(automation.id) ? 'It is being looked at right now.' : 'This automation is still running from last time.')
    return automation
  }
  looking.add(automation.id)
  try {
    const seen = db.getSeen(automation.id)
    let reading: watching.Reading | undefined
    let failure: unknown
    try {
      reading = await watching.read(automation.botId, trigger.watch)
    } catch (e) {
      failure = e
    }
    // Changed, paused or deleted while the look was under way: what was found is for a watch that is no more.
    const current = db.getAutomation(automation.id)
    if (!current || !same(current.trigger, trigger) || current.botId !== automation.botId || (!current.enabled && !byHand)) return current ?? automation
    if (!reading) return failed(current, seen, failure)
    const result = watching.compare(seen?.fingerprint ? seen : null, reading)
    db.setSeen(current.id, reading)
    const saved = db.saveAutomation({ ...current, lastCheck: { at: Date.now(), ...result } })
    return result.outcome === 'changed' ? start(saved, true, watching.note(trigger.watch, { detail: result.detail })) : saved
  } finally {
    looking.delete(automation.id)
  }
}

/**
 * A look that failed. One that may pass (the service is down, the computer is offline) is tried
 * again at the next look, and the automation says so in the app. When looks have failed for a whole
 * day, or the watch cannot work as it is set up, the automation is paused and the bot is told, to
 * pass it on.
 */
function failed(automation: Automation, seen: watching.Seen | null, error: unknown): Automation {
  const reason = String((error as Error)?.message ?? error).split('\n')[0]
  const failingSince = seen?.failingSince ?? Date.now()
  db.setSeen(automation.id, { ...(seen ?? { fingerprint: '' }), failingSince })
  const pause = automation.enabled && (error instanceof watching.WatchError || Date.now() - failingSince >= PATIENCE)
  const saved = db.saveAutomation({ ...automation, lastCheck: { at: Date.now(), outcome: 'failed', detail: reason }, ...(pause ? { enabled: false, nextRunAt: null } : {}) })
  if (pause) {
    agent.postMessage(agent.conversation(automation.botId).id, {
      source: 'automation',
      text: `<automation_result>\nAutomation "${automation.title}" (automation: ${automation.id}) — paused\nIt was paused because what it watches could not be looked at: ${reason}\nNothing ran. Once that is put right it can be turned on again, and it will catch up with what changed meanwhile.\n</automation_result>`,
    })
    plan()
  }
  return saved
}

let timer: NodeJS.Timeout | undefined

/** Sets the timer for the next automation that is due. It wakes at least once a minute, so a computer waking from sleep, or a clock that was changed, is noticed. */
function plan() {
  clearTimeout(timer)
  const due = db.nextDue()
  if (due === null) return
  timer = setTimeout(tick, Math.min(Math.max(due - Date.now(), 0), 60_000))
  timer.unref()
}

function tick() {
  const now = Date.now()
  for (const automation of db.dueAutomations(now)) {
    const { trigger } = automation
    try {
      if (!getBot(automation.botId)) {
        db.deleteAutomation(automation.id)
        continue
      }
      if (trigger.kind === 'watch') {
        // Its next look is set first: this one takes a while, and must not be started again meanwhile.
        void check(db.saveAutomation({ ...automation, nextRunAt: now + trigger.watch.every * 60_000 })).catch((e) => console.error('A watch could not be looked at:', e))
      } else if (trigger.kind === 'hook') {
        fire(automation, trigger.hook)
      } else if (trigger.schedule.type === 'daily' && now - automation.nextRunAt! > GRACE) {
        // A run at a time of day that would start long after that time (the computer was asleep or
        // off) is no longer what was asked for: it is noted as missed, and the next one is awaited.
        db.saveAutomation({ ...automation, lastStatus: 'missed', lastRunAt: automation.nextRunAt, lastError: null, nextRunAt: nextRun(trigger.schedule, now) })
      } else start(automation, true)
    } catch (e: any) {
      const next = trigger.kind === 'time' ? nextRun(trigger.schedule, now) : trigger.kind === 'watch' ? now + trigger.watch.every * 60_000 : null
      db.saveAutomation({ ...automation, lastStatus: 'failed', lastError: String(e?.message ?? e), nextRunAt: next })
    }
  }
  plan()
}

/** Starts the clock. Runs and looks that fell due while OpenKumi was not running are dealt with at once. */
export function startAutomations() {
  tick()
}

/** A run has ended: notes how it went, and passes what came of it to the bot's conversation. */
export function finishRun(thread: Thread) {
  const { status, body } = agent.outcome(thread)
  const automation = thread.automationId ? db.getAutomation(thread.automationId) : undefined
  if (automation && automation.lastThreadId === thread.id) {
    db.saveAutomation({ ...automation, lastStatus: status, lastError: status === 'failed' ? body.replace(/^Error: /, '') : null })
  }
  // Stopped by the owner, or already passed on (the owner wrote in the run afterwards).
  if (thread.reported || status === 'stopped') return
  db.updateThread(thread.id, { reported: true })
  if (status === 'completed' && NOTHING.test(body.trim())) return
  const conversation = agent.conversation(thread.botId)
  agent.postMessage(conversation.id, {
    source: 'automation',
    text: `<automation_result>\nAutomation "${thread.title}" (automation: ${thread.automationId}, run: ${thread.id}) — ${status}\n${body}\n</automation_result>`,
  })
}

// ---- what bots may do

/** The main assistant: the first bot, which may make, see, change and delete automations for every bot. */
export const mainBot = (): Bot | undefined => listBots()[0]
export const isMain = (bot: Bot) => bot.id === mainBot()?.id

/** The automations a bot can see: those it does and those it made. The main assistant sees them all. */
function visibleTo(bot: Bot): Automation[] {
  const main = isMain(bot)
  return db.listAutomations().filter((a) => main || a.botId === bot.id || a.createdBy === bot.id)
}

const maker = (automation: Automation, bot: Bot) =>
  automation.createdBy === 'user' ? 'the user' : automation.createdBy === bot.id ? 'you' : (getBot(automation.createdBy)?.name ?? `a bot that was deleted (${automation.createdBy})`)

const mayChange = (bot: Bot, automation: Automation) => isMain(bot) || automation.createdBy === bot.id

/** The automation with this id, if the bot may change or delete it; otherwise an error that says why not. */
function changeable(bot: Bot, id: unknown): Automation {
  const automation = visibleTo(bot).find((a) => a.id === id)
  if (!automation) throw new Error(`You have no automation with id ${id}. Use list_automations.`)
  if (!mayChange(bot, automation)) {
    throw new Error(`You did not make the automation "${automation.title}" (${maker(automation, bot)} did), so you cannot change or delete it. Only the main assistant, ${mainBot()?.name}, can.`)
  }
  return automation
}

/** The bot an automation a bot makes is for: the bot itself, unless it is the main assistant. */
function target(bot: Bot, botId: unknown): string {
  if (botId === undefined || botId === null || botId === '' || botId === bot.id) return bot.id
  if (!isMain(bot)) throw new Error(`Only the main assistant, ${mainBot()?.name}, can make automations for other bots. You can make them for yourself.`)
  if (!getBot(String(botId))) throw new Error(`No bot with id ${botId}. Use list_bots.`)
  return String(botId)
}

function dayNumber(day: unknown): number {
  const at = DAYS.indexOf(String(day).trim().slice(0, 3).toLowerCase())
  if (at < 0) throw new Error(`"${day}" is not a day of the week. Use mon, tue, wed, thu, fri, sat or sun.`)
  return at
}

const given = (value: unknown) => value !== undefined && value !== null && value !== ''

/** The schedule a bot asked for with its tool's arguments, or null when it gave none. */
function scheduleFrom(a: Record<string, any>): Schedule | null {
  const times = ['at', 'in_minutes', 'time', 'every_minutes'].filter((k) => given(a[k]))
  if (!times.length) {
    if (a.days !== undefined) throw new Error('days goes with time.')
    return null
  }
  if (times.length > 1) throw new Error(`Give only one of at, in_minutes, time and every_minutes (you gave ${times.join(' and ')}).`)
  if (given(a.at)) {
    // Without an offset, a date and time is read as this computer's local time.
    const at = Date.parse(String(a.at).trim().replace(' ', 'T'))
    if (Number.isNaN(at)) throw new Error('at must be a local date and time, like "2026-11-14 09:30".')
    return { type: 'once', at }
  }
  if (given(a.in_minutes)) {
    const minutes = Number(a.in_minutes)
    if (!(minutes > 0)) throw new Error('in_minutes must be more than 0.')
    return { type: 'once', at: Date.now() + Math.round(minutes * 60_000) }
  }
  if (given(a.time)) {
    const days = a.days === undefined || a.days === null ? [] : (Array.isArray(a.days) ? a.days : [a.days]).map(dayNumber)
    return cleanSchedule({ type: 'daily', time: String(a.time), days })
  }
  return cleanSchedule({ type: 'interval', minutes: a.every_minutes })
}

/** What a bot asked for with its tool's arguments to start an automation, still to be checked, or null when it gave nothing. */
function triggerFrom(a: Record<string, any>): Record<string, unknown> | null {
  const schedule = scheduleFrom(a)
  if (given(a.hook)) {
    if (schedule || given(a.watch)) throw new Error('An automation that starts when an app calls takes no time and no watch. Give hook, or watch, or one of at, in_minutes, time and every_minutes.')
    let hook = a.hook
    if (typeof hook === 'string') {
      try {
        hook = JSON.parse(hook)
      } catch {
        hook = null
      }
    }
    if (!hook || typeof hook !== 'object' || !given(hook.app)) throw new Error('hook is an object like {"app": "linear", "events": ["issue.created"]}. list_automations names the apps that can call and what each calls about.')
    return { kind: 'hook', hook: { power: hook.app, events: hook.events } }
  }
  if (!given(a.watch)) return schedule && { kind: 'time', schedule }
  if (schedule) throw new Error('A watch takes no time of its own: it looks every watch.every_minutes minutes. Give a watch, or one of at, in_minutes, time and every_minutes.')
  let watch = a.watch
  // Some models write an object out as text.
  if (typeof watch === 'string') {
    try {
      watch = JSON.parse(watch)
    } catch {
      watch = null
    }
  }
  const example = 'watch is an object like {"tool": "mcp__linear__list_issues", "arguments": {"assignee": "me"}, "track": ["id", "status"]} or {"url": "https://example.com/prices"}.'
  if (!watch || typeof watch !== 'object' || Array.isArray(watch)) throw new Error(example)
  if (given(watch.tool) === given(watch.url)) throw new Error(`A watch is on one of your tools (watch.tool) or on a web address (watch.url), one of the two. ${example}`)
  const on = given(watch.url) ? { on: 'page', url: watch.url } : { on: 'tool', tool: watch.tool, arguments: watch.arguments }
  return { kind: 'watch', watch: { ...on, track: watch.track, every: watch.every_minutes } }
}

const seenAt = (check: NonNullable<Automation['lastCheck']>) =>
  `${when(check.at)}, ${check.outcome === 'baseline' ? 'first look' : check.outcome}${check.detail && check.outcome !== 'changed' ? `: ${check.detail}` : ''}`

/** An automation as a bot is shown it. */
function view(automation: Automation, bot: Bot) {
  const { trigger } = automation
  const watch = trigger.kind === 'watch' ? trigger.watch : null
  return {
    id: automation.id,
    title: automation.title,
    bot: automation.botId === bot.id ? 'you' : `${getBot(automation.botId)?.name ?? automation.botId} (${automation.botId})`,
    made_by: maker(automation, bot),
    runs: describeTrigger(trigger),
    ...(watch ? { watch: watched(watch) } : {}),
    ...(trigger.kind === 'hook' ? { hook: { app: trigger.hook.power, ...(trigger.hook.events.length ? { events: trigger.hook.events } : {}) } } : {}),
    paused: !automation.enabled,
    ...(watch ? { next_look: automation.nextRunAt ? when(automation.nextRunAt) : null, last_look: automation.lastCheck ? seenAt(automation.lastCheck) : null } : { next_run: automation.nextRunAt ? when(automation.nextRunAt) : null }),
    last_run: automation.lastRunAt ? `${when(automation.lastRunAt)}, ${automation.lastStatus}${automation.lastError ? `: ${automation.lastError}` : ''}` : null,
    you_can_change_it: mayChange(bot, automation),
    prompt: automation.prompt,
  }
}

/** A watch as a bot gave it, so that it can give it again with a part changed. */
const watched = (watch: Watch) => ({
  ...(watch.on === 'tool' ? { tool: watch.tool, arguments: watch.arguments } : { url: watch.url }),
  ...(watch.track.length ? { track: watch.track } : {}),
  every_minutes: watch.every,
})

const now = () => `${when(Date.now())} (${TIME_ZONE})`

export function listAs(bot: Bot): string {
  const automations = visibleTo(bot)
  const calling = hooks.availableTo(bot.id)
  return JSON.stringify({ now: now(), automations: automations.map((a) => view(a, bot)), ...(calling.length ? { apps_that_call_you: calling } : {}) }, null, 1)
}

export async function createAs(bot: Bot, a: Record<string, any>): Promise<string> {
  const trigger = triggerFrom(a)
  if (!trigger) throw new Error('Say what starts it: give one of at, in_minutes, time or every_minutes, or a watch, or a hook.')
  const automation = await createAutomation({ botId: target(bot, a.bot_id), title: a.title, prompt: a.prompt, trigger }, bot.id)
  const { trigger: starts } = automation
  const made = starts.kind === 'watch' ? `Watching. ${automation.lastCheck?.detail ?? ''}` : starts.kind === 'hook' ? `Waiting for ${starts.hook.app} to call.` : 'Scheduled.'
  return `${made.trim()} It is now ${now()}.\n${JSON.stringify(view(automation, bot), null, 1)}`
}

export async function updateAs(bot: Bot, a: Record<string, any>): Promise<string> {
  const automation = changeable(bot, a.id)
  const patch: Record<string, unknown> = {}
  if (a.title !== undefined) patch.title = String(a.title)
  if (a.prompt !== undefined) patch.prompt = String(a.prompt)
  if (typeof a.paused === 'boolean') patch.enabled = !a.paused
  if (a.bot_id !== undefined && a.bot_id !== automation.botId) patch.botId = target(bot, a.bot_id)
  const trigger = triggerFrom(a)
  if (trigger) patch.trigger = trigger
  const saved = await updateAutomation(automation, patch)
  return `Changed. It is now ${now()}.\n${JSON.stringify(view(saved, bot), null, 1)}`
}

export function deleteAs(bot: Bot, id: unknown): string {
  const automation = changeable(bot, id)
  deleteAutomation(automation)
  return `Deleted the automation "${automation.title}".`
}
