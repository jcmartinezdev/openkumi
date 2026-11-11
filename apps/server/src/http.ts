// The server's HTTP API and its WebSocket stream of events. There are no pages here: the interface
// is part of the desktop app, which talks to this API directly.
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import type { AppState, ClientEvent, ServerEvent } from '@openbot/shared'
import * as agent from './agent.ts'
import { announce, createBot, deleteBot, getBot, listBots, updateBot } from './bots.ts'
import { type Frame, browserFor, browserStates, isWebPage, stopBrowser } from './browser.ts'
import { HOME, HOME_LABEL, LAN, PORT, ROOT, SKILLS, accessToken, botDir, emit, onEvent, readSecrets, writeSecret } from './config.ts'
import { beginPairing, computerWith, finishPairing, listComputers, newPairingCode, removeComputer } from './clients.ts'
import * as mcp from './connections.ts'
import { installPlugin, installedPlugins, listPlugins, removePlugin, saveSetup } from './plugins.ts'
import * as db from './db.ts'
import { announceProviders, getProvider, providerInfos, refreshProviders } from './providers/index.ts'
import { DEFAULTS, onSettingsChange, settings, updateSettings } from './settings.ts'
import { listSkills, setSkill } from './skills.ts'
import { handleToolEndpoint } from './tool-endpoint.ts'
import * as ws from './workspace.ts'

const VERSION: string = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const SYSTEMS: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }

/** Whether other devices on the network are served: the setting, or the --lan flag. */
const lanOn = () => LAN || settings().lan

/** This computer's addresses on the local network. */
const addresses = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address)

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
/** The names this computer goes by when it talks to itself. */
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])
/** The desktop app's own pages, installed and in development: the only pages that may read answers. */
const APP_ORIGINS = new Set(['openbot://app', 'openbot-dev://app'])

function tokenMatches(given: string | undefined): boolean {
  const token = Buffer.from(accessToken())
  const value = Buffer.from(given ?? '')
  return value.length === token.length && crypto.timingSafeEqual(value, token)
}

/**
 * This server can drive browsers that hold the user's logins, so every request must carry a key.
 * Nothing is trusted for where it comes from, and there are no cookies, so a web page open in a
 * browser has no way in. On this computer the key is the server's own access code, which is only
 * accepted here. Another computer has the key it was given when it was paired.
 * The key travels in the Authorization header; a WebSocket cannot send one, so it uses the address.
 * Returns who is asking ("owner" or the paired computer's id), or null.
 */
function whoIs(req: http.IncomingMessage, url: URL): string | null {
  const header = req.headers.authorization
  const key = header?.startsWith('Bearer ') ? header.slice(7) : url.pathname === '/ws' ? url.searchParams.get('token') : null
  if (!key) return null
  if (LOOPBACK.has(req.socket.remoteAddress ?? '') && tokenMatches(key)) return 'owner'
  return computerWith(key)
}
const isAllowed = (req: http.IncomingMessage, url: URL) => whoIs(req, url) !== null

/** The address a request asks for, or null when it is not one that can be read (such as "//"). */
function addressOf(req: http.IncomingMessage): URL | null {
  try {
    return new URL(req.url ?? '/', 'http://localhost')
  } catch {
    return null
  }
}

