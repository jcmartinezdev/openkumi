// The window's pages come from the app itself, under an address of its own (openbot://app/), not
// from any server. Installed, they are the built interface's files; while developing, each request
// is passed on to the Vite server so that changes show at once.
//
// Pages that bots show in a conversation (show_page) are handed out under another address of
// their own (openbot://page/), so that they are a different site from the app: their scripts run,
// but they cannot reach the app, its access codes or anything else in the window.
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { net, protocol } from 'electron'
import { PAGE_POLICY } from '@openbot/client/page'
import { DEV_URL, WEB } from './paths.ts'

const SCHEME = DEV_URL ? 'openbot-dev' : 'openbot'
/** The only origin the app's pages have. The server lets pages from here, and no others, read its answers. */
export const APP_ORIGIN = `${SCHEME}://app`
export const APP_URL = `${APP_ORIGIN}/`
/** Where the window finds the pages it was given (see keepPage). */
export const PAGE_ORIGIN = `${SCHEME}://page`

// Has to be said before the app is ready. `codeCache` lets the compiled interface be kept between
// starts; not while developing, when the code behind an address keeps changing.
protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: !DEV_URL } }])

/** What the app's pages may load and talk to. Scripts only ever come from the app itself. */
const POLICY = [
  "default-src 'self'",
  // Vite's live updates need an inline script while developing.
  `script-src 'self'${DEV_URL ? " 'unsafe-inline'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http: https:",
  "font-src 'self' data:",
  // Environments are at addresses the user gives, so any of them may be talked to.
  "connect-src 'self' http: https: ws: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  // Pages shown in a conversation, and nothing else: a page that tries to go elsewhere in its frame gets nowhere.
  `frame-src ${PAGE_ORIGIN}`,
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

async function asset(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.host !== 'app') return new Response(null, { status: 404 })
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 })
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return new Response(null, { status: 400 })
  }
  let file = path.resolve(WEB, `.${pathname}`)
  // Nothing outside the interface's own folder is ever handed out.
  if (pathname.includes('\0') || (file !== WEB && !file.startsWith(WEB + path.sep))) return new Response(null, { status: 404 })
  // The interface is one page: an address that names no file is that page.
  if (!path.extname(file)) file = path.join(WEB, 'index.html')
  try {
    const body = await fs.readFile(file)
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), {
      headers: { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Content-Security-Policy': POLICY },
    })
  } catch {
    return new Response(null, { status: 404 })
  }
}

/** Headers that describe the window's request to the app, and would be wrong on a request to Vite. */
const NOT_PASSED_ON = /^(host|origin|referer|connection|content-length|accept-encoding|upgrade-insecure-requests|sec-fetch-.*)$/

async function passOn(request: Request): Promise<Response> {
  const url = new URL(request.url)
  if (url.host !== 'app') return new Response(null, { status: 404 })
  const target = new URL(DEV_URL)
  // Set as parts, so that a path starting with slashes cannot name another host.
  target.pathname = url.pathname
  target.search = url.search
  const headers = new Headers(request.headers)
  for (const name of [...headers.keys()]) if (NOT_PASSED_ON.test(name)) headers.delete(name)
  const response = await net.fetch(target.toString(), { method: request.method, headers })
  const answered = new Headers(response.headers)
  answered.set('Content-Security-Policy', POLICY)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: answered })
}

/** The pages the window has asked to show, newest last. Each is named by what is in it. */
const pages = new Map<string, string>()

/** Keeps a page for the window to show in a frame, and gives its address. */
export function keepPage(html: string): string {
  const id = crypto.createHash('sha256').update(html).digest('hex').slice(0, 32)
  pages.delete(id)
  pages.set(id, html)
  // A frame loads its page once, so only the ones shown lately need to be kept.
  for (const old of pages.keys()) {
    if (pages.size <= 100) break
    pages.delete(old)
  }
  return `${PAGE_ORIGIN}/${id}`
}

function page(request: Request): Response {
  const html = pages.get(new URL(request.url).pathname.slice(1))
  if (html === undefined || request.method !== 'GET') return new Response(null, { status: 404 })
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_POLICY, 'Cache-Control': 'no-store' } })
}

/** Starts answering the window's requests for its own pages. Called once the app is ready. */
export function serveInterface() {
  const app = DEV_URL ? passOn : asset
  protocol.handle(SCHEME, (request) => (new URL(request.url).host === 'page' ? page(request) : app(request)))
}
