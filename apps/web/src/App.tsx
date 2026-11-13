import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { browsingThread, control, windowOf } from '@openkumi/client/browser'
import { BrowserPane, BrowserPip } from './BrowserPane'
import { Chat } from './Chat'
import { desktop, useDesktop } from './desktop'
import { Gate } from './Gate'
import { Icon } from './Icon'
import { NewBot } from './Modals'
import { usePrefs } from './prefs'
import { SettingsView } from './Settings'
import { Sidebar } from './Sidebar'
import { Tasks } from './Tasks'
import { type Route, loadThread, mainThread, navigate, openSettings, useRoute, useStore } from './store'

export type Modal = { kind: 'new-bot' } | null

/** How a bot's browser is showing: beside the chat or filling the window, and whose window (null: the chat's own). */
interface PaneState {
  full: boolean
  threadId: string | null
}

function savedPaneWidth(): number {
  try {
    return Number(localStorage.getItem('openkumi.paneWidth')) || 0
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
  const autoPip = usePrefs().autoOpenBrowser
  const bots = useStore((s) => s.bots)
  const threads = useStore((s) => s.threads)
  const loaded = useStore((s) => s.loaded)
  const connected = useStore((s) => s.connected)
  const refused = useStore((s) => s.refused)
  const failures = useStore((s) => s.failures)
  const app = useDesktop()
  // OpenKumi on this computer stopped answering, or has a new access code: the app looks again by
  // itself, which starts it if it is gone and reads the code again if it is there.
  const stale = app.current === 'local' && app.local.state === 'running' && (refused || failures >= 2)
  useEffect(() => {
    if (stale) void desktop.retry().catch(() => {})
  }, [stale])
  const browsers = useStore((s) => s.browsers)
  // Which bots have their browser pane showing, and how. Each bot's pane is independent.
  const [panes, setPanes] = useState<Record<string, PaneState | undefined>>({})
  // The thread whose window floats over each bot's chat, in picture in picture.
  const [pips, setPips] = useState<Record<string, string | undefined>>({})
  // Threads whose floating window was closed: they stay closed until the bot asks for help in them.
  const dismissed = useRef(new Set<string>())
  const [paneWidth, setPaneWidth] = useState(savedPaneWidth)
  // The bot whose pane the user just opened by hand; only that one starts its browser by itself.
  const [autoStart, setAutoStart] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  // The sidebar is a slide-out drawer on narrow screens.
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => setNavOpen(false), [route.botId, route.threadId])

  // A bot's address shows its conversation; a longer one shows a subagent's thread or an earlier conversation.
  const thread = threads.find((t) => t.id === route.threadId) ?? mainThread(threads, route.botId)
  // A subagent or run older than what the list holds is fetched, which puts it in the list.
  const missing = !!route.threadId && !threads.some((t) => t.id === route.threadId)
  useEffect(() => {
    if (missing && connected) loadThread(route.threadId).catch(() => {})
  }, [missing, connected, route.threadId])
  const bot = bots.find((b) => b.id === (thread?.botId ?? route.botId))

  // Land on the first bot when the URL names nothing that exists.
  useEffect(() => {
    // Not while the settings are showing: they may have been opened directly, with no chat underneath yet.
    if (loaded && !current.settings && !route.tasks && !bot && bots.length) navigate(bots[0].id)
  }, [loaded, bot, bots, current.settings, route.tasks])

  const pane = bot && !route.tasks ? panes[bot.id] : undefined
  // The pane shows the window of the thread the chat shows, unless one was docked from picture in picture.
  const chatBrowsing = browsingThread(threads, thread)?.id
  const paneThread = pane?.threadId ?? chatBrowsing

  // A window docked from picture in picture gives way to the chat's own when another chat is opened.
  useEffect(() => {
    if (bot) setPanes((all) => (all[bot.id]?.threadId ? { ...all, [bot.id]: { ...all[bot.id]!, threadId: null } } : all))
  }, [thread?.id])

  // A window the bot starts using floats over the chat, small; one where it asks for help always does.
  const previous = useRef<typeof browsers | null>(null)
  useEffect(() => {
    // Another environment starts from its own baseline.
    if (!loaded) return void (previous.current = null)
    // What windows were doing when the environment loaded is the baseline, not a reason to show one.
    const before = previous.current
    previous.current = browsers
    if (!before) return
    for (const [botId, browser] of Object.entries(browsers)) {
      for (const win of browser.windows ?? []) {
        if (!win.threadId) continue
        const was = before[botId]?.windows?.find((w) => w.id === win.id)
        const asked = !!win.request && win.request !== was?.request
        const used = win.usedAt > (was?.usedAt ?? 0)
        // One showing beside the chat or filling the window is in view already.
        const docked = (id: string | undefined) => !!pane && botId === bot?.id && id === paneThread
        if (docked(win.threadId)) continue
        if (asked) dismissed.current.delete(win.threadId)
        else if (!used || !autoPip || dismissed.current.has(win.threadId)) continue
        const thread = win.threadId
        // One that is floating already stays, unless the bot asks for help in another.
        setPips((all) => (all[botId] && !asked && windowOf(browser, all[botId]) && !docked(all[botId]) ? all : { ...all, [botId]: thread }))
      }
    }
  }, [browsers, loaded])

  // Nothing to show: no environment is chosen, the one chosen has not answered, or it has stopped
  // accepting the access code, in which case nothing on screen would work any more.
  if (!loaded || refused) return <Gate />

  const showPane = !!pane
  const setPane = (botId: string, next: PaneState | undefined) => setPanes((all) => ({ ...all, [botId]: next }))
  const toggleBrowser = () => {
    if (!bot) return
    setPane(bot.id, showPane ? undefined : { full: false, threadId: null })
    setAutoStart(showPane ? null : bot.id)
  }
  const pipThread = bot && !route.tasks ? pips[bot.id] : undefined
  const showPip = !!bot && !!pipThread && !(pane && paneThread === pipThread) && !!windowOf(browsers[bot.id], pipThread)
  /** Moves the floating window into the pane, optionally taking control of it on the way. */
  const dock = (full: boolean, take?: string) => {
    if (!bot || !pipThread) return
    setPane(bot.id, { full, threadId: pipThread === chatBrowsing ? null : pipThread })
    setPips((all) => ({ ...all, [bot.id]: undefined }))
    if (take) control(bot.id, take, 'take')
  }

  return (
    <div className="app">
      <Sidebar bot={route.tasks ? undefined : bot} thread={route.tasks ? undefined : thread} tasksOpen={!!route.tasks} openModal={(m) => (setNavOpen(false), setModal(m))} open={navOpen} close={() => setNavOpen(false)} />
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <main
        className={`chat ${pane && !pane.full ? 'with-pane' : ''}`}
        style={pane && !pane.full && paneWidth ? ({ '--pane-width': `${paneWidth}px` } as React.CSSProperties) : undefined}
      >
        {route.tasks ? (
          <Tasks path={route.tasks} openNav={() => setNavOpen(true)} />
        ) : bot ? (
          <>
            <Chat
              // A bot's own conversation is one view, whichever thread holds it at the moment.
              key={`chat:${thread && thread.id !== mainThread(threads, bot.id)?.id ? thread.id : bot.id}`}
              bot={bot}
              thread={thread}
              focus={thread?.id === route.threadId ? route.itemId : 0}
              browserOpen={showPane}
              toggleBrowser={toggleBrowser}
              openNav={() => setNavOpen(true)}
            />
            {/* Outside the keyed Chat so switching chats does not reload the browser view. */}
            {pane && (
              <BrowserPane
                key={`browser:${bot.id}`}
                bot={bot}
                threadId={paneThread}
                other={paneThread !== chatBrowsing}
                full={pane.full}
                setFull={(full) => setPane(bot.id, { ...pane, full })}
                popOut={() => {
                  if (!paneThread) return
                  dismissed.current.delete(paneThread)
                  setPips((all) => ({ ...all, [bot.id]: paneThread }))
                  setPane(bot.id, undefined)
                }}
                close={() => setPane(bot.id, undefined)}
                setWidth={setPaneWidth}
                autoStart={autoStart === bot.id}
                clearAutoStart={() => setAutoStart(null)}
              />
            )}
            {showPip && (
              <BrowserPip
                key={`pip:${pipThread}`}
                bot={bot}
                threadId={pipThread}
                dock={dock}
                close={() => {
                  dismissed.current.add(pipThread)
                  setPips((all) => ({ ...all, [bot.id]: undefined }))
                }}
              />
            )}
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
