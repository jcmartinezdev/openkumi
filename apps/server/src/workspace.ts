// A bot's workspace: the one folder its file tools can reach, plus read-only access to the
// instructions of the superpowers switched on for it. Every change to the workspace is recorded in a git history so the owner can
// see what the bot changed about itself and undo it. The history itself is kept in the bot's
// private folder, so nothing the bot can write is ever read by git as configuration.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { FileEntry, HistoryEntry } from '@openkumi/shared'
import { emit, privateDir, workspaceDir } from './config.ts'
import { settings } from './settings.ts'
import { SUPERPOWERS, enabledSuperpowers, superpowerDir } from './superpowers.ts'

const MAX_FILE = 2_000_000
const MAX_ENTRIES = 2000

interface Target {
  /** Where the path really is on disk. */
  abs: string
  /** The path as the bot wrote it, cleaned up. */
  rel: string
  /** A superpower's instructions are shared between bots, so a bot may read them but never change them. */
  readOnly: boolean
  /** For "superpowers" itself: the ones this bot has, the only ones it is shown. */
  only?: string[]
}

const inside = (parent: string, child: string) => child === parent || child.startsWith(parent + path.sep)

/** Control and invisible characters: a name containing one can pass for another name, or garble the history. */
const HIDDEN = /[\p{Cc}\p{Cf}\u2028\u2029]/u

/** Follows links in the part of a path that exists, so a link cannot lead outside its folder. */
function realpath(abs: string): string {
  const missing: string[] = []
  for (let at = abs; ; at = path.dirname(at)) {
    try {
      return path.join(fs.realpathSync(at), ...missing.reverse())
    } catch {
      if (path.dirname(at) === at) return abs
      missing.push(path.basename(at))
    }
  }
}

/**
 * Maps a path the bot (or the UI) gave to a real one. Paths are relative to the workspace;
 * "superpowers/<id>/…" reads the folder of a superpower switched on for this bot. Anything else is refused.
 */
export function resolve(botId: string, given: unknown): Target {
  const parts = String(given ?? '').replace(/\\/g, '/').split('/').filter((p) => p && p !== '.')
  if (parts.includes('..')) throw new Error('Paths cannot contain "..". They are relative to your workspace.')
  for (const part of parts) {
    if (HIDDEN.test(part)) throw new Error('File names cannot contain invisible or control characters.')
    // Git gives names that start with ".git" a meaning of their own (a repository, ignore rules,
    // how changes are shown), and the history of this folder has to stay complete and readable.
    const plain = part.toLowerCase().replace(/[. ]+$/, '')
    if (plain.startsWith('.git') || /^git~\d+$/.test(plain)) throw new Error('That path is not available.')
  }
  const rel = parts.join('/')
  if (parts[0] === 'superpowers') {
    if (parts.length === 1) return { abs: SUPERPOWERS, rel, readOnly: true, only: enabledSuperpowers(botId) }
    const abs = path.join(superpowerDir(parts[1]), ...parts.slice(2))
    if (!enabledSuperpowers(botId).includes(parts[1]) || !inside(realpath(superpowerDir(parts[1])), realpath(abs))) throw new Error(`No file at ${rel}`)
    return { abs, rel, readOnly: true }
  }
  const root = workspaceDir(botId)
  const abs = path.join(root, ...parts)
  if (!inside(realpath(root), realpath(abs))) throw new Error('That path leads outside your workspace.')
  return { abs, rel, readOnly: false }
}

function writable(botId: string, given: unknown): Target {
  const target = resolve(botId, given)
  if (target.readOnly) throw new Error('Superpowers are read-only. Write in your workspace instead (for example under memory/ or files/).')
  if (!target.rel) throw new Error('A file path is required.')
  return target
}

const isBinary = (buf: Buffer) => buf.subarray(0, 8000).includes(0)
/** A size for people to read: "820 B", "14.2 KB", "3.1 MB". */
export const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

function stat(target: Target): fs.Stats {
  try {
    return fs.statSync(target.abs)
  } catch {
    throw new Error(`No file at ${target.rel || '(workspace)'}`)
  }
}

// ---- reading