/** Lets the desktop app's pages, which are not served from here, read the answers. */
function allowApp(req: http.IncomingMessage, res: http.ServerResponse) {
  const origin = req.headers.origin
  if (!origin || !APP_ORIGINS.has(origin)) return
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  res.setHeader('Access-Control-Max-Age', '7200')
}

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new HttpError(413, 'Request body too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req: http.IncomingMessage): Promise<Record<string, any>> {
  const body = await readBody(req, 8_000_000)
  if (!body.length) return {}
  try {
    return JSON.parse(body.toString())
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

interface Call {
  url: URL
  req: http.IncomingMessage
  res: http.ServerResponse
}
type Handler = (params: string[], body: Record<string, any>, call: Call) => unknown
/** Returned by a handler that has written the response itself. */
const SENT = Symbol('sent')

/** `raw` routes read the request body themselves instead of receiving it as JSON. */
const routes: [method: string, pattern: RegExp, handler: Handler, raw: boolean][] = []
const route = (method: string, pattern: string, handler: Handler, raw = false) =>
  routes.push([method, new RegExp(`^${pattern.replace(/:\w+/g, '([^/]+)')}$`), handler, raw])

const needBot = (id: string) => getBot(id) ?? fail(404, 'No such bot')
const needThread = (id: string) => db.getThread(id) ?? fail(404, 'No such thread')
function fail(status: number, message: string): never {
  throw new HttpError(status, message)
}

route('GET', '/api/state', (): AppState => ({
  bots: listBots(),
  threads: db.listThreads(),
  providers: providerInfos(),
  browsers: browserStates(),
  skills: listSkills(),
  connections: mcp.listConnections(),
  plugins: listPlugins(),
  connectionStatus: mcp.connectionStatuses(),
  home: HOME_LABEL,
  settings: settings(),
  defaults: DEFAULTS,
  about: { version: VERSION, node: process.version, platform: `${SYSTEMS[process.platform] ?? process.platform} ${os.release()}`, port: PORT, lanForced: LAN },
}))

// ---- settings for the whole app
route('PATCH', '/api/settings', (_, body) => updateSettings(body))
// How other computers get in: whether they can reach this one, where, and which ones are paired.
route('GET', '/api/access', () => ({ on: lanOn(), port: PORT, addresses: addresses(), computers: listComputers() }))
// A code for pairing one more computer. It works once, for a few minutes.
// Who gets in is decided at this computer, not by a computer that was let in.
const ownerOnly = ({ req, url }: Call) => whoIs(req, url) === 'owner' || fail(403, 'Computers are paired and removed on the computer running Open Bot.')
route('POST', '/api/pairing', (_, __, call) => (ownerOnly(call), newPairingCode()))
// Taking a computer's key away also ends whatever it has open.
route('DELETE', '/api/computers/:id', ([id], _, call) => {
  ownerOnly(call)
  if (!removeComputer(id)) fail(404, 'No such computer')
  hangUp(id)
})
// Opens a folder in the file manager of the computer running Open Bot, so only that computer may ask.
route('POST', '/api/reveal', (_, body, { req }) => {
  if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) fail(403, 'Folders can only be opened from the computer running Open Bot.')
  const dir = body.botId ? botDir(needBot(String(body.botId)).id) : body.what === 'skills' ? SKILLS : HOME
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  spawn(opener, [dir], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref()
})
route('DELETE', '/api/threads', () => {
  for (const t of db.listThreads().filter((t) => !t.parentId)) {
    agent.stop(t.id)
    db.deleteThread(t.id)
  }
})

// ---- bots
route('POST', '/api/bots', (_, body) => createBot(body))
route('PATCH', '/api/bots/:id', ([id], body) => updateBot(needBot(id).id, body))
route('DELETE', '/api/bots/:id', async ([id]) => {
  needBot(id)
  for (const t of db.listThreads().filter((t) => t.botId === id)) agent.stop(t.id)
  await stopBrowser(id)
  // Its plugins go first, so nothing they brought is left behind for no bot.
  for (const plugin of installedPlugins(id)) await removePlugin(id, plugin)
  await mcp.closeBotConnections(id)
  db.deleteBotThreads(id)
  deleteBot(id)
  emit({ type: 'plugins', plugins: listPlugins() })
})

// ---- skills and connections: what a bot may use, set by its owner
route('GET', '/api/skills', () => listSkills())
route('PUT', '/api/bots/:id/skills/:name', ([id, name], body) => {
  setSkill(needBot(id).id, name, !!body.on)
  return announce(id)
})
// ---- plugins: ready-made abilities, installed for one bot at a time
const announcePlugins = () => emit({ type: 'plugins', plugins: listPlugins() })
route('GET', '/api/plugins', () => listPlugins())
route('PUT', '/api/bots/:id/plugins/:plugin', async ([id, plugin], body) => {
  if (body.on === false) await removePlugin(needBot(id).id, plugin)
  else await installPlugin(needBot(id).id, plugin)
  announcePlugins()
  return announce(id)
})
// What the owner provides once for the plugins that need it, such as a client created with Google.
route('PUT', '/api/plugins/setup/:id', async ([id], body) => {
  for (const botId of await saveSetup(id, body)) announce(botId)
  announcePlugins()
})

route('POST', '/api/connections', (_, body, { req }) => {
  // A local program runs with the user's full rights, so only this computer may add one.
  if (body.command && !LOOPBACK.has(req.socket.remoteAddress ?? '')) fail(403, 'A local program can only be added from the computer running Open Bot.')
  mcp.addConnection(body)
})
route('DELETE', '/api/connections/:name', async ([name]) => {
  for (const id of await mcp.removeConnection(name)) announce(id)
})
route('PUT', '/api/bots/:id/connections/:name', async ([id, name], body) => {
  await mcp.setConnection(needBot(id).id, name, !!body.on)
  return announce(id)
})
route('POST', '/api/bots/:id/connections/check', ([id]) => mcp.checkConnections(needBot(id).id))
route('POST', '/api/bots/:id/connections/:name/login', ([id, name]) => mcp.login(needBot(id).id, name))
route('POST', '/api/bots/:id/connections/:name/logout', ([id, name]) => mcp.logout(needBot(id).id, name))
// Where a connection's sign-in page sends the browser back to.
route('GET', '/api/mcp/callback', async (_, __, { url, res }) => {
  let message = 'Connected. You can close this tab and go back to Open Bot.'
  try {
    await mcp.finishLogin(url.searchParams)
  } catch (e: any) {
    message = `Sign-in failed: ${String(e?.message ?? e).split('\n')[0]}`
  }
  const safe = message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Open Bot</title>
<body style="font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#0c0c0d;color:#ededef"><p style="max-width:420px;padding:24px;text-align:center">${safe}</p>`)
  return SENT
})

// ---- files: the bot's workspace, as its owner sees it
const filePath = (url: URL) => url.searchParams.get('path') ?? ''
route('GET', '/api/bots/:id/files', ([id]) => ({ entries: ws.tree(needBot(id).id) }))
route('GET', '/api/bots/:id/file', ([id], _, { url, res }) => {
  needBot(id)
  if (!url.searchParams.has('download')) return ws.open(id, filePath(url))
  const { abs } = ws.resolve(id, filePath(url))
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) fail(404, 'No such file')
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': fs.statSync(abs).size,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(abs))}`,
    'X-Content-Type-Options': 'nosniff',
  })
  fs.createReadStream(abs).pipe(res)
  return SENT
})
route('PUT', '/api/bots/:id/file', async ([id], body, { url }) => {
  needBot(id)
  if (typeof body.content !== 'string') fail(400, 'File content is required')
  const saved = ws.write(id, filePath(url), body.content)
  await ws.commit(id, 'you', `Edit ${saved}`)
})
route('DELETE', '/api/bots/:id/file', async ([id], _, { url }) => {
  const removed = ws.remove(needBot(id).id, filePath(url))
  await ws.commit(id, 'you', `Delete ${removed}`)
})
route('POST', '/api/bots/:id/upload', async ([id], _, { url, req }) => {
  needBot(id)
  const data = await readBody(req, 100_000_000)
  return { path: ws.write(id, ws.incoming(id, url.searchParams.get('name') ?? 'upload'), data) }
}, true)
route('GET', '/api/bots/:id/history', ([id]) => ws.history(needBot(id).id))
route('GET', '/api/bots/:id/history/:change', async ([id, change]) => ({ diff: await ws.diff(needBot(id).id, change) }))
route('POST', '/api/bots/:id/history/:change/undo', ([id, change]) => ws.undo(needBot(id).id, change))

