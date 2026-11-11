import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { BrowserPane } from './BrowserPane'
import { Chat } from './Chat'
import { desktop, useDesktop } from './desktop'
import { Gate } from './Gate'
import { Icon } from './Icon'
import { NewBot } from './Modals'
import { usePrefs } from './prefs'
import { SettingsView } from './Settings'
import { Sidebar } from './Sidebar'
import { type Route, navigate, openSettings, useRoute, useStore } from './store'

export type Modal = { kind: 'new-bot' } | null

function savedPaneWidth(): number {
  try {
    return Number(localStorage.getItem('openbot.paneWidth')) || 0
  } catch {
    return 0
  }
}

export function App() {
  const current = useRoute()
  // The settings are laid over the chat that was showing, which stays as it was underneath.
  const lastChat = useRef<Route>(current)
  if (!current.settings) lastChat.current = current
  const route = current.settings ? lastChat.current : current
  const autoOpenBrowser = usePrefs().autoOpenBrowser
  const bots = useStore((s) => s.bots)
  const threads = useStore((s) => s.threads)
  const loaded = useStore((s) => s.loaded)
  const connected = useStore((s) => s.connected)
  const refused = useStore((s) => s.refused)
  const failures = useStore((s) => s.failures)
  const app = useDesktop()
  // Open Bot on this computer stopped answering, or has a new access code: the app looks again by
  // itself, which starts it if it is gone and reads the code again if it is there.
  const stale = app.current === 'local' && app.local.state === 'running' && (refused || failures >= 2)
  useEffect(() => {
    if (stale) void desktop.retry().catch(() => {})
  }, [stale])
  const browsers = useStore((s) => s.browsers)
  // Which bots have their browser pane showing. Each bot's pane is independent.
  const [paneOpen, setPaneOpen] = useState<Record<string, boolean>>({})
  const [paneWidth, setPaneWidth] = useState(savedPaneWidth)
  // The bot whose pane the user just opened by hand; only that one starts its browser by itself.
  const [autoStart, setAutoStart] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  // The sidebar is a slide-out drawer on narrow screens.
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => setNavOpen(false), [route.botId, route.threadId])

  const thread = threads.find((t) => t.id === route.threadId)
  const bot = bots.find((b) => b.id === (thread?.botId ?? route.botId))

  // Land on the first bot when the URL names nothing that exists.
  useEffect(() => {
    // Not while the settings are showing: they may have been opened directly, with no chat underneath yet.
    if (loaded && !current.settings && !bot && bots.length) navigate(bots[0].id)
  }, [loaded, bot, bots, current.settings])

  // Reveal a bot's browser the moment that bot starts using it.
  const previous = useRef<typeof browsers | null>(null)
  useEffect(() => {
    // Another environment starts from its own baseline.
    if (!loaded) return void (previous.current = null)
    // Browsers already running when the environment loads are the baseline, not a reason to pop the pane open.
    if (!previous.current) return void (previous.current = browsers)
    const before = previous.current
    const started = Object.keys(browsers).filter((id) => browsers[id].running && !before[id]?.running)
    previous.current = browsers
    if (started.length && autoOpenBrowser) setPaneOpen((open) => ({ ...open, ...Object.fromEntries(started.map((id) => [id, true])) }))
  }, [browsers, loaded])

  // Nothing to show: no environment is chosen, the one chosen has not answered, or it has stopped
  // accepting the access code, in which case nothing on screen would work any more.
  if (!loaded || refused) return <Gate />

  const showPane = !!bot && !!paneOpen[bot.id]
  const setPane = (botId: string, open: boolean) => setPaneOpen((all) => ({ ...all, [botId]: open }))
  const toggleBrowser = () => {
    if (!bot) return
    setPane(bot.id, !showPane)
    setAutoStart(showPane ? null : bot.id)
  }

  return (
    <div className="app">
      <Sidebar bot={bot} thread={thread} openModal={(m) => (setNavOpen(false), setModal(m))} open={navOpen} close={() => setNavOpen(false)} />
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <main
        className={`chat ${showPane ? 'with-pane' : ''}`}
        style={showPane && paneWidth ? ({ '--pane-width': `${paneWidth}px` } as React.CSSProperties) : undefined}
      >
        {bot ? (
          <>
            <Chat
              key={`chat:${thread?.id ?? bot.id}`}
              bot={bot}
              thread={thread}
              browserOpen={showPane}
              toggleBrowser={toggleBrowser}
              openNav={() => setNavOpen(true)}
            />
            {/* Outside the keyed Chat so switching chats does not reload the browser view. */}
            {showPane && <BrowserPane key={`browser:${bot.id}`} bot={bot} thread={thread} close={() => setPane(bot.id, false)} setWidth={setPaneWidth} autoStart={autoStart === bot.id} clearAutoStart={() => setAutoStart(null)} />}
          </>
        ) : (
          <div className="parts">
            <header>
              <button className="icon menu" aria-label="Menu" onClick={() => setNavOpen(true)}><Icon name="menu" size={18} /></button>
            </header>
            <div className="scroller"><div className="empty"><p>Create a bot to get started.</p></div></div>
          </div>
        )}
      </main>
      {current.settings && <SettingsView path={current.settings} newBot={() => setModal({ kind: 'new-bot' })} />}
      {/* A bot made from the settings is opened there, ready to be set up; otherwise its chat opens. */}
      {modal?.kind === 'new-bot' && <NewBot close={() => setModal(null)} created={(made) => ((current.settings ? openSettings('bots', made.id) : navigate(made.id)), setModal(null))} />}
      {!connected && <div className="toast">Reconnecting…</div>}
    </div>
  )
}
