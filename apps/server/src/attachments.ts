// Files sent with a message: a photo, a PDF, a spreadsheet. The owner's go up as soon as each
// is picked and wait, out of the bot's sight, until the message is sent. Then the conversation
// keeps it, where the bot cannot reach, so that what was said stays whole whatever becomes of the
// bot's files; and the bot gets a copy of its own in files/inbox/, to file away, rename, use or
// delete as suits it. Pictures, and PDFs for the models that read them, are also put in front of
// the model with the message, in whatever form its provider takes them; any other file is only
// named, for the bot to open with read_file (which gives a PDF's text).
// A bot can send files of its own to another bot with message_bot. They travel the same way: a
// copy is taken as the message is sent, the conversation it goes to keeps it, and the bot that
// reads the message gets its copy in files/inbox/. Neither bot ever reaches the other's folder.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Attachment, Said } from '@openkumi/shared'
import { privateDir } from './config.ts'
import type { Sees } from './providers/types.ts'
import { bytes, copyIn, resolve, safeName } from './workspace.ts'

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
}

/** A file's media type, by its name. */
export const typeOf = (file: string) => TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream'

/** The kinds of picture models take. Others (HEIC, SVG) are files like any other. */
const PICTURES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
export const isPicture = (type: string) => PICTURES.has(type)
const isPdf = (type: string) => type === 'application/pdf'

/** How many files may go with one message, the owner's or a bot's. */
const MAX_FILES = 10
/** The most a picture or a PDF may weigh to be shown to a model; a larger one is only named. A picture is sent as base64, which Claude takes up to 5 MB of. */
const MAX_PICTURE = 3_750_000
const MAX_PDF = 20_000_000
/** The most the files a bot sends another with one message may weigh together: what one file of the owner's may. */
const MAX_SENT = 100_000_000

/** Where a bot's conversations keep the files sent in them, each in a folder of its own: <thread>/<file id>/<name>. */
export const keptIn = (botId: string) => path.join(privateDir(botId), 'attachments')
/** Files picked for a message that has not been sent yet. */
const waiting = (botId: string) => path.join(keptIn(botId), 'waiting')
const ID = /^[a-z0-9]{16}$/
/** A file picked and never sent (the app was closed with it in the composer) is thrown away after a day. */
const STALE = 24 * 60 * 60_000

/** A place for a file to wait in until the message it goes with is sent. Ones never sent are cleared away as it is made. */
function room(botId: string, name: string): { id: string; file: string } {
  for (const old of fs.existsSync(waiting(botId)) ? fs.readdirSync(waiting(botId)) : []) {
    const dir = path.join(waiting(botId), old)
    if (Date.now() - fs.statSync(dir).mtimeMs > STALE) fs.rmSync(dir, { recursive: true, force: true })
  }
  const id = [...crypto.randomBytes(16)].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')
  fs.mkdirSync(path.join(waiting(botId), id), { recursive: true })
  return { id, file: path.join(waiting(botId), id, safeName(name)) }
}

const staged = (id: string, file: string): Staged => ({ id, name: path.basename(file), type: typeOf(file), size: fs.statSync(file).size })
type Staged = Pick<Attachment, 'id' | 'name' | 'type' | 'size'>

/** Keeps a file the owner picked until the message it goes with is sent. */
export function stage(botId: string, name: string, data: Buffer): Staged {
  const { id, file } = room(botId, name)
  fs.writeFileSync(file, data)
  return staged(id, file)
}

/** A file in a bot's workspace that it sends to another bot. */
export interface Outgoing {
  /** Its path in the sender's workspace, cleaned up. */
  path: string
  abs: string
  size: number
}

/** Checks the files a bot wants to send with a message to another bot: its own, by their paths in its workspace. */
export function outgoing(botId: string, given: unknown): Outgoing[] {
  if (given === undefined || given === null) return []
  if (!Array.isArray(given) || !given.every((file) => typeof file === 'string')) throw new Error('files must be a list of paths in your workspace.')
  // A file named twice goes once.
  const targets = [...new Map((given as string[]).map((file) => resolve(botId, file)).map((target) => [target.rel, target])).values()]
  if (targets.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files can go with one message.`)
  const files = targets.map((target) => {
    if (target.readOnly) throw new Error(`${target.rel} is not yours to send: only files in your own workspace can go with a message.`)
    const info = fs.statSync(target.abs, { throwIfNoEntry: false })
    if (!info) throw new Error(`No file at ${target.rel || '(workspace)'}`)
    if (!info.isFile()) throw new Error(`${target.rel || 'Your workspace'} is a folder. Name the files to send, one by one.`)
    return { path: target.rel, abs: target.abs, size: info.size }
  })
  const weight = files.reduce((sum, file) => sum + file.size, 0)
  if (weight > MAX_SENT) throw new Error(`These files are too large to send together (${bytes(weight)}; at most ${bytes(MAX_SENT)} with one message).`)
  return files
}

/**
 * Takes a copy of a file one bot sends another, to wait for the message as a file the owner picked
 * does. From here on it is the copy that travels: what the sender does to its own file changes nothing.
 */
export function stageCopy(botId: string, file: Outgoing): Staged {
  const { id, file: copy } = room(botId, path.basename(file.abs))
  fs.copyFileSync(file.abs, copy)
  return staged(id, copy)
}

/** The one file in an attachment's folder, or null. */
function only(dir: string): string | null {
  try {
    const [name] = fs.readdirSync(dir)
    return name ? path.join(dir, name) : null
  } catch {
    return null
  }
}

/** Throws a file away that was picked and then taken out of the message. */
export function unstage(botId: string, id: string) {
  if (ID.test(id)) fs.rmSync(path.join(waiting(botId), id), { recursive: true, force: true })
}

/** Checks that the files a message names are waiting to be sent, before anything is done with them. */
export function checkWaiting(botId: string, given: unknown): string[] {
  if (given === undefined || given === null) return []
  if (!Array.isArray(given) || !given.every((id) => typeof id === 'string')) throw new Error('attachments must be a list of file ids.')
  if (given.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files can go with one message.`)
  const ids = [...new Set(given as string[])]
  for (const id of ids) {
    if (!ID.test(id) || !only(path.join(waiting(botId), id))) throw new Error('A file is no longer waiting to be sent. Add it again.')
  }
  return ids
}

