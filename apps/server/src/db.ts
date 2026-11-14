import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Automation, HistoryMatch, Item, ItemData, Queued, Said, Thread } from '@openkumi/shared'
import type { Seen } from './watch.ts'
import { DATABASE, emit, privateDir } from './config.ts'

const db = new DatabaseSync(DATABASE)

db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS threads (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, parent_id TEXT, title TEXT NOT NULL, kind TEXT NOT NULL,
    status TEXT NOT NULL, model TEXT, reported INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS items_thread ON items (thread_id, id);
  CREATE INDEX IF NOT EXISTS threads_parent ON threads (parent_id);
  -- starts_on is what starts it (a time or a watch), last_check how a watch's latest look went, and
  -- seen what that look found, which only the server reads.
  CREATE TABLE IF NOT EXISTS automations (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, title TEXT NOT NULL, prompt TEXT NOT NULL, starts_on TEXT NOT NULL,
    enabled INTEGER NOT NULL, created_by TEXT NOT NULL, next_run_at INTEGER, last_run_at INTEGER,
    last_status TEXT, last_error TEXT, last_thread_id TEXT, last_check TEXT, seen TEXT,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  -- The number of each thread's latest change, from one count for all of them, and whether that
  -- change removed it. An app that has seen everything up to a change asks for what came after it.
  CREATE TABLE IF NOT EXISTS changes (thread_id TEXT PRIMARY KEY, seq INTEGER NOT NULL, removed INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX IF NOT EXISTS changes_seq ON changes (seq);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  -- Messages waiting for a bot, each in the queue of its thread. \`now\` is when the owner asked
  -- for one to be read ahead of the others (0: it waits its turn).
  CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, data TEXT NOT NULL, now INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS queue_thread ON queue (thread_id, id);
  -- A message between bots is found by its key, from the sender's record of it and back.
  CREATE INDEX IF NOT EXISTS items_key ON items (json_extract(data, '$.key')) WHERE json_extract(data, '$.key') IS NOT NULL;
`)

/**
 * This database's own id. A copy an app keeps of what it was sent from another database (the
 * server's data was started afresh) has change numbers that mean nothing here.
 */
db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('database', ?)`).run(`db_${crypto.randomBytes(9).toString('base64url')}`)
export const DATABASE_ID = (db.prepare(`SELECT value FROM meta WHERE key = 'database'`).get() as { value: string }).value

const nextChange = db.prepare(`
  INSERT INTO changes (thread_id, seq, removed) VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM changes), ?)
  ON CONFLICT (thread_id) DO UPDATE SET seq = excluded.seq, removed = excluded.removed
  RETURNING seq
`)
/** Notes that a thread changed, or was removed, and gives the number of that change. */
function changed(threadId: string, removed = false): number {
  return (nextChange.get(threadId, removed ? 1 : 0) as { seq: number }).seq
}

/** The number of the latest change to any thread. */
export const latestChange = () => (db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM changes').get() as { seq: number }).seq

const hasColumn = (name: string) => !!db.prepare(`SELECT 1 FROM pragma_table_info('threads') WHERE name = ?`).get(name)

// Threads run by an engine (Claude Code, Codex) remember the engine's own conversation here.
if (!hasColumn('session')) db.exec('ALTER TABLE threads ADD COLUMN session TEXT')

// A bot used to have any number of chats and now has one conversation. Of the chats it had, the
// one used last carries on as that conversation and the others are archived; nothing is deleted.
if (!hasColumn('archived_at')) {
  db.exec(`
    ALTER TABLE threads ADD COLUMN archived_at INTEGER;
    UPDATE threads SET archived_at = updated_at WHERE parent_id IS NULL AND id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY bot_id ORDER BY updated_at DESC, created_at DESC) AS place
        FROM threads WHERE parent_id IS NULL
      ) WHERE place = 1
    );
  `)
}

// A run of an automation works in a thread of its own, which knows which automation it is for.
if (!hasColumn('automation_id')) db.exec('ALTER TABLE threads ADD COLUMN automation_id TEXT')
// Every run is kept, so an automation's are found by an index rather than by reading them all.
db.exec('CREATE INDEX IF NOT EXISTS threads_automation ON threads (automation_id, created_at)')

// What waits for a bot that was stopped, or failed, is held back until the owner lets it go.
if (!hasColumn('held')) db.exec('ALTER TABLE threads ADD COLUMN held INTEGER NOT NULL DEFAULT 0')

// Nothing survives a restart mid-run, so no thread can still be running. That is a change like any
// other, or an app's copy would show those threads at work for good.
for (const { id } of db.prepare(`SELECT id FROM threads WHERE status = 'running'`).all() as { id: string }[]) {
  db.prepare(`UPDATE threads SET status = 'idle' WHERE id = ?`).run(id)
  changed(id)
}
db.exec(`UPDATE automations SET last_status = 'stopped' WHERE last_status = 'running'`)

/** What a conversation is called until its first message names it. */
export const UNTITLED = 'New chat'

const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(6).toString('base64url')}`

