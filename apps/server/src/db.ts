import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { HistoryMatch, Item, ItemData, ScheduledTask, Thread } from '@openbot/shared'
import { HOME, emit, privateDir } from './config.ts'

const db = new DatabaseSync(path.join(HOME, 'openbot.db'))

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
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, title TEXT NOT NULL, prompt TEXT NOT NULL, schedule TEXT NOT NULL,
    enabled INTEGER NOT NULL, created_by TEXT NOT NULL, next_run_at INTEGER, last_run_at INTEGER,
    last_status TEXT, last_error TEXT, last_thread_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
`)

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

// A run of a scheduled task works in a thread of its own, which knows which task it is for.
if (!hasColumn('task_id')) db.exec('ALTER TABLE threads ADD COLUMN task_id TEXT')

// Nothing survives a restart mid-run, so no thread can still be running.
db.exec(`UPDATE threads SET status = 'idle' WHERE status = 'running'`)
db.exec(`UPDATE tasks SET last_status = 'stopped' WHERE last_status = 'running'`)

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
    taskId: r.task_id ?? null,
    archivedAt: r.archived_at ?? null,
    status: r.status,
    model: r.model,
    reported: !!r.reported,
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
    taskId: null,
    archivedAt: null,
    status: 'idle',
    model: null,
    reported: false,
    createdAt: now,
    updatedAt: now,
    ...init,
  }
  db.prepare(
    `INSERT INTO threads (id, bot_id, parent_id, title, kind, task_id, status, model, reported, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(t.id, t.botId, t.parentId, t.title, t.kind, t.taskId, t.status, t.model, t.reported ? 1 : 0, t.createdAt, t.updatedAt)
  emit({ type: 'thread.upsert', thread: t })
  return t
}

export function updateThread(id: string, patch: Partial<Pick<Thread, 'title' | 'status' | 'reported' | 'archivedAt'>>): Thread | undefined {
  const t = getThread(id)
  if (!t) return
  const next = { ...t, ...patch, updatedAt: Date.now() }
  db.prepare('UPDATE threads SET title = ?, status = ?, reported = ?, archived_at = ?, updated_at = ? WHERE id = ?').run(
    next.title, next.status, next.reported ? 1 : 0, next.archivedAt, next.updatedAt, id,
  )
  emit({ type: 'thread.upsert', thread: next })
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
  db.prepare('DELETE FROM items WHERE thread_id = ?').run(id)
  db.prepare('DELETE FROM threads WHERE id = ?').run(id)
  emit({ type: 'thread.delete', id })
}

// ---- items

export function listItems(threadId: string): Item[] {
  return db.prepare('SELECT * FROM items WHERE thread_id = ? ORDER BY id').all(threadId).map(toItem)
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
      from: data.role === 'assistant' ? 'bot' : data.source === 'user' ? 'user' : data.source === 'task' ? 'task' : 'subagent',
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

// ---- scheduled tasks (the rules for them are in tasks.ts)

function toTask(r: any): ScheduledTask {
  return {
    id: r.id,
    botId: r.bot_id,
    title: r.title,
    prompt: r.prompt,
    schedule: JSON.parse(r.schedule),
    enabled: !!r.enabled,
    createdBy: r.created_by,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at,
    lastStatus: r.last_status,
    lastError: r.last_error,
    lastThreadId: r.last_thread_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export const newTaskId = () => newId('task')

export function listTasks(): ScheduledTask[] {
  return db.prepare('SELECT * FROM tasks ORDER BY created_at').all().map(toTask)
}

export function getTask(id: string): ScheduledTask | undefined {
  const r = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)
  return r && toTask(r)
}

/** Writes a task as it is given, new or changed. */
export function saveTask(task: ScheduledTask): ScheduledTask {
  const t = { ...task, updatedAt: Date.now() }
  db.prepare(
    `INSERT OR REPLACE INTO tasks (id, bot_id, title, prompt, schedule, enabled, created_by, next_run_at, last_run_at, last_status, last_error, last_thread_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(t.id, t.botId, t.title, t.prompt, JSON.stringify(t.schedule), t.enabled ? 1 : 0, t.createdBy, t.nextRunAt, t.lastRunAt, t.lastStatus, t.lastError, t.lastThreadId, t.createdAt, t.updatedAt)
  emit({ type: 'task.upsert', task: t })
  return t
}

export function deleteTask(id: string) {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  emit({ type: 'task.delete', id })
}

/** The tasks that are due by `time`, soonest first. */
export function dueTasks(time: number): ScheduledTask[] {
  return db.prepare('SELECT * FROM tasks WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at').all(time).map(toTask)
}

/** The runs of a task, newest first. */
export function runsOf(taskId: string): Thread[] {
  return db.prepare('SELECT * FROM threads WHERE task_id = ? ORDER BY created_at DESC').all(taskId).map(toThread)
}

/** When the next task is due, or null when none is. */
export function nextDue(): number | null {
  const r = db.prepare('SELECT MIN(next_run_at) AS at FROM tasks WHERE enabled = 1 AND next_run_at IS NOT NULL').get() as { at: number | null }
  return r.at
}

export function closeDb() {
  db.close()
}