/**
 * Sends the waiting files with a message in a thread: the conversation keeps them from here on.
 * The bot gets its copies when it reads the message (see handOver), which may be a while if it is
 * busy, so they have no path yet.
 */
export function attach(botId: string, threadId: string, ids: string[]): Attachment[] {
  return checkWaiting(botId, ids).map((id) => {
    const from = only(path.join(waiting(botId), id))!
    const dir = path.join(keptIn(botId), threadId, id)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, path.basename(from))
    fs.renameSync(from, file)
    fs.rmSync(path.dirname(from), { recursive: true, force: true })
    const name = path.basename(file)
    return { id, name, path: '', type: typeOf(name), size: fs.statSync(file).size }
  })
}

/** Puts the bot's copies of a message's files in files/inbox/. A file that has its copy already is left as it is. */
export function handOver(botId: string, threadId: string, attachments: Attachment[]): Attachment[] {
  return attachments.map((a) => {
    const file = a.path ? null : kept(botId, threadId, a.id)
    return file ? { ...a, path: copyIn(botId, file, a.name) } : a
  })
}

/** Throws away the files of a message that was taken back before the bot read it. */
export function discard(botId: string, threadId: string, attachments: Attachment[]) {
  for (const a of attachments) if (kept(botId, threadId, a.id)) fs.rmSync(path.join(keptIn(botId), threadId, a.id), { recursive: true, force: true })
}

/** Where a thread keeps a file that was sent in it, or null when it does not have it. */
export function kept(botId: string, threadId: string, id: string): string | null {
  return ID.test(id) && /^[\w-]+$/.test(threadId) ? only(path.join(keptIn(botId), threadId, id)) : null
}

const kind = (type: string) =>
  isPicture(type) ? 'picture' : isPdf(type) ? 'PDF' : type.startsWith('text/') || type === 'application/json' ? 'text' : type.startsWith('image/') ? 'picture' : 'file'

/**
 * What a model is told of the files that came with a message, after what was written: the owner's,
 * or another bot's. `text` is the message as the model reads it.
 */
export function withFiles(text: string, said: Pick<Said, 'attachments' | 'source' | 'bot'>): string {
  const attachments = said.attachments
  if (!attachments?.length) return text
  const named = attachments.map((a) => `${a.path} (${kind(a.type)}, ${bytes(a.size)})`).join(', ')
  const one = attachments.length === 1
  const came =
    said.source === 'bot'
      ? `${said.bot?.name ?? 'The bot'} sent ${one ? 'a file' : `${attachments.length} files`} with this message`
      : `The user attached ${one ? 'a file' : `${attachments.length} files`}`
  return `${text}${text ? '\n\n' : ''}[${came}. Your ${one ? 'copy' : 'copies'}: ${named}. read_file gives the text of a PDF or a text file.]`
}

/** A file to show a model with a message: where it is on disk, and what it is. */
export interface Shown {
  path: string
  type: string
}

/** Whether a file of this type and size can be shown to a model that takes these. */
const showable = (type: string, size: number, sees: Sees) =>
  (isPicture(type) && !!sees.pictures && size <= MAX_PICTURE) || (isPdf(type) && !!sees.pdfs && size <= MAX_PDF)

/**
 * What a file really is, by its first bytes. A model refuses a picture that is not what it is said
 * to be, and fails the whole turn, so a download called .png that holds a JPEG has to be told apart.
 */
function sniff(abs: string): string | null {
  const head = Buffer.alloc(12)
  const fd = fs.openSync(abs, 'r')
  try {
    fs.readSync(fd, head, 0, 12, 0)
  } finally {
    fs.closeSync(fd)
  }
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
  if (head.toString('latin1', 0, 4) === 'GIF8') return 'image/gif'
  if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  if (head.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf'
  return null
}

/**
 * The files sent in a thread that a model can be shown, by what its provider takes. They are the
 * conversation's own copies, so the bot filing its own away changes nothing. Ones too large, or
 * not what they seem, are left out.
 */
export function toShow(botId: string, threadId: string, attachments: Attachment[], sees: Sees | undefined): Shown[] {
  if (!sees) return []
  return attachments.flatMap((a) => {
    const file = kept(botId, threadId, a.id)
    if (!file) return []
    const type = sniff(file)
    return type && showable(type, fs.statSync(file).size, sees) ? [{ path: file, type }] : []
  })
}

/** A file shown to a model, in base64. */
export const base64 = (file: Shown) => fs.readFileSync(file.path).toString('base64')