// ---- threads
route('POST', '/api/bots/:id/threads', ([id]) => db.createThread({ botId: needBot(id).id }))
route('GET', '/api/threads/:id', ([id]) => ({
  thread: needThread(id),
  items: db.listItems(id),
  partial: agent.partialOf(id),
}))
route('POST', '/api/threads/:id/messages', ([id], body) => {
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) fail(400, 'Message text is required')
  agent.postMessage(needThread(id).id, text, 'user')
})
route('POST', '/api/threads/:id/stop', ([id]) => agent.stop(needThread(id).id))
route('DELETE', '/api/threads/:id', ([id]) => {
  agent.stop(needThread(id).id)
  db.deleteThread(id)
})

// ---- providers
route('GET', '/api/providers/:id/models', async ([id]) => getProvider(id).models())
// Claude Code and Codex are programs on this computer; this looks again at whether they are installed and signed in.
route('POST', '/api/providers/check', () => refreshProviders())
route('PUT', '/api/providers/openai-compatible', (_, body) => {
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : ''
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) fail(400, 'Base URL must start with http:// or https://')
  // An empty key keeps the stored one, so the URL can be edited without retyping the key.
  const apiKey = String(body.apiKey ?? '') || (readSecrets().compat?.apiKey ?? '')
  writeSecret('compat', baseUrl ? { baseUrl, apiKey } : null)
  announceProviders()
})

