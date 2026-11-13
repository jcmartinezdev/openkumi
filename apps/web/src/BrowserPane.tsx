import type React from 'react'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { Bot, BrowserInput, BrowserTab, BrowserWindow } from '@openkumi/shared'
import { control, driverOf, hostOf, sessionName } from '@openkumi/client/browser'
import { Icon } from './Icon'
import { api, send, useStore, watch } from './store'

/**
 * A live picture of one tab of a bot's browser. Only while `drive` is on does what is done to it
 * (clicks, keys, scrolling, typing on a touch screen) reach the page; otherwise it is only watched.
 */
export function PageView({ bot, tab, drive, onPress, children }: { bot: Bot; tab: BrowserTab | undefined; drive: boolean; onPress?: () => void; children?: ReactNode }) {
  const connected = useStore((s) => s.connected)
  const [hasFrame, setHasFrame] = useState(false)
  const img = useRef<HTMLCanvasElement>(null)
  const view = useRef<HTMLDivElement>(null)
  const size = useRef({ width: 1280, height: 800 })
  const tabId = tab?.id

  // The pictures of the page never pass through here: the connection's thread draws them onto the
  // canvas, and only says when the first one is showing and when the page changes size.
  useEffect(() => {
    if (!tabId || !img.current) return
    setHasFrame(false)
    return watch(`${bot.id}:${tabId}`, img.current, (page) => {
      size.current = page
      setHasFrame(true)
    })
  }, [bot.id, tabId])

  useEffect(() => {
    if (!tabId || !connected) return
    send({ type: 'browser.subscribe', botId: bot.id, tabId })
    return () => send({ type: 'browser.unsubscribe', botId: bot.id, tabId })
  }, [bot.id, tabId, connected])

  // Taking control puts the keyboard on the page at once.
  useEffect(() => {
    if (drive) view.current?.focus()
  }, [drive])

  const input = (event: BrowserInput) => drive && tabId && send({ type: 'browser.input', botId: bot.id, tabId, input: event })

  const point = (e: { clientX: number; clientY: number }) => {
    const rect = img.current!.getBoundingClientRect()
    return {
      x: Math.round(((e.clientX - rect.left) * size.current.width) / rect.width),
      y: Math.round(((e.clientY - rect.top) * size.current.height) / rect.height),
    }
  }
  const button = (e: React.MouseEvent) => (['left', 'middle', 'right'] as const)[e.button] ?? 'left'

  // React attaches wheel listeners passively, which would let the pane scroll instead of the page.
  useEffect(() => {
    const el = view.current
    if (!el || !drive) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      input({ kind: 'wheel', ...point(e), dx: e.deltaX, dy: e.deltaY })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const lastMove = useRef(0)
  // Touch screens: dragging scrolls the page, and a text box stands in for the missing keyboard.
  const touch = useRef<{ x: number; y: number } | null>(null)
  const [typed, setTyped] = useState('')
  // The text box only takes up room once the user has touched the page.
  const [typing, setTyping] = useState(false)
  const tap = useRef<{ x: number; y: number; x0: number; y0: number } | null>(null)
  // Browsers replay a touch as mouse events afterwards; those must not click the page a second time.
  const lastTouch = useRef(-1e9)
  const fromTouch = () => performance.now() - lastTouch.current < 1000
  const press = (key: string) => {
    input({ kind: 'keydown', key })
    input({ kind: 'keyup', key })
  }

  return (
    <>
      <div
        className={`view ${drive ? 'driving' : ''} ${onPress ? 'pressable' : ''}`}
        ref={view}
        tabIndex={drive ? 0 : -1}
        onClick={onPress}
        onKeyDown={(e) => {
          // Only keys typed on the page view itself are forwarded, not ones for buttons inside it.
          if (!drive || e.target !== e.currentTarget) return
          // Keys go to the page, so Shift+Escape is the way back out for keyboard users.
          if (e.key === 'Escape' && e.shiftKey) return e.currentTarget.blur()
          // Let the browser deliver the clipboard through the paste event instead.
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') return
          e.preventDefault()
          e.stopPropagation()
          input({ kind: 'keydown', key: e.key === ' ' ? 'Space' : e.key })
        }}
        onKeyUp={(e) => {
          if (!drive || e.target !== e.currentTarget) return
          e.preventDefault()
          input({ kind: 'keyup', key: e.key === ' ' ? 'Space' : e.key })
        }}
        onPaste={(e) => {
          if (!drive) return
          e.preventDefault()
          input({ kind: 'text', text: e.clipboardData.getData('text') })
        }}
        onTouchStart={(e) => {
          if (!drive) return
          const t = e.touches[0]
          touch.current = { x: t.clientX, y: t.clientY }
          // Where the tap lands in the page, worked out before anything changes the layout.
          tap.current = img.current ? { ...point(t), x0: t.clientX, y0: t.clientY } : null
        }}
        onTouchMove={(e) => {
          const t = e.touches[0]
          const last = touch.current
          if (!last || !img.current) return
          const scale = size.current.width / img.current.getBoundingClientRect().width
          input({ kind: 'wheel', ...point(t), dx: (last.x - t.clientX) * scale, dy: (last.y - t.clientY) * scale })
          touch.current = { x: t.clientX, y: t.clientY }
          // Fingers wobble a few pixels during a tap; only a real drag cancels it.
          if (tap.current && Math.hypot(t.clientX - tap.current.x0, t.clientY - tap.current.y0) > 10) tap.current = null
        }}
        onTouchEnd={() => {
          touch.current = null
          lastTouch.current = performance.now()
          const at = tap.current
          tap.current = null
          if (!at) return
          input({ kind: 'down', x: at.x, y: at.y, button: 'left' })
          input({ kind: 'up', x: at.x, y: at.y, button: 'left' })
          // A tap is how a field gets chosen, so that is when the text box appears.
          setTyping(true)
        }}
      >
        {/* A canvas can be handed to the connection's thread only once, so each tab gets its own. */}
        <canvas
          key={tabId ?? 'none'}
          ref={img}
          aria-label={tab ? `The page ${tab.title || hostOf(tab.url)}` : undefined}
          style={{ visibility: hasFrame && tab ? 'visible' : 'hidden' }}
          onMouseDown={(e) => {
            if (!drive || fromTouch()) return
            view.current?.focus()
            input({ kind: 'down', ...point(e), button: button(e) })
          }}
          onMouseUp={(e) => drive && !fromTouch() && input({ kind: 'up', ...point(e), button: button(e) })}
          onMouseMove={(e) => {
            if (!drive || fromTouch()) return
            const now = performance.now()
            if (now - lastMove.current < 30) return
            lastMove.current = now
            input({ kind: 'move', ...point(e) })
          }}
          onContextMenu={(e) => drive && e.preventDefault()}
        />
        {children ?? (tab && !hasFrame && <div className="view-wait"><span className="spinner" /> Loading page</div>)}
      </div>
      {drive && (
        <form
          className={`typebar ${typing ? 'show' : ''}`}
          onSubmit={(e) => {
            e.preventDefault()
            if (typed) input({ kind: 'text', text: typed })
            setTyped('')
          }}
        >
          <input
            value={typed}
            placeholder="Tap a field above, then type here"
            aria-label="Text to type into the page"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setTyped(e.target.value)}
          />
          <button type="button" className="icon" title="Backspace" aria-label="Backspace" onClick={() => press('Backspace')}><Icon name="backspace" /></button>
          <button type="submit" className="icon" title="Type it" aria-label="Type it" onClick={(e) => { if (!typed) { e.preventDefault(); press('Enter') } }}><Icon name="enter" /></button>
        </form>
      )}
    </>
  )
}

/** Who has the window, what the bot asked for, and the button that changes hands. */
function ControlBar({ bot, win }: { bot: Bot; win: BrowserWindow }) {
  const driver = driverOf(win)
  const act = (action: 'take' | 'give' | 'decline') => control(bot.id, win.id, action)
  if (driver === 'you') {
    return (
      <div className="control-bar you" role="status">
        <span className="grow">
          <strong>You have control.</strong> {win.request ? `${win.request}, then hand back to ${bot.name}.` : `${bot.name} can’t act here until you hand it back.`}
        </span>
        <button className="primary" onClick={() => act('give')}>Hand back</button>
      </div>
    )
  }
  if (win.request) {
    return (
      <div className="control-bar asking" role="status">
        <span className="grow"><strong>{bot.name} needs you:</strong> {win.request}</span>
        {driver === 'bot' && <button onClick={() => act('decline')}>Not now</button>}
        <button className="primary" onClick={() => act('take')}>{driver === 'elsewhere' ? 'Take control here' : 'Take control'}</button>
      </div>
    )
  }
  return (
    <div className="control-bar" role="status">
      <span className="grow faint">{driver === 'elsewhere' ? 'You have control on another device.' : `${bot.name} has control.`}</span>
      <button onClick={() => act('take')}>{driver === 'elsewhere' ? 'Take control here' : 'Take control'}</button>
    </div>
  )
}

interface PaneProps {
  bot: Bot
  /** The thread whose window is shown; undefined while the bot's conversation has not begun. */
  threadId: string | undefined
  /** Shown instead of the chat's own window (one docked from picture in picture): its name is shown. */
  other: boolean
  full: boolean
  setFull: (full: boolean) => void
  /** Makes the window float in picture in picture instead. */
  popOut: () => void
  close: () => void
  setWidth: (px: number) => void
  autoStart: boolean
  clearAutoStart: () => void
}

/**
 * The window a thread of the bot browses in, live: docked next to the conversation (beside it on
 * wide screens, above it on narrow ones) so the chat stays visible, or filling the app's window. It
 * is watched until the owner takes control; then they use the page, and the bot can only read it.
 */
export function BrowserPane({ bot, threadId, other, full, setFull, popOut, close, setWidth, autoStart, clearAutoStart }: PaneProps) {
  const browser = useStore((s) => s.browsers[bot.id])
  const threads = useStore((s) => s.threads)
  const [chosen, setChosen] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState(false)

  const running = !!browser?.running
  const win = running && threadId ? (browser.windows ?? []).find((w) => w.threadId === threadId) : undefined
  const tabs = win ? browser.tabs.filter((t) => t.windowId === win.id) : []
  // The tab that was picked; otherwise the one the bot works in.
  const tab = tabs.find((t) => t.id === chosen) ?? tabs.find((t) => t.id === win?.activeTab) ?? tabs[0]
  const tabId = tab?.id
  const drive = driverOf(win) === 'you'

  const act = async (action: string, body?: Record<string, unknown>) => {
    setError('')
    try {
      return await api('POST', `/api/bots/${bot.id}/browser/${action}`, { tabId, ...body })
    } catch (e: any) {
      setError(e.message)
    }
  }

  // Starts the browser if need be, and opens the thread's window.
  const open = async () => {
    setOpening(true)
    await act('open', { threadId })
    setOpening(false)
  }
  // The user opened the pane to use the browser, so open the window without a second step.
  useEffect(() => {
    if (autoStart && !win) open()
    // One-shot: coming back to this bot later must not start a browser that was quit since.
    clearAutoStart()
  }, [])

  // Control is handed back when this view stops showing the window. (The server ignores a hand-back
  // from a view that no longer has control, so losing it some other way needs no care here.)
  const windowId = win?.id
  useEffect(() => {
    if (!drive || !windowId) return
    return () => control(bot.id, windowId, 'give')
  }, [bot.id, drive, windowId])
  useEffect(() => setChosen(null), [windowId])

  // Escape leaves full screen, unless the keys are going to the page.
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && setFull(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  // Keep the selected tab in sight when there are more tabs than fit.
  const activeTab = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Braces matter: newer browsers return a promise from scrollIntoView, which is not an effect cleanup.
    activeTab.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [tabId, tabs.length])

  const resize = (e: React.PointerEvent) => {
    e.preventDefault()
    // The split lives on the chat grid, which also keeps a minimum width for the conversation.
    const chat = e.currentTarget.closest('.chat')!.getBoundingClientRect()
    let width = 0
    const move = (m: PointerEvent) => {
      // Same limits as the grid, so the handle never drifts away from the pointer.
      width = Math.round(Math.min(Math.max(chat.right - m.clientX, 340), chat.width - 320, chat.width * 0.62))
      setWidth(width)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
      try {
        if (width) localStorage.setItem('openkumi.paneWidth', String(width))
      } catch {
        // Storage can be unavailable (private windows); the width just won't be remembered.
      }
    }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <aside className={`pane ${full ? 'full' : ''}`} aria-label={`${bot.name}’s browser`}>
      {!full && <div className="pane-resize" onPointerDown={resize} />}
      <form
        className="pane-bar"
        onSubmit={(e) => {
          e.preventDefault()
          if (address?.trim()) act('navigate', { url: address })
          setAddress(null)
        }}
      >
        <button type="button" className="icon" title="Back" aria-label="Back" disabled={!drive} onClick={() => act('back')}><Icon name="back" /></button>
        <button type="button" className="icon" title="Reload" aria-label="Reload" disabled={!drive} onClick={() => act('reload')}><Icon name="reload" size={15} /></button>
        {(other || full) && win && <span className="pane-session" title={`${bot.name} · ${sessionName(threads, threadId)}`}>{sessionName(threads, threadId)}</span>}
        <input
          className="address"
          value={address ?? (tab?.url === 'about:blank' ? '' : (tab?.url ?? ''))}
          placeholder={drive ? 'Search or enter address' : ''}
          aria-label="Address"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          readOnly={!drive}
          disabled={!tab}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => drive && e.target.select()}
          onBlur={() => setAddress(null)}
        />
        <button type="button" className="icon" title="Picture in picture" aria-label="Picture in picture" disabled={!win} onClick={popOut}><Icon name="pip" size={17} /></button>
        <button type="button" className="icon" title={full ? 'Leave full screen' : 'Full screen'} aria-label={full ? 'Leave full screen' : 'Full screen'} onClick={() => setFull(!full)}>
          <Icon name={full ? 'shrink' : 'expand'} size={15} />
        </button>
        <button type="button" className="icon" title="Hide browser" aria-label="Hide browser" onClick={close}><Icon name="x" /></button>
      </form>
      {tabs.length > 1 && (
        <div className="tabs">
          {tabs.map((t) => (
            <div key={t.id} ref={t.id === tabId ? activeTab : undefined} className={`tab ${t.id === tabId ? 'active' : ''}`} title={t.url}>
              <button
                aria-current={t.id === tabId ? 'true' : undefined}
                className="tab-main"
                onClick={() => {
                  setChosen(t.id)
                  setAddress(null)
                  // In control, the tab picked is where the bot carries on once it has the window back.
                  if (drive) act('focus-tab', { tabId: t.id })
                }}
              >
                <span className="title">{t.title || hostOf(t.url) || 'New tab'}</span>
              </button>
              {drive && (
                <button className="icon" title="Close tab" aria-label="Close tab" onClick={() => act('close-tab', { tabId: t.id })}>
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      <PageView bot={bot} tab={tab} drive={drive}>
        {!win ? (
          <div className="view-wait">
            {opening ? (
              <><span className="spinner" /> Opening {bot.name}’s browser</>
            ) : (
              <button className="primary" onClick={open}>Open browser</button>
            )}
          </div>
        ) : undefined}
      </PageView>
      {win && <ControlBar bot={bot} win={win} />}
    </aside>
  )
}

/**
 * A small live view of a window that floats over the chat while the bot browses, from where it can
 * be docked beside the chat, made to fill the window, or closed. It is only watched; taking control
 * docks it first.
 */
export function BrowserPip({ bot, threadId, dock, close }: { bot: Bot; threadId: string; dock: (full: boolean, take?: string) => void; close: () => void }) {
  const browser = useStore((s) => s.browsers[bot.id])
  const threads = useStore((s) => s.threads)
  const win = (browser?.windows ?? []).find((w) => w.threadId === threadId)
  if (!browser?.running || !win) return null
  const tab = browser.tabs.find((t) => t.id === win.activeTab)
  const name = sessionName(threads, threadId)
  return (
    <div className="pip" role="region" aria-label={`${bot.name}’s browser, ${name}`}>
      <div className="pip-head">
        <span className="pip-title" title={tab?.url}>{name}{tab && tab.url !== 'about:blank' ? ` · ${tab.title || hostOf(tab.url)}` : ''}</span>
        <button className="icon" title="Beside the chat" aria-label="Dock beside the chat" onClick={() => dock(false)}><Icon name="dock" size={15} /></button>
        <button className="icon" title="Full screen" aria-label="Full screen" onClick={() => dock(true)}><Icon name="expand" size={14} /></button>
        <button className="icon" title="Close" aria-label="Close picture in picture" onClick={close}><Icon name="x" size={14} /></button>
      </div>
      <PageView bot={bot} tab={tab} drive={false} onPress={() => dock(false)} />
      {win.request && driverOf(win) !== 'you' && (
        <div className="pip-ask">
          <span className="grow"><strong>{bot.name} needs you:</strong> {win.request}</span>
          <button className="primary" onClick={() => dock(false, win.id)}>Take control</button>
        </div>
      )}
    </div>
  )
}