/** Every file and folder under a path. Links are not followed. */
function* walk(abs: string, rel: string, depth = 8, only?: string[]): Generator<FileEntry & { abs: string }> {
  let names: fs.Dirent[]
  try {
    names = fs.readdirSync(abs, { withFileTypes: true })
  } catch {
    return
  }
  names.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of names) {
    if (entry.name === '.git' || entry.name === '.DS_Store' || (only && !only.includes(entry.name))) continue
    const childAbs = path.join(abs, entry.name)
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isSymbolicLink()) continue
    let info: fs.Stats
    try {
      info = fs.statSync(childAbs)
    } catch {
      continue
    }
    yield { path: childRel, abs: childAbs, dir: info.isDirectory(), size: info.isDirectory() ? 0 : info.size, modified: info.mtimeMs }
    if (info.isDirectory() && depth > 0) yield* walk(childAbs, childRel, depth - 1)
  }
}

/** The workspace as a flat list, for the Files tab. */
export function tree(botId: string): FileEntry[] {
  const out: FileEntry[] = []
  for (const { abs: _, ...entry } of walk(workspaceDir(botId), '')) {
    out.push(entry)
    if (out.length >= MAX_ENTRIES) break
  }
  return out
}

export function list(botId: string, given: unknown, recursive: boolean): string {
  const target = resolve(botId, given)
  if (!stat(target).isDirectory()) throw new Error(`${target.rel} is a file, not a folder. Use read_file.`)
  const lines: string[] = []
  for (const entry of walk(target.abs, target.rel, recursive ? 8 : 0, target.only)) {
    lines.push(entry.dir ? `${entry.path}/` : `${entry.path}  (${bytes(entry.size)})`)
    if (lines.length >= 400) {
      lines.push('… (more entries not shown; list a subfolder)')
      break
    }
  }
  // The superpowers are not in the workspace, so the top level mentions them itself.
  if (!target.rel && enabledSuperpowers(botId).length) lines.push('superpowers/  (read-only)')
  return lines.join('\n') || '(empty)'
}

/** File contents for the model: text only, a window of lines at a time. A PDF gives its text. */
export async function read(botId: string, given: unknown, offset = 1, limit = 1500): Promise<string> {
  const target = resolve(botId, given)
  const info = stat(target)
  if (info.isDirectory()) throw new Error(`${target.rel || 'That'} is a folder. Use list_files.`)
  if (info.size > 20_000_000 && !/\.pdf$/i.test(target.rel)) throw new Error(`${target.rel} is too large to read (${bytes(info.size)}).`)
  let text: string
  if (/\.pdf$/i.test(target.rel)) text = await pdfText(target.abs, info)
  else {
    const buf = fs.readFileSync(target.abs)
    if (isBinary(buf)) return `(${target.rel} is a binary file, ${bytes(info.size)}; it cannot be shown as text)`
    text = buf.toString('utf8')
  }
  const lines = text.split('\n')
  const start = Math.max(1, Math.floor(offset) || 1)
  let end = Math.min(lines.length, start - 1 + Math.max(1, Math.floor(limit) || 1500))
  let shown = lines.slice(start - 1, end).join('\n')
  while (shown.length > 36_000 && end > start) shown = lines.slice(start - 1, --end).join('\n')
  if (start === 1 && end === lines.length) return shown
  return `${shown}\n\n[lines ${start}-${end} of ${lines.length}${end < lines.length ? `; read more with offset ${end + 1}` : ''}]`
}

/** The text of the PDFs read lately, so that reading one a window at a time does not take it apart again each time. */
const pdfs = new Map<string, { stamp: string; text: string }>()

/** A PDF's text, page by page. A scanned PDF has none: its pages are pictures. */
async function pdfText(abs: string, info: fs.Stats): Promise<string> {
  const stamp = `${info.size}:${info.mtimeMs}`
  const kept = pdfs.get(abs)
  if (kept?.stamp === stamp) return kept.text
  if (info.size > 100_000_000) throw new Error(`That PDF is too large to read (${bytes(info.size)}).`)
  // Loaded the first time a PDF is read: it is large, and most turns read none.
  const { extractText, getDocumentProxy } = await import('unpdf')
  let pages: string[]
  try {
    const doc = await getDocumentProxy(new Uint8Array(fs.readFileSync(abs)))
    pages = (await extractText(doc, { mergePages: false })).text
    void doc.loadingTask.destroy()
  } catch (e: any) {
    throw new Error(/password/i.test(String(e?.message)) ? 'That PDF is locked with a password.' : `That PDF could not be read: ${String(e?.message ?? e).split('\n')[0]}`)
  }
  const text = pages.some((page) => page.trim())
    ? pages.map((page, i) => `--- Page ${i + 1} of ${pages.length} ---\n${page.trim()}`).join('\n\n')
    : `(This PDF has ${pages.length} page${pages.length === 1 ? '' : 's'} but no text in it: its pages are probably scanned pictures.)`
  pdfs.set(abs, { stamp, text })
  if (pdfs.size > 8) pdfs.delete(pdfs.keys().next().value!)
  return text
}

