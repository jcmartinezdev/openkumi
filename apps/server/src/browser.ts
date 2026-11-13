// One Chromium instance per bot, each with its own persistent profile directory, so cookies and
// logins belong to that bot alone and survive restarts. Inside it, every thread that browses (the
// conversation, a subagent, a scheduled run) gets a window of its own, so sessions that run at the
// same time never get in each other's way. The UI watches a window's tabs through a CDP screencast
// and, once the owner takes control of it, drives them; agent tools drive them through Playwright.
import crypto from 'node:crypto'
import path from 'node:path'
import { type BrowserContext, type CDPSession, type Page, type Request, chromium } from 'playwright-core'
import type { BrowserInput, BrowserState } from '@openbot/shared'
import { PORT, emit, privateDir } from './config.ts'
import { settings } from './settings.ts'
import { incoming, resolve } from './workspace.ts'

const VIEWPORT = { width: 1280, height: 800 }

// A bot's browser must not be able to open Open Bot itself: coming from this computer it would be
// trusted like the owner, and could change the bot's rules and superpowers. These rules
// make Chrome send any request for this server's address somewhere that refuses it.
const NO_SELF_ACCESS = `--host-rules=${['localhost', '127.0.0.1', '[::1]', '[::ffff:7f00:1]'].map((host) => `MAP ${host}:${PORT} 0.0.0.0:1`).join(', ')}`

/**
 * Where a service sends the browser back to after a superpower's sign-in. It is Open Bot's own
 * address, which a bot's browser cannot reach; what matters is the address itself, which carries
 * the result, and which the browser hands over on the way (see signIn).
 */
export const SIGN_IN_RETURN = `http://localhost:${PORT}/api/superpowers/callback`
/** The made-up thread a sign-in's window belongs to, so it is a window of its own. */
const signInThread = (key: string) => `sign-in:${key}`

