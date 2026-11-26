// Pages a bot shows in its conversation with show_page: a chart, a dashboard, a diagram, drawn
// where the reply is. The bot writes self-contained HTML; pictures from its workspace are put into
// the page, so it keeps working when the files change. The apps draw it in a frame of its own,
// in the app's colours (see packages/client/src/page.ts).
import fs from 'node:fs'
import path from 'node:path'
import * as ws from './workspace.ts'

const MAX_HTML = 1_000_000
/** The data a page made to be filled in is given, as JSON. */
const MAX_DATA = 100_000
/** Pictures put into the page, together. */
const MAX_PICTURES = 6_000_000

const PICTURES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
}

/** What the bot is told about making a page. The variables match the ones the apps set. */
export const PAGE_GUIDE = [
  'Show a finished HTML page in the conversation, above your reply: a chart, a dashboard, a table of many figures, a diagram, a timeline, a mockup.',
  'Use it when a picture says more than words; then do not describe or repeat in text what the page shows.',
  'The page is self-contained: put the data and the <style> and <script> in it. It may load scripts, styles and fonts from https addresses ' +
    '(such as a chart library from https://cdn.jsdelivr.net/npm/, with an exact version), but it cannot fetch or send anything itself.',
  'Pictures from your workspace can be named by path (<img src="files/photo.jpg">); they are put into the page.',
  'A page saved as a file is not shown to the user until you show it here with its path.',
  'A page made to be filled in (one of your superpowers may bring some) is shown with its path and data: an object, which the page reads ' +
    'from <script id="page-data" type="application/json"> with JSON.parse, together with shownAt, when it was shown, in ms.',
  'Layout: the page is as wide as the conversation (about 720px on a computer, 360px on a phone) and sits on its background. ' +
    'Leave html and body without a background, border, outer padding or a heading that repeats the title. Use fluid widths. ' +
    'A box with a background of its own gets padding: 16px and border-radius: var(--radius). Give charts a fixed height in px. ' +
    'The page is fitted to its content: never use vh units, or height: 100% on html or body.',
  'Colours: the page is drawn in the app\'s light or dark colours, and switches with it, so use these CSS variables, not fixed colours: ' +
    '--background, --foreground, --card, --card-foreground, --muted, --muted-foreground, --border, --primary, --primary-foreground, ' +
    '--accent, --success, --warning, --destructive, --info, --grid, --axis, --code-background, --radius, --font-sans, --font-mono, ' +
    'and --chart-1 to --chart-8 for series, in that order (they stay apart for colour-blind readers). In a script, read them with ' +
    'getComputedStyle(document.documentElement).getPropertyValue("--chart-1"). Text stays in --foreground or --muted-foreground.',
  'Charts: one y-axis only; a legend when there are two or more series; thin lines and bars; labels only where they help; tooltips on hover.',
].join(' ')

export interface Page {
  title: string
  html: string
  height: number
  /** Pictures the page names that are not in the workspace. */
  missing: string[]
}

/** Checks a page the bot wants to show and puts its pictures into it. Throws with what to fix. */
export function makePage(botId: string, args: Record<string, unknown>): Page {
  const title = String(args.title ?? '').trim().slice(0, 120)
  if (!title) throw new Error('Give the page a title.')
  let html = typeof args.html === 'string' ? args.html : ''
  if (!html.trim() && args.path) {
    const target = ws.resolve(botId, args.path)
    if (!fs.existsSync(target.abs) || fs.statSync(target.abs).isDirectory()) throw new Error(`There is no file at ${target.rel}.`)
    html = fs.readFileSync(target.abs, 'utf8')
  }
  if (!html.trim()) throw new Error('Give the page as html, or the path of an .html file in your workspace.')
  if (html.length > MAX_HTML) throw new Error(`The page is too large (${Math.round(html.length / 1000)} KB; at most ${MAX_HTML / 1000} KB). Leave out data that is not shown.`)
  // The frame grows to fit the page, so a page sized by the frame would grow without end.
  const vh = /[\d.][dsl]?vh\b/i.exec(html.replace(/<!--[\s\S]*?-->/g, ''))
  if (vh) throw new Error('The page uses vh units, which do not work here: the page is fitted to its content. Give heights in px instead.')

  const missing: string[] = []
  let embedded = 0
  html = html.replace(/(\bsrc\s*=\s*)(["'])([^"']+)\2/gi, (whole, attr: string, quote: string, src: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(src.trim())) return whole
    const type = PICTURES[path.extname(src.split(/[?#]/)[0]).toLowerCase()]
    if (!type) return whole
    try {
      const target = ws.resolve(botId, decodeURI(src.trim().split(/[?#]/)[0]))
      const data = fs.readFileSync(target.abs)
      if ((embedded += data.length) > MAX_PICTURES) throw new Error('too large')
      return `${attr}${quote}data:${type};base64,${data.toString('base64')}${quote}`
    } catch {
      missing.push(src)
      return whole
    }
  })
  if (args.data != null) html = withData(html, args.data)
  const given = Number(args.height)
  return { title, html, height: Number.isFinite(given) && given > 0 ? Math.round(given) : 400, missing }
}

const DATA_BLOCK = /<script\b(?=[^>]*(?<![\w-])id\s*=\s*["']?page-data(?![\w-]))[^>]*>[\s\S]*?<\/script\s*>/i

/**
 * Puts the data a page is shown with into it, where the page reads it: in its own data block, or
 * else at the top. Written so that nothing in it can end the block it is in.
 */
function withData(html: string, given: unknown): string {
  let data = given
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      throw new Error('The data is not valid JSON. Give it as an object.')
    }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('Give the data as an object, such as {"view": "question"}.')
  const json = JSON.stringify({ ...data, shownAt: Date.now() }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  if (json.length > MAX_DATA) throw new Error(`The data is too large (${Math.round(json.length / 1000)} KB; at most ${MAX_DATA / 1000} KB).`)
  const block = `<script id="page-data" type="application/json">${json}</script>`
  if (DATA_BLOCK.test(html)) return html.replace(DATA_BLOCK, () => block)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  return doctype ? `${doctype[0]}${block}${html.slice(doctype[0].length)}` : `${block}${html}`
}
