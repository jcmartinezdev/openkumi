import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import type { Bot, BrowserInput, Thread } from '@openbot/shared'
import { Icon } from './Icon'
import { api, send, useStore, watch } from './store'

const host = (url: string) => {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/**
 * Live, interactive view of the bot's own browser, docked next to the conversation (beside it on
 * wide screens, above it on narrow ones) so the chat stays visible while the bot browses.
 */
export function BrowserPane({ bot, thread, close, setWidth, autoStart, clearAutoStart }: { bot: Bot; thread?: Thread; close: () => void; setWidth: (px: number) => void; autoStart: boolean; clearAutoStart: () => void }) {
  const browser = useStore((s) => s.browsers[bot.id])
  const connected = useStore((s) => s.connected)
  const [chosen, setChosen] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [hasFrame, setHasFrame] = useState(false)
  const [starting, setStarting] = useState(false)
  const img = useRef<HTMLCanvasElement>(null)
  const size = useRef({ width: 1280, height: 800 })

  const running = !!browser?.running
  const tabs = running ? browser.tabs : []
  // Show the tab the user picked; otherwise follow the tab the current thread's agent is using.
  const tab = tabs.find((t) => t.id === chosen) ?? tabs.find((t) => thread && t.threadId === thread.id) ?? tabs[0]
  const tabId = tab?.id

  const act = async (action: string, body?: Record<string, unknown>) => {
    setError('')
    try {
      return await api('POST', `/api/bots/${bot.id}/browser/${action}`, { tabId, ...body })
    } catch (e: any) {
      setError(e.message)
    }
  }

  const start = async () => {
    setStarting(true)
    await act('start')
    setStarting(false)
  }
  // The user opened the pane to use the browser, so start it without a second step.
  useEffect(() => {
    if (autoStart && !running) start()
    // One-shot: coming back to this bot later must not start a browser that was quit since.
    clearAutoStart()
  }, [])

  // Keep the selected tab in sight when there are more tabs than fit.
  const activeTab = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Braces matter: newer browsers return a promise from scrollIntoView, which is not an effect cleanup.
    activeTab.current?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [tabId, tabs.length])

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

  const input = (event: BrowserInput) => tabId && send({ type: 'browser.input', botId: bot.id, tabId, input: event })

  const point = (e: { clientX: number; clientY: number }) => {
    const rect = img.current!.getBoundingClientRect()
    return {
      x: Math.round(((e.clientX - rect.left) * size.current.width) / rect.width),
      y: Math.round(((e.clientY - rect.top) * size.current.height) / rect.height),
    }
  }
  const button = (e: React.MouseEvent) => (['left', 'middle', 'right'] as const)[e.button] ?? 'left'

  // React attaches wheel listeners passively, which would let the pane scroll instead of the page.
  const view = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = view.current
    if (!el) return
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
        if (width) localStorage.setItem('openbot.paneWidth', String(width))
      } catch {
        // Storage can be unavailable (private windows); the width just won't be remembered.
      }
    }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <aside className="pane" aria-label={`${bot.name}’s browser`}>
      <div className="pane-resize" onPointerDown={resize} />
      <form
        className="pane-bar"
        onSubmit={(e) => {
          e.preventDefault()
          if (address?.trim()) act('navigate', { url: address })
          setAddress(null)
          view.current?.focus()
        }}
      >
        <button type="button" className="icon" title="Back" aria-label="Back" disabled={!tab} onClick={() => act('back')}><Icon name="back" /></button>
        <button type="button" className="icon" title="Reload" aria-label="Reload" disabled={!tab} onClick={() => act('reload')}><Icon name="reload" size={15} /></button>
        <input
          className="address"
          value={address ?? (tab?.url === 'about:blank' ? '' : (tab?.url ?? ''))}
          placeholder="Search or enter address"
          aria-label="Address"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          disabled={!tab}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={() => setAddress(null)}
        />
        <button type="button" className="icon" title="New tab" aria-label="New tab" disabled={!running} onClick={async () => setChosen((await act('new-tab'))?.tabId ?? null)}>
          <Icon name="plus" />
        </button>
        <button
          type="button"
          className="icon"
          title="Quit browser (logins stay saved)"
          aria-label="Quit browser"
          disabled={!running}
          onClick={async () => {
            if (!confirm('Quit the browser? Open pages close; logins stay saved.')) return
            await act('stop')
            close()
          }}
        >
          <Icon name="power" size={15} />
        </button>
        <button type="button" className="icon" title="Hide browser" aria-label="Hide browser" onClick={close}><Icon name="x" /></button>
      </form>
      {tabs.length > 1 && (
        <div className="tabs">
          {tabs.map((t) => (
            <div key={t.id} ref={t.id === tabId ? activeTab : undefined} className={`tab ${t.id === tabId ? 'active' : ''}`} title={t.url}>
              <button aria-current={t.id === tabId ? 'true' : undefined} className="tab-main" onClick={() => (setChosen(t.id), setAddress(null))}>
                <span className="title">{t.title || host(t.url) || 'New tab'}</span>
              </button>
              <button className="icon" title="Close tab" aria-label="Close tab" onClick={() => act('close-tab', { tabId: t.id })}>
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      <div
        className="view"
        ref={view}
        tabIndex={0}
        onKeyDown={(e) => {
          // Only keys typed on the page view itself are forwarded, not ones for buttons inside it.
          if (!running || e.target !== e.currentTarget) return
          // Keys go to the page, so Shift+Escape is the way back out for keyboard users.
          if (e.key === 'Escape' && e.shiftKey) return e.currentTarget.blur()
          // Let the browser deliver the clipboard through the paste event instead.
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') return
          e.preventDefault()
          input({ kind: 'keydown', key: e.key === ' ' ? 'Space' : e.key })
        }}
        onKeyUp={(e) => {
          if (!running || e.target !== e.currentTarget) return
          e.preventDefault()
          input({ kind: 'keyup', key: e.key === ' ' ? 'Space' : e.key })
        }}
        onPaste={(e) => {
          e.preventDefault()
          input({ kind: 'text', text: e.clipboardData.getData('text') })
        }}
        onTouchStart={(e) => {
          const t = e.touches[0]
          touch.current = { x: t.clientX, y: t.clientY }
          // Where the tap lands in the page, worked out before anything changes the layout.
          tap.current = running && img.current ? { ...point(t), x0: t.clientX, y0: t.clientY } : null
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
          aria-label={tab ? `The page ${tab.title || host(tab.url)}` : undefined}
          style={{ visibility: hasFrame && running ? 'visible' : 'hidden' }}
          onMouseDown={(e) => {
            if (fromTouch()) return
            view.current?.focus()
            input({ kind: 'down', ...point(e), button: button(e) })
          }}
          onMouseUp={(e) => !fromTouch() && input({ kind: 'up', ...point(e), button: button(e) })}
          onMouseMove={(e) => {
            if (fromTouch()) return
            const now = performance.now()
            if (now - lastMove.current < 30) return
            lastMove.current = now
            input({ kind: 'move', ...point(e) })
          }}
          onContextMenu={(e) => e.preventDefault()}
        />
        {!running ? (
          <div className="view-wait">
            {starting ? (
              <><span className="spinner" /> Starting {bot.name}’s browser</>
            ) : (
              <button className="primary" onClick={start}>Start browser</button>
            )}
          </div>
        ) : (
          !hasFrame && <div className="view-wait"><span className="spinner" /> Loading page</div>
        )}
      </div>
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
    </aside>
  )
}
