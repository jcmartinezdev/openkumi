// A bot's workspace as every app shows it: its own instructions (AGENTS.md), its memory, and its
// working files under files/, with the recorded changes to all but the working files.
// What is fetched from the server for it is in the store (useFiles, useChanges).
import type { FileEntry, HistoryEntry } from '@openkumi/shared'

/** The file the bot keeps its own instructions in. */
export const INSTRUCTIONS = 'AGENTS.md'

/** Where the server keeps one of a bot's files. Add `&download=1` for its bytes. */
export const fileUrl = (botId: string, path: string) => `/api/bots/${encodeURIComponent(botId)}/file?path=${encodeURIComponent(path)}`

/** Working files (files/) are left out of the recorded changes; everything else in the workspace is in them. */
export const isRecorded = (path: string) => path !== 'files' && !path.startsWith('files/')

/** What a file is, for its icon and for how it is shown. */
export function kindOfFile(path: string): 'instructions' | 'markdown' | 'picture' | 'table' | 'text' {
  if (path === INSTRUCTIONS) return 'instructions'
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'picture'
  if (ext === 'csv' || ext === 'tsv') return 'table'
  return 'text'
}

export const nameOf = (path: string) => path.split('/').pop() || path
export const folderOf = (path: string) => path.split('/').slice(0, -1).join('/')

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export interface Summary {
  /** Files in memory/. */
  notes: number
  /** Files under files/. */
  working: number
  /** Of those, the ones in files/inbox/: what the owner sent in the conversation. */
  inbox: number
  files: number
  bytes: number
}

export function summarize(entries: FileEntry[]): Summary {
  const files = entries.filter((e) => !e.dir)
  return {
    notes: files.filter((e) => e.path.startsWith('memory/')).length,
    working: files.filter((e) => e.path.startsWith('files/')).length,
    inbox: files.filter((e) => e.path.startsWith('files/inbox/')).length,
    files: files.length,
    bytes: files.reduce((n, e) => n + e.size, 0),
  }
}

/** The workspace in a few words: "6 notes in memory · 31 working files". */
export const notesAndFiles = (s: Summary) => `${plural(s.notes, 'note')} in memory · ${plural(s.working, 'working file')}`

/** Shorter, for a row on the phone: "Instructions, 6 notes, 31 working files". */
export const inShort = (s: Summary) => `Instructions, ${plural(s.notes, 'note')}, ${plural(s.working, 'working file')}`

/** What a top folder or file of the workspace is for, in a word or two, next to its name. */
export function hintOf(path: string, s: Summary): string {
  if (path === INSTRUCTIONS) return 'Its instructions'
  if (path === 'memory') return plural(s.notes, 'note')
  if (path === 'files') return plural(s.working, 'working file')
  if (path === 'files/inbox') return `${s.inbox} from you`
  return ''
}

/** What is directly in a folder ('' for the top), folders first; each folder with how many files are in it, at any depth. */
export function childrenOf(entries: FileEntry[], dir: string): { entry: FileEntry; count: number }[] {
  const prefix = dir ? `${dir}/` : ''
  const depth = dir ? dir.split('/').length : 0
  return entries
    .filter((e) => e.path.startsWith(prefix) && e.path.split('/').length === depth + 1)
    .map((entry) => ({ entry, count: entry.dir ? entries.filter((e) => !e.dir && e.path.startsWith(`${entry.path}/`)).length : 0 }))
    .sort((a, b) => Number(b.entry.dir) - Number(a.entry.dir) || a.entry.path.localeCompare(b.entry.path))
}

/** The files whose name has every word typed, for finding one by name. */
export function findFiles(entries: FileEntry[], query: string): FileEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return entries.filter((e) => !e.dir && words.every((w) => nameOf(e.path).toLowerCase().includes(w)))
}

/** The newest recorded change to a file. */
export const lastChange = (changes: HistoryEntry[], path: string) => changes.find((c) => c.files.includes(path))

const pad = (n: number) => String(n).padStart(2, '0')
/** The time of day of a moment: "12:14". */
export const clockOf = (time: number) => `${pad(new Date(time).getHours())}:${pad(new Date(time).getMinutes())}`

const dayOf = (time: number) => new Date(time).setHours(0, 0, 0, 0)

/** How long ago, in words: "just now", "2 hours ago", "yesterday", "on 3 Nov". */
export function since(time: number, now = Date.now()): string {
  const minutes = Math.floor((now - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`
  const days = Math.round((dayOf(now) - dayOf(time)) / 86_400_000)
  if (days < 1) return `${plural(Math.floor(minutes / 60), 'hour')} ago`
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  const d = new Date(time)
  return `on ${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}${d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`}`
}

/** Changes under the day they were made: "Today", "Yesterday", "Thu 13 Nov". Newest first, as given. */
export function byDay(changes: HistoryEntry[], now = Date.now()): { day: string; changes: HistoryEntry[] }[] {
  const groups: { day: string; changes: HistoryEntry[] }[] = []
  for (const change of changes) {
    const days = Math.round((dayOf(now) - dayOf(change.time)) / 86_400_000)
    const d = new Date(change.time)
    const day =
      days === 0 ? 'Today'
      : days === 1 ? 'Yesterday'
      : `${d.toLocaleString('en-GB', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleString('en-GB', { month: 'short' })}${d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`}`
    if (groups.at(-1)?.day === day) groups.at(-1)!.changes.push(change)
    else groups.push({ day, changes: [change] })
  }
  return groups
}

/** Who made a change, as it is shown: the bot's name, "You" or "OpenKumi". */
export const authorOf = (change: HistoryEntry, botName: string) => (change.author === 'bot' ? botName : change.author === 'you' ? 'You' : 'OpenKumi')

export interface DiffLine {
  kind: 'add' | 'del' | 'same' | 'gap'
  text: string
}

/** A change as git reports it, as the files it touched, each with its added, removed and unchanged lines. */
export function parseDiff(text: string): { file: string; lines: DiffLine[] }[] {
  const files: { file: string; lines: DiffLine[] }[] = []
  for (const line of text.split('\n')) {
    const file = line.match(/^diff --git a\/.* b\/(.*)$/)
    const lines = files.at(-1)?.lines
    if (file) files.push({ file: file[1], lines: [] })
    else if (!lines) continue
    else if (line.startsWith('@@')) lines.length && lines.push({ kind: 'gap', text: '⋯' })
    else if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |\\ No newline)/.test(line)) continue
    else if (line.startsWith('+')) lines.push({ kind: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) lines.push({ kind: 'del', text: line.slice(1) })
    else if (line.startsWith(' ')) lines.push({ kind: 'same', text: line.slice(1) })
  }
  return files
}