function toThread(r: any): Thread {
  return {
    id: r.id,
    botId: r.bot_id,
    parentId: r.parent_id,
    title: r.title,
    kind: r.kind,
    automationId: r.automation_id ?? null,
    archivedAt: r.archived_at ?? null,
    status: r.status,
    model: r.model,
    reported: !!r.reported,
    held: !!r.held,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function toItem(r: any): Item {
  return { id: r.id, threadId: r.thread_id, data: JSON.parse(r.data), createdAt: r.created_at }
}

// ---- bots (now folders; see bots.ts)

/** Bots from before they became folders, or null when this database has no such table. */
export function legacyBots(): Record<string, any>[] | null {
  const exists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bots'`).get()
  return exists ? db.prepare('SELECT * FROM bots ORDER BY created_at').all() : null
}

/** Sets the old table aside once its bots have been written out as folders. Nothing reads it again. */
export function retireLegacyBots() {
  db.exec('ALTER TABLE bots RENAME TO bots_imported')
}

// ---- threads

export function listThreads(): Thread[] {
  return db.prepare('SELECT * FROM threads ORDER BY created_at').all().map(toThread)
}

/** How long a subagent or a run of an automation stays in the apps' list after it last changed. */
export const RECENT = 60 * 60_000

/**
 * The threads the apps keep a list of: every conversation (the current ones, and the ones set
 * aside, which only the owner makes), and the subagents and runs of automations that are at work or
 * changed in the last hour, with the threads above them. Everything else stays here until it is
 * opened: a bot can leave thousands of runs and subagents behind.
 */
export function listedThreads(now = Date.now()): Thread[] {
  return withParents(db.prepare(`SELECT * FROM threads WHERE ${LISTED}`).all(now - RECENT).map(toThread))
}

const LISTED = `(parent_id IS NULL OR status = 'running' OR updated_at > ?)`

/** The threads of the list that changed after change `since`, and the ones removed since. */
export function changesSince(since: number, now = Date.now()): { threads: Thread[]; removed: string[] } {
  const threads = db
    .prepare(`SELECT t.* FROM changes c JOIN threads t ON t.id = c.thread_id WHERE c.seq > ? AND c.removed = 0 AND ${LISTED}`)
    .all(since, now - RECENT)
    .map(toThread)
  const removed = db.prepare('SELECT thread_id FROM changes WHERE seq > ? AND removed = 1').all(since) as { thread_id: string }[]
  return { threads: withParents(threads), removed: removed.map((r) => r.thread_id) }
}

/** The threads, with the ones above them that are not among them: a recent subagent of an older one is shown beneath it. */
function withParents(listed: Thread[]): Thread[] {
  const have = new Set(listed.map((t) => t.id))
  for (let i = 0; i < listed.length; i++) {
    const above = listed[i].parentId
    const parent = above && !have.has(above) ? getThread(above) : undefined
    if (!parent) continue
    have.add(parent.id)
    listed.push(parent)
  }
  return listed.sort((a, b) => a.createdAt - b.createdAt)
}

export function getThread(id: string): Thread | undefined {
  const r = db.prepare('SELECT * FROM threads WHERE id = ?').get(id)
  return r && toThread(r)
}

export function childrenOf(id: string): Thread[] {
  return db.prepare('SELECT * FROM threads WHERE parent_id = ? ORDER BY created_at').all(id).map(toThread)
}

/** The bot's conversation with its owner, if anything has been said in one yet. */
export function mainThread(botId: string): Thread | undefined {
  const r = db.prepare(`SELECT * FROM threads WHERE bot_id = ? AND parent_id IS NULL AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1`).get(botId)
  return r && toThread(r)
}

export function createThread(init: Pick<Thread, 'botId'> & Partial<Thread>): Thread {
  const now = Date.now()
  const t: Thread = {
    id: newId('t'),
    parentId: null,
    title: UNTITLED,
    kind: 'chat',
    automationId: null,
    archivedAt: null,
    status: 'idle',
    model: null,
    reported: false,
    held: false,
    createdAt: now,
    updatedAt: now,
    ...init,
  }
  db.prepare(
    `INSERT INTO threads (id, bot_id, parent_id, title, kind, automation_id, status, model, reported, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(t.id, t.botId, t.parentId, t.title, t.kind, t.automationId, t.status, t.model, t.reported ? 1 : 0, t.createdAt, t.updatedAt)
  emit({ type: 'thread.upsert', thread: t, seq: changed(t.id) })
  return t
}

export function updateThread(id: string, patch: Partial<Pick<Thread, 'title' | 'status' | 'reported' | 'archivedAt' | 'held'>>): Thread | undefined {
  const t = getThread(id)
  if (!t) return
  const next = { ...t, ...patch, updatedAt: Date.now() }
  db.prepare('UPDATE threads SET title = ?, status = ?, reported = ?, archived_at = ?, held = ?, updated_at = ? WHERE id = ?').run(
    next.title, next.status, next.reported ? 1 : 0, next.archivedAt, next.held ? 1 : 0, next.updatedAt, id,
  )
  emit({ type: 'thread.upsert', thread: next, seq: changed(id) })
  return next
}

/** An engine's own conversation for a thread, and how much of the thread it has been told about. */
export interface EngineSession {
  provider: string
  id: string
  /** The last item of the thread that the engine has seen or produced. */
  upTo: number
}

export function getSession(threadId: string): EngineSession | null {
  const row = db.prepare('SELECT session FROM threads WHERE id = ?').get(threadId) as { session: string | null } | undefined
  try {
    return row?.session ? JSON.parse(row.session) : null
  } catch {
    return null
  }
}

export function setSession(threadId: string, session: EngineSession | null) {
  db.prepare('UPDATE threads SET session = ? WHERE id = ?').run(session ? JSON.stringify(session) : null, threadId)
}

/** Deletes every conversation of a bot. */
export function deleteBotThreads(botId: string) {
  for (const t of listThreads().filter((t) => t.botId === botId && !t.parentId)) deleteThread(t.id)
  // Subagent threads this bot ran for other bots' chats.
  for (const t of listThreads().filter((t) => t.botId === botId)) deleteThread(t.id)
}

/** Deletes a thread and every subagent thread beneath it. */
export function deleteThread(id: string) {
  for (const child of childrenOf(id)) deleteThread(child.id)
  // The files sent in it go with it (the bot's own copies stay in its files).
  const botId = getThread(id)?.botId
  if (botId) fs.rmSync(path.join(privateDir(botId), 'attachments', id), { recursive: true, force: true })
  for (const waiting of queueOf(id)) removeQueued(waiting.id)
  db.prepare('DELETE FROM items WHERE thread_id = ?').run(id)
  db.prepare('DELETE FROM threads WHERE id = ?').run(id)
  emit({ type: 'thread.delete', id, seq: changed(id, true) })
}

// ---- items

export function listItems(threadId: string): Item[] {
  return db.prepare('SELECT * FROM items WHERE thread_id = ? ORDER BY id').all(threadId).map(toItem)
}

/**
 * How much of a thread an app is sent at a time. A page ends up a little past `items` or `bytes`,
 * so that it begins at something said to the bot and no turn is split; a single turn longer than
 * `most` items or `mostBytes` is cut where it reaches them.
 */
export const PAGE = { items: 100, bytes: 1_000_000, most: 400, mostBytes: 4_000_000 }

const ASKED = `json_extract(data, '$.type') = 'message' AND json_extract(data, '$.role') = 'user'`

/**
 * The newest page of a thread, or with `before` the page that comes before that item. With `from`
 * the page reaches back to that item at least, however far that is (a message found by searching).
 * `more` says whether anything older is left.
 */
export function pageOf(threadId: string, { before, from }: { before?: number; from?: number } = {}): { items: Item[]; more: boolean } {
  const next = db.prepare(`SELECT *, length(data) AS size, ${ASKED} AS asked FROM items WHERE thread_id = ? AND id < ? ORDER BY id DESC LIMIT 200`)
  const rows: any[] = []
  let bytes = 0
  let cursor = before ?? Number.MAX_SAFE_INTEGER
  read: for (;;) {
    const batch = next.all(threadId, cursor) as any[]
    for (const row of batch) {
      rows.push(row)
      bytes += row.size
      cursor = row.id
      if (from !== undefined && row.id > from) continue
      const full = rows.length >= PAGE.items || bytes >= PAGE.bytes
      if (full && (row.asked || rows.length >= PAGE.most || bytes >= PAGE.mostBytes)) break read
    }
    if (batch.length < 200) break
  }
  const oldest = rows.at(-1)?.id
  const more = oldest !== undefined && !!db.prepare('SELECT 1 FROM items WHERE thread_id = ? AND id < ? LIMIT 1').get(threadId, oldest)
  return { items: rows.reverse().map(toItem), more }
}

/**
 * The items of a thread after item `after`, for an app that holds the thread up to there. When more
 * came than a page holds, it gets the newest page instead, and `gap` says that it does not meet
 * what the app holds.
 */
export function itemsAfter(threadId: string, after: number): { items: Item[]; gap: boolean; more?: boolean } {
  const { n, bytes } = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(length(data)), 0) AS bytes FROM items WHERE thread_id = ? AND id > ?').get(threadId, after) as { n: number; bytes: number }
  if (n > PAGE.most || bytes > PAGE.mostBytes) return { ...pageOf(threadId), gap: true }
  return { items: db.prepare('SELECT * FROM items WHERE thread_id = ? AND id > ? ORDER BY id').all(threadId, after).map(toItem), gap: false }
}

export function hasItems(threadId: string): boolean {
  return !!db.prepare('SELECT 1 FROM items WHERE thread_id = ? LIMIT 1').get(threadId)
}

export function getItem(id: number): Item | undefined {
  const r = db.prepare('SELECT * FROM items WHERE id = ?').get(id)
  return r && toItem(r)
}

const MESSAGE = `json_extract(i.data, '$.type') = 'message'`

/** The messages of a thread around one of them: up to `before` earlier ones, the message itself, and up to `after` later ones. */
export function messagesAround(threadId: string, itemId: number, before: number, after: number): Item[] {
  const earlier = db.prepare(`SELECT * FROM items i WHERE thread_id = ? AND id < ? AND ${MESSAGE} ORDER BY id DESC LIMIT ?`).all(threadId, itemId, before)
  const later = db.prepare(`SELECT * FROM items i WHERE thread_id = ? AND id >= ? AND ${MESSAGE} ORDER BY id LIMIT ?`).all(threadId, itemId, after + 1)
  return [...earlier.reverse(), ...later].map(toItem)
}

/**
 * Messages in a bot's conversations (the current one and the archived ones) that contain every
 * word of `query`, newest first. What subagents said among themselves is not searched.
 */
export function searchMessages(botId: string, query: string, limit = 30): HistoryMatch[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)
  if (!words.length) return []
  const rows = db.prepare(
    `SELECT i.* FROM items i JOIN threads t ON t.id = i.thread_id
     WHERE t.bot_id = ? AND t.parent_id IS NULL AND ${MESSAGE}
       AND ${words.map(() => `json_extract(i.data, '$.text') LIKE ? ESCAPE '\\'`).join(' AND ')}
     ORDER BY i.id DESC LIMIT ?`,
  ).all(botId, ...words.map((w) => `%${w.replace(/[\\%_]/g, '\\$&')}%`), limit)
  return rows.map(toItem).map((item): HistoryMatch => {
    const data = item.data as Extract<ItemData, { type: 'message' }>
    const at = Math.max(0, data.text.toLowerCase().indexOf(words[0]))
    const start = Math.max(0, at - 80)
    const snippet = (start ? '…' : '') + data.text.slice(start, at + 200).replace(/\s+/g, ' ').trim() + (at + 200 < data.text.length ? '…' : '')
    return {
      threadId: item.threadId,
      itemId: item.id,
      from: data.role === 'assistant' ? 'bot' : data.source === 'user' ? 'user' : data.source === 'automation' ? 'automation' : data.source === 'bot' ? 'other' : 'subagent',
      ...(data.role === 'user' && data.source === 'bot' && data.bot ? { name: data.bot.name } : {}),
      snippet,
      createdAt: item.createdAt,
    }
  })
}

export function addItem(threadId: string, data: ItemData): Item {
  const createdAt = Date.now()
  const r = db.prepare('INSERT INTO items (thread_id, data, created_at) VALUES (?, ?, ?)').run(
    threadId, JSON.stringify(data), createdAt,
  )
  const item: Item = { id: Number(r.lastInsertRowid), threadId, data, createdAt }
  emit({ type: 'item.add', item })
  return item
}

/** Where a message between bots is, by its key: the sender's record of it ('sent') and the message as the other bot got it. */
export function itemsWithKey(key: string): Item[] {
  return db.prepare(`SELECT * FROM items WHERE json_extract(data, '$.key') = ? ORDER BY id`).all(key).map(toItem)
}

// ---- messages waiting for a bot (when each goes in is decided in agent.ts)

function toQueued(r: any): Queued {
  return { id: r.id, threadId: r.thread_id, message: JSON.parse(r.data), now: !!r.now, createdAt: r.created_at }
}

// The ones the owner asked to be read now go first, in the order they were asked for; then the rest, oldest first.
const IN_TURN = 'ORDER BY now = 0, now, id'

/** Every message that waits, oldest first. */
export function allQueued(): Queued[] {
  return db.prepare('SELECT * FROM queue ORDER BY id').all().map(toQueued)
}

/** The messages waiting in a thread, in the order they will go in. */
export function queueOf(threadId: string): Queued[] {
  return db.prepare(`SELECT * FROM queue WHERE thread_id = ? ${IN_TURN}`).all(threadId).map(toQueued)
}

export function getQueued(id: number): Queued | undefined {
  const r = db.prepare('SELECT * FROM queue WHERE id = ?').get(id)
  return r && toQueued(r)
}

/** The threads that have messages waiting. */
export function threadsWithQueue(): string[] {
  return (db.prepare('SELECT DISTINCT thread_id FROM queue').all() as { thread_id: string }[]).map((r) => r.thread_id)
}

export function addQueued(threadId: string, message: Said): Queued {
  const createdAt = Date.now()
  const r = db.prepare('INSERT INTO queue (thread_id, data, created_at) VALUES (?, ?, ?)').run(threadId, JSON.stringify(message), createdAt)
  const waiting: Queued = { id: Number(r.lastInsertRowid), threadId, message, now: false, createdAt }
  emit({ type: 'queue.upsert', message: waiting })
  return waiting
}

/** Changes a waiting message: what it will say (its files got their paths), or that it is to be read now. */
export function updateQueued(id: number, patch: { message?: Said; now?: boolean }): Queued | undefined {
  const was = getQueued(id)
  if (!was) return
  if (patch.message) db.prepare('UPDATE queue SET data = ? WHERE id = ?').run(JSON.stringify(patch.message), id)
  if (patch.now !== undefined && patch.now !== was.now) db.prepare('UPDATE queue SET now = ? WHERE id = ?').run(patch.now ? Date.now() : 0, id)
  const waiting = getQueued(id)!
  emit({ type: 'queue.upsert', message: waiting })
  return waiting
}

export function removeQueued(id: number) {
  db.prepare('DELETE FROM queue WHERE id = ?').run(id)
  emit({ type: 'queue.remove', id })
}

// ---- automations (the rules for them are in automations.ts)

function toAutomation(r: any): Automation {
  return {
    id: r.id,
    botId: r.bot_id,
    title: r.title,
    prompt: r.prompt,
    trigger: JSON.parse(r.starts_on),
    enabled: !!r.enabled,
    createdBy: r.created_by,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    lastError: r.last_error,
    lastThreadId: r.last_thread_id,
    lastCheck: r.last_check ? JSON.parse(r.last_check) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export const newAutomationId = () => newId('auto')

export function listAutomations(): Automation[] {
  return db.prepare('SELECT * FROM automations ORDER BY created_at').all().map(toAutomation)
}

export function getAutomation(id: string): Automation | undefined {
  const r = db.prepare('SELECT * FROM automations WHERE id = ?').get(id)
  return r && toAutomation(r)
}

/** Writes an automation as it is given, new or changed. What its watch last saw is kept apart (setSeen). */
export function saveAutomation(automation: Automation): Automation {
  const a = { ...automation, updatedAt: Date.now() }
  db.prepare(
    `INSERT INTO automations (id, bot_id, title, prompt, starts_on, enabled, created_by, next_run_at, last_run_at, last_status, last_error, last_thread_id, last_check, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET bot_id = excluded.bot_id, title = excluded.title, prompt = excluded.prompt, starts_on = excluded.starts_on,
       enabled = excluded.enabled, next_run_at = excluded.next_run_at, last_run_at = excluded.last_run_at, last_status = excluded.last_status,
       last_error = excluded.last_error, last_thread_id = excluded.last_thread_id, last_check = excluded.last_check, updated_at = excluded.updated_at`,
  ).run(a.id, a.botId, a.title, a.prompt, JSON.stringify(a.trigger), a.enabled ? 1 : 0, a.createdBy, a.nextRunAt, a.lastRunAt, a.lastStatus, a.lastError, a.lastThreadId, a.lastCheck ? JSON.stringify(a.lastCheck) : null, a.createdAt, a.updatedAt)
  emit({ type: 'automation.upsert', automation: a })
  return a
}

export function deleteAutomation(id: string) {
  db.prepare('DELETE FROM automations WHERE id = ?').run(id)
  emit({ type: 'automation.delete', id })
}

/** What an automation's watch found at its last look that worked. The apps are never sent it. */
export function getSeen(id: string): Seen | null {
  const r = db.prepare('SELECT seen FROM automations WHERE id = ?').get(id) as { seen: string | null } | undefined
  return r?.seen ? JSON.parse(r.seen) : null
}

export function setSeen(id: string, seen: Seen | null) {
  db.prepare('UPDATE automations SET seen = ? WHERE id = ?').run(seen ? JSON.stringify(seen) : null, id)
}

/** The automations that are due by `time` (a run, or a watch's look), soonest first. */
export function dueAutomations(time: number): Automation[] {
  return db.prepare('SELECT * FROM automations WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at').all(time).map(toAutomation)
}

/** The runs of an automation, newest first, `limit` at a time: the ones that started before `before`. `more` says whether older ones are left. */
export function runsOf(automationId: string, { before, limit = 20 }: { before?: number; limit?: number } = {}): { runs: Thread[]; more: boolean } {
  const rows = db
    .prepare('SELECT * FROM threads WHERE automation_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?')
    .all(automationId, before ?? Number.MAX_SAFE_INTEGER, limit + 1)
    .map(toThread)
  return { runs: rows.slice(0, limit), more: rows.length > limit }
}

/** When the next automation is due, or null when none is. */
export function nextDue(): number | null {
  const r = db.prepare('SELECT MIN(next_run_at) AS at FROM automations WHERE enabled = 1 AND next_run_at IS NOT NULL').get() as { at: number | null }
  return r.at
}

export function closeDb() {
  db.close()
}
