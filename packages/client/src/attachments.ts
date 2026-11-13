// Files the owner is about to send with a message. Each goes up to the server as soon as it is
// picked, where it waits out of the bot's sight, so it is there by the time the message goes; it is
// thrown away if the owner changes their mind. Kept per draft (a bot's conversation, or a thread), like the text being written, so
// looking at a subagent and coming back does not lose them. How a file is read and made smaller is
// up to each app; this is the part they share.
import { useSyncExternalStore } from 'react'
import type { Attachment } from '@openkumi/shared'
import { api, onEnvironmentChange, request } from './store'

/** Pictures are sent no larger than this on their long side: models see no more than that, and a phone's photo is many times it. */
export const PICTURE_SIDE = 2048
/** As many files as one message takes (the server's limit too). */
export const MAX = 10

export interface Pending {
  id: string
  name: string
  /** Its media type, as far as the device can tell. */
  type: string
  /** Something to show it by while it waits: an address of the picture on this device. */
  preview?: string
  /** Its id on the server, once it is there waiting to be sent. */
  staged?: string
  error?: string
}

/**
 * A file picked on the device: what it is called, and how to read it. A picture is read made
 * smaller, which can change its kind (a large PNG becomes a JPEG), so its name comes with it.
 */
export interface Picked {
  name: string
  type: string
  preview?: string
  read: () => Promise<{ body: Blob; name: string }>
}

const drafts = new Map<string, { botId: string; files: Pending[] }>()
const listeners = new Set<() => void>()
const EMPTY: Pending[] = []
/** Called with a file's preview when it is no longer shown, for the app to let go of it. */
let release = (_preview: string) => {}
export const onRelease = (fn: (preview: string) => void) => void (release = fn)

function update(key: string, botId: string, change: (files: Pending[]) => Pending[]) {
  const files = change(drafts.get(key)?.files ?? [])
  if (files.length) drafts.set(key, { botId, files })
  else drafts.delete(key)
  listeners.forEach((fn) => fn())
}

const patch = (key: string, botId: string, id: string, values: Partial<Pending>) =>
  update(key, botId, (files) => files.map((f) => (f.id === id ? { ...f, ...values } : f)))

/** The files waiting to go with the draft `key`. */
export function usePending(key: string): Pending[] {
  return useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => drafts.get(key)?.files ?? EMPTY,
  )
}

/** Adds files to a draft and sends each up to wait for the message. At most `MAX` wait at once. */
export function addFiles(key: string, botId: string, picked: Picked[]) {
  const room = MAX - (drafts.get(key)?.files.length ?? 0)
  for (const file of picked.slice(0, Math.max(0, room))) {
    const id = Math.random().toString(36).slice(2)
    update(key, botId, (files) => [...files, { id, name: file.name, type: file.type, preview: file.preview }])
    void (async () => {
      try {
        const { body, name } = await file.read()
        const res = await request('POST', `/api/bots/${encodeURIComponent(botId)}/attachments?name=${encodeURIComponent(name)}`, body)
        const saved: Pick<Attachment, 'id' | 'type'> = await res.json()
        // Taken out while it was on its way: it is not wanted after all.
        if (!drafts.get(key)?.files.some((f) => f.id === id)) return void forget(botId, saved.id)
        patch(key, botId, id, { staged: saved.id, type: saved.type })
      } catch (e) {
        patch(key, botId, id, { error: (e as Error).message || 'Could not be sent' })
      }
    })()
  }
}

const forget = (botId: string, staged: string) => void api('DELETE', `/api/bots/${encodeURIComponent(botId)}/attachments/${staged}`).catch(() => {})

/** Takes a file out of a draft, and throws it away on the server if it got there. */
export function removeFile(key: string, id: string) {
  const draft = drafts.get(key)
  const file = draft?.files.find((f) => f.id === id)
  if (!draft || !file) return
  if (file.staged) forget(draft.botId, file.staged)
  if (file.preview) release(file.preview)
  update(key, draft.botId, (files) => files.filter((f) => f.id !== id))
}

/** Whether a draft's files are all on the server (or have failed, and will be left out). */
export const ready = (files: Pending[]) => files.every((f) => f.staged || f.error)

/** Takes files that went with a message out of the draft. The conversation has them now. */
export function sent(key: string, ids: string[]) {
  const draft = drafts.get(key)
  if (!draft) return
  draft.files.forEach((f) => ids.includes(f.id) && f.preview && release(f.preview))
  update(key, draft.botId, (files) => files.filter((f) => !ids.includes(f.id)))
}

// Drafts belong to the environment they were written in.
onEnvironmentChange(() => {
  for (const { files } of drafts.values()) files.forEach((f) => f.preview && release(f.preview))
  drafts.clear()
  listeners.forEach((fn) => fn())
})

/** A size for people to read: "820 B", "14 KB", "3.1 MB". */
export const sizeOf = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** The pictures every app can show, and models see. */
export const isPicture = (type: string) => /^image\/(png|jpeg|gif|webp)$/.test(type)

/** Where the conversation keeps a file that was sent in it. */
export const keptAt = (threadId: string, id: string) => `/api/threads/${encodeURIComponent(threadId)}/attachments/${id}`

/** A short word for a file's kind, shown on its card: "PDF", "CSV", "DOCX". */
export const kindOf = (name: string, type: string) => (type === 'application/pdf' ? 'PDF' : name.includes('.') ? name.split('.').pop()!.toUpperCase().slice(0, 5) : 'File')