// ---- browser
route('POST', '/api/bots/:id/browser/:action', async ([id, action], body) => {
  const bot = needBot(id)
  const browser = browserFor(id)
  if (action === 'stop') return void (await browser.stop())
  await browser.start(bot.headless)
  if (action === 'start') return
  // A bot's browser is for the web. Files on this computer stay out of it, whoever is driving.
  const web = (url: string) => (isWebPage(url) ? url : fail(400, 'Only web addresses can be opened in a bot’s browser.'))
  if (action === 'new-tab') return { tabId: (await browser.newTab(null, body.url ? web(String(body.url)) : undefined)).id }
  const { page } = browser.tab(String(body.tabId))
  const nav = { waitUntil: 'commit', timeout: 30_000 } as const
  if (action === 'navigate') {
    const raw = String(body.url ?? '').trim()
    const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : raw.includes('.') && !raw.includes(' ') ? `https://${raw}` : `https://www.google.com/search?q=${encodeURIComponent(raw)}`
    await page.goto(web(url), nav)
  } else if (action === 'back') await page.goBack(nav)
  else if (action === 'forward') await page.goForward(nav)
  else if (action === 'reload') await page.reload(nav)
  else if (action === 'close-tab') await page.close()
  else fail(404, 'Unknown browser action')
})

/** Ends the connections a paired computer has open. Set once the server exists. */
let hangUp = (_who: string) => {}

/** What someone sees who opens the server's address in a browser. */
const NOTE = `This is an Open Bot server. It has no page of its own.

To use it, open the Open Bot desktop app, go to Settings > Environments,
choose "Add environment" and paste the link you were given.
`