/** File contents for the Files tab. */
export function open(botId: string, given: unknown): { path: string; content: string; binary: boolean; size: number } {
  const target = resolve(botId, given)
  const info = stat(target)
  if (info.isDirectory()) throw new Error(`${target.rel} is a folder`)
  const buf = info.size > MAX_FILE ? null : fs.readFileSync(target.abs)
  const binary = !buf || isBinary(buf)
  return { path: target.rel, content: binary ? '' : buf!.toString('utf8'), binary, size: info.size }
}

export function search(botId: string, query: unknown, given: unknown): string {
  const needle = String(query ?? '').trim()
  if (!needle) throw new Error('A search query is required.')
  const target = resolve(botId, given)
  stat(target)
  const lower = needle.toLowerCase()
  const hits: string[] = []
  for (const entry of walk(target.abs, target.rel, 8, target.only)) {
    if (hits.length >= 80) break
    if (entry.path.toLowerCase().includes(lower)) hits.push(entry.dir ? `${entry.path}/` : entry.path)
    if (entry.dir || entry.size > MAX_FILE) continue
    const buf = fs.readFileSync(entry.abs)
    if (isBinary(buf)) continue
    const lines = buf.toString('utf8').split('\n')
    for (let i = 0; i < lines.length && hits.length < 80; i++) {
      if (lines[i].toLowerCase().includes(lower)) hits.push(`${entry.path}:${i + 1}: ${lines[i].trim().slice(0, 200)}`)
    }
  }
  if (!hits.length) return `No matches for "${needle}".`
  return hits.join('\n') + (hits.length >= 80 ? '\n… (stopped at 80 matches; narrow the search)' : '')
}

// ---- writing

const changed = (botId: string) => emit({ type: 'files.changed', botId })

export function write(botId: string, given: unknown, content: string | Buffer): string {
  const target = writable(botId, given)
  if (content.length > (typeof content === 'string' ? MAX_FILE : 100_000_000)) throw new Error('That is too large to save as one file.')
  if (fs.existsSync(target.abs) && fs.statSync(target.abs).isDirectory()) throw new Error(`${target.rel} is a folder.`)
  fs.mkdirSync(path.dirname(target.abs), { recursive: true })
  fs.writeFileSync(target.abs, content)
  changed(botId)
  return target.rel
}

export function edit(botId: string, given: unknown, oldText: string, newText: string, all: boolean): string {
  const target = writable(botId, given)
  if (stat(target).isDirectory()) throw new Error(`${target.rel} is a folder.`)
  if (!oldText) throw new Error('old_text is required. To create a file, use write_file.')
  const before = fs.readFileSync(target.abs, 'utf8')
  const count = before.split(oldText).length - 1
  if (!count) throw new Error(`old_text was not found in ${target.rel}. Read the file and copy the text exactly.`)
  if (count > 1 && !all) throw new Error(`old_text appears ${count} times in ${target.rel}. Include more surrounding text, or set replace_all.`)
  fs.writeFileSync(target.abs, all ? before.split(oldText).join(newText) : before.replace(oldText, () => newText))
  changed(botId)
  return target.rel
}

export function remove(botId: string, given: unknown): string {
  const target = writable(botId, given)
  stat(target)
  fs.rmSync(target.abs, { recursive: true })
  changed(botId)
  return target.rel
}

export function move(botId: string, from: unknown, to: unknown): string {
  const source = writable(botId, from)
  const dest = writable(botId, to)
  stat(source)
  if (fs.existsSync(dest.abs)) throw new Error(`${dest.rel} already exists.`)
  fs.mkdirSync(path.dirname(dest.abs), { recursive: true })
  fs.renameSync(source.abs, dest.abs)
  changed(botId)
  return `${source.rel} -> ${dest.rel}`
}