/** The page a sign-in ends on, in the bot's browser. */
const ending = (message: string) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Open Bot</title>
<body style="font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0;background:#0c0c0d;color:#ededef"><p style="max-width:420px;padding:24px;text-align:center">${message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</p>`

/** What the bot is told when it tries to act in a window the owner has taken control of. */
export const OWNER_HAS_CONTROL =
  'The user has taken control of this browser window and is using it. You can still read the page ' +
  '(browser_snapshot, browser_read) but cannot act in it until they hand it back. Do not retry now: go on ' +
  'with other work, or end your turn and say what you are waiting for.'

/** Pages a bot may read and act on: the web, and blank or inline pages. Never files on this computer or the browser's own pages. */
export function isWebPage(url: string) {
  return /^(https?|about|data|blob):/i.test(url)
}

export interface Frame {
  data: string
  width: number
  height: number
}

/** How a request to the owner to take over a window ended. */
export type AskOutcome = 'done' | 'declined' | 'left' | 'closed' | 'timeout' | 'stopped'

interface Tab {
  id: string
  page: Page
  win: Win
  /** The screencast, while someone watches: who, and the latest picture, which is all a newcomer gets of a page that is not changing. */
  cast?: { cdp: CDPSession; subs: Set<(f: Frame) => void>; last: Frame | null }
  /** Serialises forwarded input so events apply in the order they were sent. */
  queue: Promise<unknown>
}

/** A window of the browser, and the thread that works in it. Popups open in the window of the page that opened them. */
interface Win {
  id: string
  /** Chrome's numbers for the windows its tabs are in. */
  chromeIds: Set<number>
  /** The thread that works in it; null for the window Chrome starts with, until a thread needs one. */
  threadId: string | null
  /** The window Chrome opened at launch, which the first thread to need a window takes over. */
  spare: boolean
  /** Its tabs, in the order they were opened. */
  tabs: Tab[]
  /** The tab the bot works in: the newest still open (a popup, while it is open), unless the owner picked another. */
  active: Tab | null
  /** The app view that has taken control, or null while the bot has it. */
  controller: string | null
  /** The owner had control since the bot last used it, which the bot is told. */
  touched: boolean
  /** What the bot asked the owner to do in it (browser_ask_user), and how to tell it how that ended. */
  request: { text: string; taken: boolean; settle: (outcome: AskOutcome) => void } | null
  /** When the bot last used it. */
  usedAt: number
  retiring?: NodeJS.Timeout
}

const newId = () => crypto.randomBytes(4).toString('hex')

class BotBrowser {
  botId: string
  context: BrowserContext | null = null
  headless = true
  tabs = new Map<string, Tab>()
  windows = new Map<string, Win>()
  /** Every page seen, and the tab it became: adopting a page takes a moment, and may be asked for twice. */
  private adopted = new WeakMap<Page, Promise<Tab | null>>()
  /** Tabs by the id Chrome knows them by, so a window that was asked for can be found when it opens. */
  private targets = new Map<string, Tab>()
  private expected = new Map<string, (tab: Tab) => void>()
  /** Windows being opened, by the thread they are for. */
  private opening = new Map<string, Promise<Win>>()
  /** Sign-ins under way, by the window they are in: what finishes one when the service sends the browser back. */
  private signIns = new Map<string, (back: URL) => Promise<void>>()
  private starting: Promise<void> | null = null
  private stateTimer: NodeJS.Timeout | null = null

  constructor(botId: string) {
    this.botId = botId
  }

  state(): BrowserState {
    const windows = [...this.windows.values()]
    return {
      running: !!this.context,
      headless: this.headless,
      tabs: windows.flatMap((w) => w.tabs.map((t) => ({ id: t.id, url: t.page.url(), title: '', threadId: w.threadId, windowId: w.id }))),
      windows: windows.map((w) => ({
        id: w.id,
        threadId: w.threadId,
        activeTab: w.active?.id ?? null,
        controller: w.controller,
        request: w.request?.text ?? null,
        usedAt: w.usedAt,
      })),
    }
  }

  private announce() {
    if (this.stateTimer) return
    this.stateTimer = setTimeout(async () => {
      this.stateTimer = null
      const state = this.state()
      await Promise.all(
        state.tabs.map(async (t) => {
          t.title = (await this.tabs.get(t.id)?.page.title().catch(() => '')) ?? ''
        }),
      )
      emit({ type: 'browser.state', botId: this.botId, state })
    }, 100)
  }

  async start(headless: boolean) {
    if (this.context) return
    this.starting ??= this.launch(headless).finally(() => (this.starting = null))
    await this.starting
  }

  private async launch(headless: boolean) {
    const options = {
      headless,
      viewport: VIEWPORT,
      args: ['--disable-blink-features=AutomationControlled', '--no-first-run', '--no-default-browser-check', NO_SELF_ACCESS],
      ignoreDefaultArgs: ['--enable-automation'],
    }
    const profile = path.join(privateDir(this.botId), 'browser-profile')
    // "chromium" means the browser that comes with Playwright, which is started without a channel.
    const chosen = process.env.OPENBOT_BROWSER_CHANNEL ?? settings().browserChannel
    const channel = chosen === 'chromium' ? undefined : chosen
    let context: BrowserContext
    try {
      context = await chromium.launchPersistentContext(profile, { ...options, channel })
    } catch (first: any) {
      try {
        // No system Chrome: fall back to Playwright's own Chromium build.
        context = await chromium.launchPersistentContext(profile, options)
      } catch {
        throw new Error(
          `Could not start a browser. Install Google Chrome, or run "npx playwright-core install chromium". (${String(first.message).split('\n')[0]})`,
        )
      }
    }
    this.context = context
    this.headless = headless
    // Seen however the browser gets there: services usually send it back with a redirect.
    context.on('request', (request) => request.url().startsWith(`${SIGN_IN_RETURN}?`) && void this.signInReturned(request))
    context.on('page', (page) => void this.adopt(page))
    context.on('close', () => {
      if (this.context === context) this.forget()
    })
    for (const page of context.pages()) await this.adopt(page, true)
    this.announce()
  }

  private adopt(page: Page, spare = false): Promise<Tab | null> {
    let adopting = this.adopted.get(page)
    if (!adopting) {
      adopting = this.place(page, spare)
      this.adopted.set(page, adopting)
    }
    return adopting
  }

  /** Gives a new page a tab in the window it belongs to. */
  private async place(page: Page, spare: boolean): Promise<Tab | null> {
    const context = this.context
    // A popup belongs with the page that opened it, whichever window Chrome put it in.
    const opener = await page.opener().catch(() => null)
    const parent = opener ? await this.adopted.get(opener) : null
    const { targetId, chromeId } = await this.whereIs(page)
    if (page.isClosed() || !context || this.context !== context) return null
    let win = parent?.win.tabs.length ? parent.win : [...this.windows.values()].find((w) => chromeId !== null && w.chromeIds.has(chromeId))
    if (!win) {
      win = { id: newId(), chromeIds: new Set(), threadId: null, spare, tabs: [], active: null, controller: null, touched: false, request: null, usedAt: 0 }
      this.windows.set(win.id, win)
    }
    if (chromeId !== null) win.chromeIds.add(chromeId)
    const tab: Tab = { id: newId(), page, win, queue: Promise.resolve() }
    this.tabs.set(tab.id, tab)
    win.tabs.push(tab)
    // Work carries on in the newest tab: a sign-in popup, say, until it closes again.
    win.active = tab
    if (targetId) this.targets.set(targetId, tab)
    // Downloads land in the bot's files/inbox/ folder, where its file tools and the Files tab can reach them.
    page.on('download', (download) => {
      Promise.resolve()
        .then(() => download.saveAs(resolve(this.botId, incoming(this.botId, download.suggestedFilename())).abs))
        .then(() => emit({ type: 'files.changed', botId: this.botId }), () => {})
    })
    page.on('framenavigated', (frame) => frame === page.mainFrame() && this.announce())
    page.on('domcontentloaded', () => this.announce())
    page.on('close', () => {
      if (targetId) this.targets.delete(targetId)
      this.drop(tab)
    })
    this.expected.get(targetId)?.(tab)
    this.announce()
    return tab
  }

  /** The id Chrome knows a page by, and the number of the window it is in. */
  private async whereIs(page: Page): Promise<{ targetId: string; chromeId: number | null }> {
    let cdp: CDPSession | undefined
    try {
      cdp = await this.context!.newCDPSession(page)
      const { targetInfo } = await cdp.send('Target.getTargetInfo')
      const window = await cdp.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId }).catch(() => null)
      return { targetId: targetInfo.targetId, chromeId: window?.windowId ?? null }
    } catch {
      return { targetId: '', chromeId: null }
    } finally {
      cdp?.detach().catch(() => {})
    }
  }

  private drop(tab: Tab) {
    if (!this.tabs.delete(tab.id)) return
    const win = tab.win
    win.tabs = win.tabs.filter((t) => t !== tab)
    // Back to the page the closed one was opened from.
    if (win.active === tab) win.active = win.tabs.at(-1) ?? null
    if (!win.tabs.length) {
      this.windows.delete(win.id)
      this.signIns.delete(win.id)
      clearTimeout(win.retiring)
      win.request?.settle('closed')
    }
    this.announce()
  }

  private forget() {
    for (const win of this.windows.values()) {
      clearTimeout(win.retiring)
      win.request?.settle('closed')
    }
    this.context = null
    this.tabs.clear()
    this.windows.clear()
    this.targets.clear()
    this.announce()
  }

  /** Opens a new window, with one empty tab. */
  private async openWindow(): Promise<Win> {
    const context = this.context
    if (!context) throw new Error('Browser is not running')
    const any = this.tabs.values().next().value
    if (!any) {
      // With no window open, Chrome puts a new tab in a window of its own.
      const tab = await this.adopt(await context.newPage())
      if (!tab) throw new Error('The new browser window closed as it opened')
      return tab.win
    }
    const cdp = await context.newCDPSession(any.page)
    let targetId: string
    try {
      ;({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true }))
    } finally {
      cdp.detach().catch(() => {})
    }
    const tab =
      this.targets.get(targetId) ??
      (await new Promise<Tab>((resolve, reject) => {
        const timer = setTimeout(() => (this.expected.delete(targetId), reject(new Error('A new browser window did not open'))), 15_000)
        this.expected.set(targetId, (tab) => (clearTimeout(timer), this.expected.delete(targetId), resolve(tab)))
      }))
    return tab.win
  }

  private windowOf(threadId: string): Win | undefined {
    return [...this.windows.values()].find((w) => w.threadId === threadId && w.tabs.length)
  }

  /** Stops a window from being closed for having finished its work: it is wanted again. */
  private keep(win: Win): Win {
    clearTimeout(win.retiring)
    win.retiring = undefined
    return win
  }

  /** The window a thread works in, opened if it has none yet. */
  async windowFor(threadId: string): Promise<Win> {
    const mine = this.windowOf(threadId)
    if (mine) return this.keep(mine)
    const opening = this.opening.get(threadId)
    if (opening) return opening
    // The empty window Chrome starts with goes to the first thread that needs one.
    const spare = [...this.windows.values()].find((w) => w.spare && !w.threadId)
    if (spare) {
      spare.spare = false
      spare.threadId = threadId
      this.announce()
      return spare
    }
    const opened = this.openWindow()
      .then((win) => {
        win.threadId = threadId
        this.announce()
        return win
      })
      .finally(() => this.opening.delete(threadId))
    this.opening.set(threadId, opened)
    return opened
  }

  /**
   * The page a thread's bot works in: the active tab of the thread's own window, so subagents and
   * scheduled runs can browse at the same time. Acting is refused while the owner has control.
   */
  async pageFor(threadId: string, headless: boolean, act = true): Promise<Page> {
    await this.start(headless)
    const win = await this.windowFor(threadId)
    if (act && win.controller) throw new Error(OWNER_HAS_CONTROL)
    if (!win.active) throw new Error('That browser window was closed.')
    win.usedAt = Date.now()
    this.announce()
    return win.active.page
  }

  /** What the bot should be told, with the result of a browser tool, about what the owner did with its window. */
  news(threadId: string): string {
    const win = this.windowOf(threadId)
    if (!win) return ''
    if (win.controller) return '(The user has control of this window right now: you can read it but not act in it.)'
    if (!win.touched) return ''
    win.touched = false
    return '(The user used this browser window since you last looked, and has handed it back. The page may have changed.)'
  }

  /** Gives the window one thread was working in to another, when the first is set aside. */
  handOver(from: string, to: string) {
    const win = this.windowOf(from)
    if (!win || this.windowOf(to)) return
    win.threadId = to
    this.announce()
  }

  tab(tabId: string): Tab {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error('That tab is closed')
    return tab
  }

  /** The owner picked a tab of a window they control: the bot carries on there when it gets the window back. */
  focus(tab: Tab) {
    tab.win.active = tab
    this.announce()
  }

  /** The owner takes control of a window, from one view of the app. The bot can then only read it, until it is handed back. */
  take(windowId: string, viewer: string) {
    const win = this.windows.get(windowId)
    if (!win) return
    win.controller = viewer
    win.touched = true
    if (win.request) win.request.taken = true
    this.keep(win)
    this.announce()
  }

  /** Hands a window back to the bot. Given a view, only if that view is the one in control. */
  give(windowId: string, viewer?: string, outcome: AskOutcome = 'done') {
    const win = this.windows.get(windowId)
    if (!win?.controller || (viewer && win.controller !== viewer)) return
    win.controller = null
    if (win.request?.taken) win.request.settle(outcome)
    this.announce()
  }

  /** The owner said no to what the bot asked of them. */
  decline(windowId: string) {
    this.windows.get(windowId)?.request?.settle('declined')
  }

  /** A view of the app went away: the windows it had control of go back to the bot. */
  letGo(viewer: string) {
    for (const win of this.windows.values()) if (win.controller === viewer) this.give(win.id, viewer, 'left')
  }

  /** The view of the app in control of the window a tab is in, or null while the bot has it. */
  controllerOf(tabId: string): string | null {
    return this.tabs.get(tabId)?.win.controller ?? null
  }

  /**
   * Asks the owner to take over a thread's window for something only they can do (a sign-in, a
   * CAPTCHA), and waits until they hand it back, say no, or `timeoutMs` passes.
   */
  async ask(threadId: string, headless: boolean, text: string, signal: AbortSignal, timeoutMs: number): Promise<AskOutcome> {
    await this.start(headless)
    const win = await this.windowFor(threadId)
    signal.throwIfAborted()
    if (win.request) throw new Error('You are already waiting for the user in this window.')
    win.usedAt = Date.now()
    return new Promise<AskOutcome>((done) => {
      const request: NonNullable<Win['request']> = {
        text,
        // Asked while the owner is already in control: handing back is all that is left to do.
        taken: !!win.controller,
        settle: (outcome) => {
          if (win.request !== request) return
          win.request = null
          clearTimeout(timer)
          signal.removeEventListener('abort', stopped)
          // How it went is the answer the bot gets; there is nothing left to tell it later.
          win.touched = false
          this.announce()
          done(outcome)
        },
      }
      const timer = setTimeout(() => request.settle('timeout'), timeoutMs)
      const stopped = () => request.settle('stopped')
      signal.addEventListener('abort', stopped, { once: true })
      win.request = request
      this.keep(win)
      this.announce()
    })
  }

  /**
   * Opens a service's sign-in page in a window of its own, for the owner to take control of. It is
   * the bot's own browser, so whoever signs in there is signed in for this bot alone. When the
   * service sends the browser back, `finish` completes the sign-in and the window closes.
   */
  async signIn(key: string, url: string, headless: boolean, finish: (back: URL) => Promise<void>): Promise<string> {
    await this.start(headless)
    const win = await this.windowFor(signInThread(key))
    this.signIns.set(win.id, finish)
    if (!win.active) throw new Error('That browser window was closed.')
    // A service that knows the bot already may send the browser straight back, which goes nowhere
    // as a page; whatever went wrong otherwise is on the page, for the owner to see.
    await win.active.page.goto(url, { waitUntil: 'commit', timeout: 30_000 }).catch(() => {})
    return win.id
  }

  /** Closes the window of a sign-in that was given up. */
  endSignIn(key: string) {
    for (const tab of [...(this.windowOf(signInThread(key))?.tabs ?? [])]) tab.page.close().catch(() => {})
  }

  /**
   * A service sent the browser back to Open Bot. The request itself goes nowhere; only in a
   * sign-in's own window does its address finish the sign-in, once.
   */
  private async signInReturned(request: Request) {
    let tab: Tab | undefined
    try {
      const page = request.frame().page()
      tab = request.isNavigationRequest() ? [...this.tabs.values()].find((t) => t.page === page) : undefined
    } catch {
      // Not a page's request (a worker's, say): it is no one's sign-in.
    }
    const finish = tab && this.signIns.get(tab.win.id)
    if (!tab || !finish) return
    const win = tab.win
    this.signIns.delete(win.id)
    let message = 'Signed in. This window closes by itself.'
    try {
      await finish(new URL(request.url()))
    } catch (e: any) {
      message = `Sign-in failed: ${String(e?.message ?? e).split('\n')[0]}`
    }
    await tab.page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(ending(message))}`).catch(() => {})
    // Long enough to read; the app has moved on by then. A failed one stays, to read and try again.
    if (message.startsWith('Signed in')) setTimeout(() => win.tabs.forEach((t) => t.page.close().catch(() => {})), 1500).unref()
  }

  /** Closes the window of a thread that finished, after a while, unless the owner is using it or the thread browses again. */
  retire(threadId: string, afterMs = 60_000) {
    const win = this.windowOf(threadId)
    if (!win) return
    clearTimeout(win.retiring)
    win.retiring = setTimeout(() => {
      if (win.controller || win.request) return
      for (const tab of [...win.tabs]) tab.page.close().catch(() => {})
    }, afterMs)
    win.retiring.unref()
  }

  async subscribe(tabId: string, fn: (f: Frame) => void): Promise<() => void> {
    const tab = this.tab(tabId)
    if (!tab.cast) {
      const cdp = await this.context!.newCDPSession(tab.page)
      const cast: NonNullable<Tab['cast']> = { cdp, subs: new Set(), last: null }
      tab.cast = cast
      cdp.on('Page.screencastFrame', (f) => {
        cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
        const frame = { data: f.data, width: f.metadata.deviceWidth, height: f.metadata.deviceHeight }
        cast.last = frame
        cast.subs.forEach((sub) => sub(frame))
      })
      // A tab behind another in its window is not drawn. Each thread has a window of its own, so this
      // only happens with popups, and bringing one forward does not hide another thread's page.
      if (tab.win.tabs.length > 1) await tab.page.bringToFront().catch(() => {})
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height })
    }
    const cast = tab.cast
    cast.subs.add(fn)
    // Chrome sends a picture only when the page changes, so one who joins a running screencast starts from the last.
    if (cast.last) fn(cast.last)
    return () => {
      cast.subs.delete(fn)
      if (cast.subs.size || tab.cast !== cast) return
      tab.cast = undefined
      cast.cdp.send('Page.stopScreencast').catch(() => {})
      cast.cdp.detach().catch(() => {})
    }
  }

  input(tabId: string, ev: BrowserInput) {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    const { mouse, keyboard } = tab.page
    tab.queue = tab.queue
      .then(async () => {
        switch (ev.kind) {
          case 'move':
            return mouse.move(ev.x, ev.y)
          case 'down':
            await mouse.move(ev.x, ev.y)
            return mouse.down({ button: ev.button ?? 'left' })
          case 'up':
            return mouse.up({ button: ev.button ?? 'left' })
          case 'wheel':
            await mouse.move(ev.x, ev.y)
            return mouse.wheel(ev.dx, ev.dy)
          case 'keydown':
            // Keys outside Playwright's US layout (accents, emoji, IME output) are inserted as text.
            return keyboard.down(ev.key).catch(() => keyboard.insertText(ev.key))
          case 'keyup':
            return keyboard.up(ev.key).catch(() => {})
          case 'text':
            return keyboard.insertText(ev.text)
        }
      })
      .catch(() => {})
  }

  async stop() {
    const context = this.context
    this.forget()
    await context?.close().catch(() => {})
  }
}

