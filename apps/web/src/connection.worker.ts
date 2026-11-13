/// <reference lib="webworker" />
// The connection to the environment, on a thread of its own. It keeps the socket open, reads what
// arrives, and draws the pictures of a bot's browser straight onto the canvas it was given. The
// window's own thread only hears about changes it has to show, at most once per frame, so a busy
// bot or a fast-moving page never makes typing or scrolling stutter.
import { type Command, type Picture, type Report, createConnection } from '@openkumi/client/connection'

export type WorkerCommand =
  | Command
  /** Draw the pictures of this view ("<bot>:<tab>") onto this canvas. */
  | { type: 'view'; key: string; canvas: OffscreenCanvas }
  | { type: 'unview'; key: string }

export type WorkerReport =
  | Report
  /** A view showed its first picture, or the page in it changed size. */
  | { type: 'frame'; key: string; width: number; height: number }

const report = (message: WorkerReport) => postMessage(message)

// ---- pictures of a bot's browser

interface View {
  canvas: OffscreenCanvas
  context: ImageBitmapRenderingContext
  /** The size of the page, as last reported to the window. */
  width: number
  height: number
  drawing: boolean
  /** The newest picture that has not been drawn yet. Older ones it replaced are never drawn. */
  next: Picture | null
}
const views = new Map<string, View>()

function picture(next: Picture) {
  const view = views.get(next.key)
  if (!view) return
  view.next = next
  if (!view.drawing) void draw(next.key, view)
}

async function draw(key: string, view: View) {
  view.drawing = true
  while (view.next && views.get(key) === view) {
    const { jpeg, width, height } = view.next
    view.next = null
    try {
      const bitmap = await createImageBitmap(new Blob([jpeg], { type: 'image/jpeg' }))
      if (views.get(key) !== view) {
        bitmap.close()
        break
      }
      if (view.canvas.width !== bitmap.width || view.canvas.height !== bitmap.height) {
        view.canvas.width = bitmap.width
        view.canvas.height = bitmap.height
      }
      view.context.transferFromImageBitmap(bitmap)
      if (view.width !== width || view.height !== height) {
        view.width = width
        view.height = height
        report({ type: 'frame', key, width, height })
      }
    } catch {
      // A picture that cannot be read is skipped; the next one replaces it anyway.
    }
  }
  view.drawing = false
}

const connection = createConnection(report, picture)

onmessage = ({ data }: MessageEvent<WorkerCommand>) => {
  if (data.type === 'view') {
    const context = data.canvas.getContext('bitmaprenderer')
    if (context) views.set(data.key, { canvas: data.canvas, context, width: 0, height: 0, drawing: false, next: null })
  } else if (data.type === 'unview') views.delete(data.key)
  else connection(data)
}