/** A name a file can be saved under: no folders, no characters that mean something to the system, not hidden. */
export const safeName = (name: string) =>
  path.basename(name).replace(/[\p{Cc}\p{Cf}\u2028\u2029\\/:*?"<>|]/gu, '_').replace(/^[. ]+/, '') || 'download'

/**
 * A free name for something arriving from outside: a browser download, or a file the user sent,
 * which arrive in files/inbox/ for the bot to file away. What the owner uploads in Files goes in files/.
 */
export function incoming(botId: string, name: string, folder = 'files/inbox'): string {
  const safe = safeName(name)
  const ext = path.extname(safe)
  const dir = path.join(workspaceDir(botId), ...folder.split('/'))
  fs.mkdirSync(dir, { recursive: true })
  let candidate = safe
  for (let n = 2; fs.existsSync(path.join(dir, candidate)); n++) candidate = `${safe.slice(0, safe.length - ext.length)} (${n})${ext}`
  return `${folder}/${candidate}`
}

/** Puts a copy of a file from outside the workspace in files/inbox/, and gives where it went. */
export function copyIn(botId: string, from: string, name: string): string {
  const rel = incoming(botId, name)
  fs.copyFileSync(from, resolve(botId, rel).abs)
  changed(botId)
  return rel
}

// ---- what goes into the prompt

/** The bot's own instructions, cut off at the limit so they cannot crowd out the conversation. */
export function agentsFile(botId: string): string {
  let text = ''
  try {
    text = fs.readFileSync(path.join(workspaceDir(botId), 'AGENTS.md'), 'utf8').trim()
  } catch {}
  // The most a bot's own instructions may add to every prompt; a longer file is cut off there.
  const limit = settings().instructionsLimit
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n\n[AGENTS.md is ${text.length} characters, over the ${limit} limit, and was cut off here. Shorten it and move detail into memory/.]`
}

/** One line per memory note: its path and its first line, so the bot knows what it can look up. */
export function memoryIndex(botId: string): string[] {
  const lines: string[] = []
  for (const entry of walk(path.join(workspaceDir(botId), 'memory'), 'memory')) {
    if (entry.dir) continue
    let first = ''
    try {
      const fd = fs.openSync(entry.abs, 'r')
      const buf = Buffer.alloc(400)
      const n = fs.readSync(fd, buf, 0, 400, 0)
      fs.closeSync(fd)
      first = buf.subarray(0, n).toString('utf8').split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').trim().slice(0, 100) ?? ''
    } catch {}
    lines.push(`- ${entry.path}${first ? `: ${first}` : ''}`)
    if (lines.length >= 60) {
      lines.push('- … (more notes; use list_files or search_files on memory/)')
      break
    }
  }
  return lines
}

// ---- history

const GIT_ENV = {
  ...process.env,
  // The user's own git settings (signing, hooks, templates) must not apply to a bot's history.
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
}
const AUTHORS = { bot: 'Bot', you: 'You', system: 'OpenKumi' } as const
type Author = keyof typeof AUTHORS

const historyDir = (botId: string) => path.join(privateDir(botId), 'history.git')

function git(botId: string, args: string[], author: Author = 'system'): Promise<string> {
  const name = AUTHORS[author]
  const env = {
    ...GIT_ENV,
    GIT_DIR: historyDir(botId),
    GIT_WORK_TREE: workspaceDir(botId),
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: 'openkumi@localhost',
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: 'openkumi@localhost',
  }
  // Hooks are switched off so nothing in the repository can make git run a program.
  const safe = ['-c', `core.hooksPath=${os.devNull}`, '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', '-c', 'core.quotepath=false']
  return new Promise((done, fail) => {
    execFile('git', [...safe, ...args], { cwd: workspaceDir(botId), env, maxBuffer: 8_000_000 }, (error, stdout, stderr) => {
      if (error) fail(new Error((stderr || error.message).trim().split('\n')[0]))
      else done(stdout)
    })
  })
}

let gitFound: Promise<boolean> | undefined
const hasGit = () => (gitFound ??= new Promise<boolean>((done) => execFile('git', ['--version'], (error) => done(!error))))

// Git operations on one workspace must not overlap, so each bot has a queue.
const queues = new Map<string, Promise<unknown>>()
function queued<T>(botId: string, fn: () => Promise<T>): Promise<T> {
  const next = (queues.get(botId) ?? Promise.resolve()).then(fn, fn)
  queues.set(botId, next.catch(() => {}))
  return next
}

async function ready(botId: string): Promise<boolean> {
  if (!(await hasGit()) || !fs.existsSync(workspaceDir(botId))) return false
  if (fs.existsSync(path.join(historyDir(botId), 'HEAD'))) return true
  fs.mkdirSync(privateDir(botId), { recursive: true })
  await git(botId, ['init', '-q', '-b', 'main'])
  // Working files can be large and are not what the history is for, so they stay out of it.
  const info = path.join(historyDir(botId), 'info')
  fs.mkdirSync(info, { recursive: true })
  fs.writeFileSync(path.join(info, 'exclude'), 'files/\n.DS_Store\n')
  return true
}

async function commitNow(botId: string, author: Author, message: string): Promise<boolean> {
  if (!(await ready(botId))) return false
  await git(botId, ['add', '-A'])
  problems.delete(botId)
  if (!(await git(botId, ['status', '--porcelain'])).trim()) return false
  // The log is read back by splitting on control characters, so a message must not contain any.
  await git(botId, ['commit', '-q', '-m', message.replace(/[\p{Cc}\p{Cf}\s]+/gu, ' ').slice(0, 200)], author)
  return true
}

/** Why a bot's changes are not being recorded right now, when they are not. */
const problems = new Map<string, string>()

/** Records whatever changed in the workspace. A failure does not stop the bot, but the owner is told. */
export function commit(botId: string, author: Author, message: string): Promise<boolean> {
  return queued(botId, () => commitNow(botId, author, message)).catch((e) => {
    console.error(`Could not record history for ${botId}:`, e.message)
    problems.set(botId, String(e.message))
    changed(botId)
    return false
  })
}

export function history(botId: string): Promise<{ available: boolean; entries: HistoryEntry[]; problem?: string }> {
  return queued(botId, async () => {
    if (!(await ready(botId))) return { available: false, entries: [] }
    const out = await git(botId, ['log', '-n', '100', '--format=%x1e%H%x1f%at%x1f%an%x1f%s', '--name-only']).catch(() => '')
    const entries = out.split('\x1e').filter((r) => r.trim()).map((record): HistoryEntry => {
      const [head, ...files] = record.split('\n')
      const [id, time, name, message] = head.split('\x1f')
      const author = name === AUTHORS.bot ? 'bot' : name === AUTHORS.you ? 'you' : 'system'
      return { id, time: Number(time) * 1000, author, message, files: files.filter((f) => f.trim()) }
    })
    return { available: true, entries, problem: problems.get(botId) }
  })
}

const commitId = (id: string) => (/^[0-9a-f]{7,40}$/.test(id) ? id : (() => { throw new Error('No such change') })())

export function diff(botId: string, id: string): Promise<string> {
  return queued(botId, async () => (await git(botId, ['show', '--format=', '--no-color', '--unified=3', commitId(id)])).slice(0, 200_000))
}

/** Reverses one recorded change, as a new change, leaving everything after it in place. */
export function undo(botId: string, id: string): Promise<void> {
  return queued(botId, async () => {
    if (!(await ready(botId))) throw new Error('History is not available')
    // Anything not recorded yet is recorded first, so the undo cannot be mixed up with it.
    await commitNow(botId, 'bot', 'Changes')
    const subject = (await git(botId, ['log', '-n', '1', '--format=%s', commitId(id)])).trim()
    try {
      await git(botId, ['revert', '--no-commit', commitId(id)])
      await git(botId, ['commit', '-q', '-m', `Undo: ${subject}`.slice(0, 200)], 'you')
    } catch {
      await git(botId, ['revert', '--abort']).catch(() => {})
      throw new Error('Later changes touch the same lines, so this cannot be undone automatically. Edit the file instead.')
    } finally {
      changed(botId)
    }
  })
}

// ---- creating

const starter = (name: string, purpose: string) => `# ${name}

${purpose.trim() || 'A general-purpose assistant: direct, concise, and careful with facts.'}

## How I work

_Standing instructions go here. I add to them as I learn how my user wants things done._

## About my user

_Durable facts and preferences go here._
`

/** Creates whatever is missing from a bot's workspace and starts its history. */
export async function scaffold(botId: string, name: string, purpose = ''): Promise<void> {
  const root = workspaceDir(botId)
  for (const dir of ['memory', 'files']) fs.mkdirSync(path.join(root, dir), { recursive: true })
  const agents = path.join(root, 'AGENTS.md')
  if (!fs.existsSync(agents)) fs.writeFileSync(agents, starter(name, purpose))
  await commit(botId, 'system', 'Create workspace')
}
