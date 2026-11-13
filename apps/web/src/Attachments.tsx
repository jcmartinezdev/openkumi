// Files in a conversation: the ones waiting in the composer to be sent, the ones that went with the
// owner's messages (as the conversation keeps them, whatever the bot did with its own copies), and a
// picture opened to its full size. Which files wait, and how they go up, is shared with the phone
// (@openbot/client/attachments).
import { useEffect, useState } from 'react'
import type { Attachment } from '@openbot/shared'
import { type Pending, type Picked, PICTURE_SIDE, isPicture, keptAt, kindOf, onRelease, sizeOf } from '@openbot/client/attachments'
import { Icon } from './Icon'
import { Dialog } from './Modals'
import { download, onEnvironmentChange, request } from './store'

onRelease((preview) => URL.revokeObjectURL(preview))

/** A picture larger than this is made smaller even when it is not too large on its sides. */
const HEAVY = 3_000_000

/**
 * A picture made no larger than models see, which also keeps it under what they take. A PNG stays
 * one (screenshots: sharp text, clear backgrounds) unless it is still heavy, when it becomes a JPEG.
 * Anything the window cannot draw (a HEIC photo, a PDF) goes as it is.
 */
async function shrink(file: File): Promise<{ body: Blob; name: string }> {
  const as = { body: file as Blob, name: file.name }
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return as
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return as
  }
  const scale = Math.min(1, PICTURE_SIDE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= HEAVY) return bitmap.close(), as
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
  const draw = (under?: string) => {
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (under) (ctx.fillStyle = under), ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  }
  const base = file.name.replace(/\.[^.]+$/, '')
  try {
    if (file.type === 'image/png') {
      draw()
      const png = await canvas.convertToBlob({ type: 'image/png' })
      if (png.size <= HEAVY) return { body: png, name: `${base}.png` }
    }
    // A JPEG has no see-through parts: they become white rather than black.
    draw('#fff')
    return { body: await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }), name: `${base}.jpg` }
  } finally {
    bitmap.close()
  }
}

/** Files from a file picker, a drop or a paste, ready to be added to a draft. */
export const picked = (files: Iterable<File>): Picked[] =>
  [...files].map((file) => ({
    name: file.name || 'pasted',
    type: file.type,
    preview: /^image\/(png|jpeg|gif|webp)$/.test(file.type) ? URL.createObjectURL(file) : undefined,
    read: () => shrink(file),
  }))

/** What waits in the composer to go with the message, with a way to take each out. */
export function Tray({ files, remove }: { files: Pending[]; remove: (id: string) => void }) {
  if (!files.length) return null
  return (
    <div className="tray">
      {files.map((f) => (
        <div key={f.id} className={`tray-item ${f.preview ? 'picture' : ''} ${f.error ? 'bad' : ''}`} title={f.error ? `${f.name}: ${f.error}` : f.name}>
          {f.preview ? (
            <img src={f.preview} alt={f.name} />
          ) : (
            <>
              <span className="tray-kind"><Icon name="file" size={16} /></span>
              <span className="tray-text">
                <span className="tray-name">{f.name}</span>
                <span className="tray-meta">{f.error ? 'Not sent' : kindOf(f.name, f.type)}</span>
              </span>
            </>
          )}
          {!f.staged && !f.error && <span className="tray-wait"><span className="spinner" /></span>}
          <button className="tray-x" title="Remove" aria-label={`Remove ${f.name}`} onClick={() => remove(f.id)}>
            <Icon name="x" size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}

// Pictures that went with messages are fetched with the environment's key, so they are kept here
// as addresses in this window, once each, for as long as the environment is shown.
const pictures = new Map<string, Promise<string>>()
onEnvironmentChange(() => {
  pictures.forEach((url) => url.then(URL.revokeObjectURL, () => {}))
  pictures.clear()
})

function usePicture(key: string): { url: string | null; gone: boolean } {
  const [state, setState] = useState<{ key: string; url: string | null; gone: boolean }>({ key, url: null, gone: false })
  useEffect(() => {
    let url = pictures.get(key)
    if (!url) {
      url = request('GET', key)
        .then((res) => res.blob())
        .then((blob) => URL.createObjectURL(blob))
      pictures.set(key, url)
      // Not kept when it failed, so it is asked for again next time (the connection may be back).
      url.catch(() => pictures.delete(key))
    }
    let live = true
    url.then((u) => live && setState({ key, url: u, gone: false }), () => live && setState({ key, url: null, gone: true }))
    return () => void (live = false)
  }, [key])
  return state.key === key ? state : { url: null, gone: false }
}

/** Saves a copy of a file that was sent onto this computer, through the app's usual "save as". */
const save = (threadId: string, file: Attachment) => void download(keptAt(threadId, file.id), file.name).catch(() => {})

/** The files that went with one of the owner's messages: pictures as pictures, anything else as a card that saves a copy. */
export function SentFiles({ threadId, files }: { threadId: string; files: Attachment[] }) {
  const [viewing, setViewing] = useState<Attachment | null>(null)
  return (
    <div className="sent-files">
      {files.map((f) =>
        isPicture(f.type) ? (
          <SentPicture key={f.id} threadId={threadId} file={f} view={() => setViewing(f)} />
        ) : (
          <button key={f.id} className="sent-file" title={`Save a copy of ${f.name}`} onClick={() => save(threadId, f)}>
            <span className="tray-kind"><Icon name="file" size={16} /></span>
            <span className="tray-text">
              <span className="tray-name">{f.name}</span>
              <span className="tray-meta">{kindOf(f.name, f.type)} · {sizeOf(f.size)}</span>
            </span>
          </button>
        ),
      )}
      {viewing && <PictureViewer threadId={threadId} file={viewing} close={() => setViewing(null)} />}
    </div>
  )
}

function SentPicture({ threadId, file, view }: { threadId: string; file: Attachment; view: () => void }) {
  const { url, gone } = usePicture(keptAt(threadId, file.id))
  if (gone) {
    return (
      <div className="sent-file gone" title={`${file.name} could not be loaded`}>
        <span className="tray-kind"><Icon name="file" size={16} /></span>
        <span className="tray-text"><span className="tray-name">{file.name}</span><span className="tray-meta">Could not be loaded</span></span>
      </div>
    )
  }
  return (
    <button className="sent-picture" title={file.name} aria-label={`Open ${file.name}`} onClick={view}>
      {url ? <img src={url} alt={file.name} /> : <span className="spinner" />}
    </button>
  )
}

/** One picture as large as the window allows. */
function PictureViewer({ threadId, file, close }: { threadId: string; file: Attachment; close: () => void }) {
  const { url } = usePicture(keptAt(threadId, file.id))
  return (
    <Dialog title={file.name} close={close} full>
      <div className="picture-full" onMouseDown={(e) => e.target === e.currentTarget && close()}>
        {url && <img src={url} alt={file.name} />}
      </div>
      <div className="picture-actions">
        <button className="ghost" onClick={() => save(threadId, file)}>
          <Icon name="download" size={14} /> Download
        </button>
      </div>
    </Dialog>
  )
}