const browsers = new Map<string, BotBrowser>()

export function browserFor(botId: string): BotBrowser {
  let b = browsers.get(botId)
  if (!b) browsers.set(botId, (b = new BotBrowser(botId)))
  return b
}

export function browserStates(): Record<string, BrowserState> {
  return Object.fromEntries([...browsers].map(([id, b]) => [id, b.state()]))
}

export async function stopBrowser(botId: string) {
  await browsers.get(botId)?.stop()
  browsers.delete(botId)
}

/** Closes every browser cleanly so profiles are flushed to disk. */
export async function stopAllBrowsers() {
  await Promise.all([...browsers.values()].map((b) => b.stop()))
}

/** A thread finished: its window is closed a little later. */
export function retireWindow(botId: string, threadId: string) {
  browsers.get(botId)?.retire(threadId)
}

/** A view of the app went away: whatever it had control of goes back to the bots. */
export function letGo(viewer: string) {
  for (const browser of browsers.values()) browser.letGo(viewer)
}

/**
 * Runs in the page. Produces a compact text outline of what is visible and tags every interactive
 * element with a data-ob-ref attribute so tools can address it as [ref].
 */
function outline(max: number): string {
  document.querySelectorAll('[data-ob-ref]').forEach((el) => el.removeAttribute('data-ob-ref'))
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'HEAD', 'IFRAME', 'CANVAS', 'VIDEO'])
  const TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY'])
  const ROLES = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio', 'tab', 'menuitem', 'option', 'switch', 'combobox',
    'searchbox', 'slider', 'menuitemcheckbox', 'menuitemradio', 'treeitem',
  ])
  const NEST = new Set(['UL', 'OL', 'NAV', 'MAIN', 'SECTION', 'ARTICLE', 'FORM', 'TABLE', 'DIALOG', 'HEADER', 'FOOTER', 'ASIDE'])
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
  const lines: string[] = []
  let size = 0
  let refs = 0
  let lastText = false

  const push = (depth: number, line: string, isText = false) => {
    if (isText && lastText && lines.length && lines[lines.length - 1].length + line.length < 160) {
      lines[lines.length - 1] += ' ' + line
    } else {
      lines.push('  '.repeat(Math.min(depth, 6)) + line)
    }
    size += line.length + 1
    lastText = isText
  }

  const walk = (node: Node, depth: number) => {
    if (size > max) return
    if (node.nodeType === Node.TEXT_NODE) {
      const text = clean(node.textContent)
      if (text) push(depth, text.slice(0, 400), true)
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    const tag = el.tagName.toUpperCase()
    if (SKIP.has(tag) || el.getAttribute('aria-hidden') === 'true') return
    const style = getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') return

    const role = el.getAttribute('role') ?? ''
    const editable = el.isContentEditable && !el.parentElement?.isContentEditable
    const interactive =
      TAGS.has(tag) || ROLES.has(role) || editable || el.hasAttribute('onclick') ||
      (el.tabIndex >= 0 && style.cursor === 'pointer')
    if (interactive) {
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) return
      const input = el as HTMLInputElement
      if (tag === 'INPUT' && input.type === 'hidden') return
      const ref = ++refs
      el.setAttribute('data-ob-ref', String(ref))
      const kind = tag === 'INPUT' ? `input:${input.type}` : role || (editable ? 'editable' : tag.toLowerCase())
      const label = clean(
        el.getAttribute('aria-label') || (tag === 'SELECT' ? '' : el.innerText) || input.placeholder ||
        el.title || el.getAttribute('name') || (el.querySelector('img') as HTMLImageElement | null)?.alt,
      ).slice(0, 120)
      let extra = ''
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (input.type === 'checkbox' || input.type === 'radio') extra += input.checked ? ' (checked)' : ''
        else if (input.type !== 'password' && input.value) extra += ` value="${clean(input.value).slice(0, 80)}"`
      }
      if (tag === 'SELECT') {
        const select = el as HTMLSelectElement
        const options = [...select.options].slice(0, 20).map((o) => clean(o.text))
        extra += ` selected="${clean(select.selectedOptions[0]?.text)}" options=[${options.join(' | ')}]`
      }
      if (tag === 'A') {
        const href = el.getAttribute('href') ?? ''
        if (href && !href.startsWith('javascript:')) extra += ` -> ${href.slice(0, 100)}`
      }
      if ((el as HTMLButtonElement).disabled) extra += ' (disabled)'
      push(depth, `[${ref}] ${kind} "${label}"${extra}`)
      // Only descend when there is something else to act on inside (cards, rows, composite widgets).
      if (!el.querySelector('a, button, input, select, textarea, [role], [onclick]')) return
      depth++
    } else if (/^H[1-6]$/.test(tag)) {
      const text = clean(el.innerText)
      if (text) push(depth, `${'#'.repeat(Number(tag[1]))} ${text.slice(0, 200)}`)
      if (!el.querySelector('a, button')) return
    } else if (tag === 'IMG') {
      const alt = clean((el as HTMLImageElement).alt)
      if (alt) push(depth, `(image: ${alt.slice(0, 100)})`)
      return
    }
    const next = depth + (NEST.has(tag) ? 1 : 0)
    for (const child of el.shadowRoot ? el.shadowRoot.childNodes : el.childNodes) walk(child, next)
  }

  walk(document.body, 0)
  let text = lines.join('\n')
  if (size > max) text += '\n… (page truncated; scroll or use browser_read for more)'
  return text
}

export async function snapshot(page: Page, max = 12000): Promise<string> {
  await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {})
  if (!isWebPage(page.url())) return `URL: ${page.url()}\n\n(This is not a web page, so it cannot be read.)`
  const body = await page.evaluate(outline, max).catch((e) => `(could not read page: ${String(e.message).split('\n')[0]})`)
  return `Page: ${await page.title().catch(() => '')}\nURL: ${page.url()}\n\n${body || '(empty page)'}`
}

export function byRef(page: Page, ref: unknown) {
  return page.locator(`[data-ob-ref="${Number(ref)}"]`).first()
}