function createServer() {
  const server = http.createServer(async (req, res) => {
    const url = addressOf(req)
    if (!url) return void res.writeHead(400).end()
    allowApp(req, res)
    if (req.method === 'OPTIONS') return void res.writeHead(204).end()
    // An engine fetching the tools of the turn it is running. Only programs on this computer may,
    // and the address itself is the secret: it is made for one turn and stops working after it.
    const tools = url.pathname.match(/^\/mcp\/([\w-]+)$/)
    if (tools) {
      if (!LOOPBACK.has(req.socket.remoteAddress ?? '')) return void res.writeHead(403).end()
      return handleToolEndpoint(req, res, tools[1])
    }
    if (!url.pathname.startsWith('/api/')) return void res.writeHead(url.pathname === '/' ? 200 : 404, { 'Content-Type': 'text/plain; charset=utf-8' }).end(NOTE)
    const json = (status: number, body: unknown) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
    // Who is here: lets the desktop app tell an Open Bot server from anything else at an address,
    // and whether the access code it holds is still the right one.
    if (url.pathname === '/api/hello') {
      // The app on this computer reads the access code from the data folder, so it is told where
      // that is. A web page that has had its own name pointed at this computer is not: it would
      // arrive from this computer too, but asking for that other name.
      const local = LOOPBACK.has(req.socket.remoteAddress ?? '') && LOCAL.has((req.headers.host ?? '').replace(/:\d+$/, ''))
      // Before the app sends the code it read there, it wants to know that this really is the
      // server the code belongs to, and not something else that got to the port first. So it sends
      // a value of its own choosing, and gets back that value signed with the code.
      const challenge = url.searchParams.get('challenge')
      const proof = local && challenge ? { proof: crypto.createHmac('sha256', accessToken()).update(challenge).digest('hex') } : {}
      return void json(200, { app: 'open-bot', version: VERSION, authorized: isAllowed(req, url), ...(local ? { home: HOME } : {}), ...proof })
    }
    try {
      // Pairing: a computer that has no key yet shows that it was given the code (see clients.ts).
      if (req.method === 'POST' && url.pathname === '/api/pair/begin') {
        const begun = beginPairing(String((await readJson(req)).nonce ?? ''))
        return void (begun ? json(200, begun) : json(403, { error: 'There is no pairing code to use right now. Make a new one on the other computer.' }))
      }
      if (req.method === 'POST' && url.pathname === '/api/pair/finish') {
        const body = await readJson(req)
        const paired = finishPairing(String(body.nonce ?? ''), String(body.serverNonce ?? ''), String(body.proof ?? ''), String(body.name ?? ''))
        return void (paired ? json(200, paired) : json(403, { error: 'The pairing code was not right, or it has run out. Make a new one on the other computer.' }))
      }
    } catch (e: any) {
      return void json(e instanceof HttpError ? e.status : 500, { error: String(e?.message ?? e).split('\n')[0] })
    }
    // Where a connection's sign-in page sends the browser back to. It proves itself with the
    // one-time state the sign-in was started with, not with a key.
    if (url.pathname !== '/api/mcp/callback' && !isAllowed(req, url)) return void json(401, { error: 'The access code was not accepted.' })
    try {
      for (const [method, pattern, handler, raw] of routes) {
        const match = req.method === method && url.pathname.match(pattern)
        if (!match) continue
        const body = method === 'GET' || raw ? {} : await readJson(req)
        const result = await handler(match.slice(1).map(decodeURIComponent), body, { url, req, res })
        if (result === SENT) return
        return void json(200, result ?? { ok: true })
      }
      throw new HttpError(404, 'Not found')
    } catch (e: any) {
      json(e instanceof HttpError ? e.status : 500, { error: String(e?.message ?? e).split('\n')[0] })
    }
  })

  const wss = new WebSocketServer({ noServer: true })
  /** Who opened each connection: "owner", or a paired computer's id. */
  const owners = new WeakMap<WebSocket, string>()
  server.on('upgrade', (req, socket, head) => {
    const url = addressOf(req)
    const who = url?.pathname === '/ws' ? whoIs(req, url) : null
    if (!who) return socket.destroy()
    wss.handleUpgrade(req, socket, head, (ws) => {
      owners.set(ws, who)
      wss.emit('connection', ws)
    })
  })

  const send = (ws: WebSocket, event: ServerEvent) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(event))
  /**
   * A picture of a bot's browser, sent as bytes rather than as text inside an event, so that the
   * app can hand it to a worker without reading it: one byte saying what this is (1, a picture),
   * the picture's width and height (two bytes each), the length of the view's name (two bytes),
   * the name ("<bot>:<tab>"), then the JPEG itself.
   */
  const sendFrame = (ws: WebSocket, key: string, frame: Frame) => {
    // A slow connection gets fewer pictures instead of a growing queue of old ones.
    if (ws.readyState !== ws.OPEN || ws.bufferedAmount > 1_500_000) return
    const name = Buffer.from(key)
    const head = Buffer.alloc(7)
    head.writeUInt8(1, 0)
    head.writeUInt16BE(frame.width, 1)
    head.writeUInt16BE(frame.height, 3)
    head.writeUInt16BE(name.length, 5)
    ws.send(Buffer.concat([head, name, Buffer.from(frame.data, 'base64')]), { binary: true })
  }
  onEvent((event) => wss.clients.forEach((ws) => send(ws, event)))

  wss.on('connection', (ws) => {
    // Live browser views this socket is watching, keyed by bot and tab.
    const views = new Map<string, Promise<() => void>>()
    const drop = (key: string) => {
      views.get(key)?.then((unsubscribe) => unsubscribe()).catch(() => {})
      views.delete(key)
    }
    ws.on('message', (raw) => {
      let msg: ClientEvent
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return
      }
      const browser = browserFor(msg.botId)
      const key = `${msg.botId}:${msg.tabId}`
      if (msg.type === 'browser.subscribe') {
        if (views.has(key)) return
        const { botId, tabId } = msg
        const view = browser.subscribe(tabId, (f) => sendFrame(ws, `${botId}:${tabId}`, f))
        views.set(key, view)
        view.catch(() => views.delete(key))
      } else if (msg.type === 'browser.unsubscribe') {
        drop(key)
      } else if (msg.type === 'browser.input') {
        browser.input(msg.tabId, msg.input)
      }
    })
    ws.on('close', () => [...views.keys()].forEach(drop))
  })

  /** Ends every open connection, so the server can stop listening at once. */
  const hangUpAll = () => {
    wss.clients.forEach((ws) => ws.terminate())
    server.closeAllConnections()
  }
  hangUp = (who) => wss.clients.forEach((ws) => owners.get(ws) === who && ws.terminate())
  return { server, hangUp: hangUpAll }
}

