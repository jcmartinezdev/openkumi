// One Chromium instance per bot, each with its own persistent profile directory, so cookies and
// logins belong to that bot alone and survive restarts. The UI watches and drives a tab through a
// CDP screencast; agent tools drive it through Playwright.
import crypto from 'node:crypto'
import path from 'node:path'
import { type BrowserContext, type CDPSession, type Page, chromium } from 'playwright-core'
import type { BrowserInput, BrowserState } from '@openbot/shared'
import { PORT, emit, privateDir } from './config.ts'
import { settings } from './settings.ts'
import { incoming, resolve } from './workspace.ts'

const VIEWPORT = { width: 1280, height: 800 }

// A bot's browser must not be able to open Open Bot itself: coming from this computer it would be
// trusted like the owner, and could change the bot's rules, skills and connections. These rules
// make Chrome send any request for this server's address somewhere that refuses it.
const NO_SELF_ACCESS = `--host-rules=${['localhost', '127.0.0.1', '[::1]', '[::ffff:7f00:1]'].map((host) => `MAP ${host}:${PORT} 0.0.0.0:1`).join(', ')}`

/** Pages a bot may read and act on: the web, and blank or inline pages. Never files on this computer or the browser's own pages. */
export function isWebPage(url: string) {
  return /^(https?|about|data|blob):/i.test(url)
}

export interface Frame {
  data: string
  width: number
  height: number
}

interface Tab {
  id: string
  page: Page
  /** The agent thread that owns this tab, or null for tabs the user opened. */
  threadId: string | null
  cast?: { cdp: CDPSession; subs: Set<(f: Frame) => void> }
  /** Serialises forwarded input so events apply in the order they were sent. */
  queue: Promise<unknown>
}

class BotBrowser {
  botId: string
  context: BrowserContext | null = null
  headless = true
  tabs = new Map<string, Tab>()
  private starting: Promise<void> | null = null
  private stateTimer: NodeJS.Timeout | null = null

  constructor(botId: string) {
    this.botId = botId
  }

  state(): BrowserState {
    return {
      running: !!this.context,
      headless: this.headless,
      tabs: [...this.tabs.values()].map((t) => ({ id: t.id, url: t.page.url(), title: '', threadId: t.threadId })),
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
    context.on('page', (page) => void this.adopt(page))
    context.on('close', () => {
      this.context = null
      this.tabs.clear()
      this.announce()
    })
    for (const page of context.pages()) await this.adopt(page)
    this.announce()
  }

  private async adopt(page: Page) {
    if ([...this.tabs.values()].some((t) => t.page === page)) return
    const tab: Tab = { id: crypto.randomBytes(4).toString('hex'), page, threadId: null, queue: Promise.resolve() }
    this.tabs.set(tab.id, tab)
    // A popup or target=_blank link continues the work of the tab that opened it.
    const opener = await page.opener().catch(() => null)
    const parent = opener && [...this.tabs.values()].find((t) => t.page === opener)
    if (parent?.threadId) {
      tab.threadId = parent.threadId
      parent.threadId = null
    }
    // Downloads land in the bot's files/ folder, where its file tools and the Files tab can reach them.
    page.on('download', (download) => {
      Promise.resolve()
        .then(() => download.saveAs(resolve(this.botId, incoming(this.botId, download.suggestedFilename())).abs))
        .then(() => emit({ type: 'files.changed', botId: this.botId }), () => {})
    })
    page.on('framenavigated', (frame) => frame === page.mainFrame() && this.announce())
    page.on('domcontentloaded', () => this.announce())
    page.on('close', () => {
      this.tabs.delete(tab.id)
      this.announce()
    })
    this.announce()
  }

  async newTab(threadId: string | null = null, url?: string): Promise<Tab> {
    if (!this.context) throw new Error('Browser is not running')
    const page = await this.context.newPage()
    await this.adopt(page)
    const tab = [...this.tabs.values()].find((t) => t.page === page)!
    tab.threadId = threadId
    if (url) await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {})
    this.announce()
    return tab
  }

  /** The tab an agent thread works in. Each thread gets its own, so subagents can browse in parallel. */
  async pageFor(threadId: string, headless: boolean): Promise<Page> {
    await this.start(headless)
    const mine = [...this.tabs.values()].find((t) => t.threadId === threadId)
    if (mine) return mine.page
    const blank = [...this.tabs.values()].find((t) => !t.threadId && t.page.url() === 'about:blank')
    if (blank) {
      blank.threadId = threadId
      this.announce()
      return blank.page
    }
    return (await this.newTab(threadId)).page
  }

  tab(tabId: string): Tab {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error('That tab is closed')
    return tab
  }

  async subscribe(tabId: string, fn: (f: Frame) => void): Promise<() => void> {
    const tab = this.tab(tabId)
    if (!tab.cast) {
      const cdp = await this.context!.newCDPSession(tab.page)
      const cast = { cdp, subs: new Set<(f: Frame) => void>() }
      tab.cast = cast
      cdp.on('Page.screencastFrame', (f) => {
        cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
        const frame = { data: f.data, width: f.metadata.deviceWidth, height: f.metadata.deviceHeight }
        cast.subs.forEach((sub) => sub(frame))
      })
      await tab.page.bringToFront().catch(() => {})
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height })
    }
    const cast = tab.cast
    cast.subs.add(fn)
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
    this.context = null
    this.tabs.clear()
    await context?.close().catch(() => {})
    this.announce()
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