/** The app that started this server, when one did: the desktop app runs it as a process of its own. */
const parent = (process as { parentPort?: { postMessage(message: unknown): void } }).parentPort

/**
 * Starts serving. Only this computer is served unless network access is on; switching that on or
 * off in Settings means listening on a different address, which is done here without a restart.
 */
export function startServer(): http.Server {
  const { server, hangUp } = createServer()
  const wanted = () => (lanOn() ? '0.0.0.0' : '127.0.0.1')
  let host = wanted()
  const describe = () => {
    // Run by the desktop app, what is printed goes into a log file, and the app shows the link itself.
    if (host === '127.0.0.1' || parent) return
    console.log(`  Other computers on your network can reach it at ${addresses().map((ip) => `http://${ip}:${PORT}`).join(' or ')}`)
    console.log('  To let one in, run "npm run pair" here and enter the code it prints in the app there.\n')
  }
  server.on('error', (e: NodeJS.ErrnoException) => {
    console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Set OPENBOT_PORT to use another.` : e)
    process.exit(1)
  })
  server.listen(PORT, host, () => {
    // Made now rather than at the first request, so the app on this computer can read it.
    accessToken()
    console.log(`\n  The Open Bot server is running at http://127.0.0.1:${PORT}`)
    console.log('  It has no page of its own: open the Open Bot desktop app to use it.\n')
    describe()
    parent?.postMessage({ type: 'ready', port: PORT })
    process.send?.({ type: 'ready', port: PORT })
  })
  onSettingsChange(() => {
    if (wanted() === host) return
    host = wanted()
    // The request that changed the setting is answered first; then everyone is moved over.
    setTimeout(() => {
      server.close(() =>
        server.listen(PORT, host, () => {
          console.log(host === '127.0.0.1' ? '  Network access is off: only this computer is served.\n' : '  Network access is on.')
          describe()
        }),
      )
      hangUp()
    }, 150)
  })
  return server
}
