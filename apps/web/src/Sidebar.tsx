import { useState } from 'react'
import type { Bot, Thread } from '@openbot/shared'
import type { Modal } from './App'
import { Icon } from './Icon'
import { desktop, useDesktop } from './desktop'
import { usePrefs } from './prefs'
import { api, navigate, openSettings, rootOf, useStore } from './store'

export function StatusDot({ thread }: { thread: Thread }) {
  if (thread.status === 'running') return <span className="spinner" aria-label="Working" />
  if (thread.status === 'error') return <span className="dot error" aria-label="Failed" />
  return null
}

export function ago(time: number): string {
  const minutes = Math.floor((Date.now() - time) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`
  return `${Math.floor(minutes / (60 * 24))}d`
}

interface Props {
  bot?: Bot
  thread?: Thread
  openModal: (m: Modal) => void
  /** Drawer state on narrow screens. */
  open: boolean
  close: () => void
}

export function Sidebar({ bot, thread, openModal, open, close }: Props) {
  const bots = useStore((s) => s.bots)
  const threads = useStore((s) => s.threads)
  const providers = useStore((s) => s.providers)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const { recentChats: RECENT, confirmDelete } = usePrefs()
  const root = thread && rootOf(threads, thread)
  // A subagent may run as another bot; the chat it belongs to decides which bot is current.
  const currentBotId = root?.botId ?? bot?.id
  const connected = providers.some((p) => p.connected)
  const app = useDesktop()
  // The environments that are turned on, to switch between.
  const environments = [...(app.local.enabled ? [{ id: 'local', name: 'This computer' }] : []), ...app.environments.filter((e) => e.enabled)]

  const remove = async (t: Thread) => {
    if (confirmDelete && !confirm(`Delete "${t.title}"?`)) return
    try {
      await api('DELETE', `/api/threads/${t.id}`)
      if (root?.id === t.id) navigate(t.botId)
    } catch (e: any) {
      alert(`Could not delete the chat: ${e.message}`)
    }
  }

  return (
    <nav className={`sidebar ${open ? 'open' : ''}`}>
      <div className="side-head">
        <span className="wordmark">Open Bot</span>
        {/* With more than one environment turned on: which one is showing. */}
        {environments.length > 1 && (
          <select className="picker environment" aria-label="Environment" value={app.current ?? ''} onChange={(e) => void desktop.open(e.target.value).catch(() => {})}>
            {environments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        )}
        <span className="grow" />
        <button className="icon" title="New bot" aria-label="New bot" onClick={() => openModal({ kind: 'new-bot' })}>
          <Icon name="plus" />
        </button>
      </div>
      <div className="side-scroll">
        {bots.map((b) => {
          const chats = threads.filter((t) => t.botId === b.id && !t.parentId).sort((x, y) => y.updatedAt - x.updatedAt)
          const shown = expanded[b.id] ? chats : chats.slice(0, RECENT)
          return (
            <section key={b.id} className="group">
              <div className="item">
                <a
                  className={`row bot ${b.id === currentBotId && !thread ? 'active' : ''}`}
                  href={`#/${b.id}`}
                  title={`New chat with ${b.name}`}
                  onClick={close}
                >
                  <span className="avatar">{b.emoji}</span>
                  <span className="grow name">{b.name}</span>
                </a>
                <button className="icon reveal" title="Bot settings" aria-label={`Settings for ${b.name}`} onClick={() => (close(), openSettings('bots', b.id))}>
                  <Icon name="more" />
                </button>
              </div>
              {shown.map((t) => (
                <div key={t.id}>
                  <div className="item">
                    <a
                      className={`row thread ${t.id === thread?.id ? 'active' : ''}`}
                      href={`#/${b.id}/${t.id}`}
                      aria-current={t.id === thread?.id ? 'page' : undefined}
                      onClick={close}
                    >
                      <span className="grow title">{t.title}</span>
                      <span className="meta">
                        {t.status === 'idle' ? <span className="time">{ago(t.updatedAt)}</span> : <StatusDot thread={t} />}
                      </span>
                    </a>
                    <button className="icon reveal" title="Delete chat" aria-label={`Delete chat ${t.title}`} onClick={() => remove(t)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                  {root?.id === t.id && <SubThreads parent={t} threads={threads} activeId={thread?.id} depth={1} close={close} />}
                </div>
              ))}
              {chats.length > RECENT && (
                <button className="row more" onClick={() => setExpanded((e) => ({ ...e, [b.id]: !e[b.id] }))}>
                  {expanded[b.id] ? 'Show less' : `Show ${chats.length - RECENT} more`}
                </button>
              )}
            </section>
          )
        })}
      </div>
      <button className="row settings" onClick={() => (close(), openSettings(connected ? 'general' : 'providers'))}>
        <Icon name="sliders" />
        <span className="grow">Settings</span>
        {!connected && <span className="pill warn">Connect a model</span>}
      </button>
    </nav>
  )
}

function SubThreads({ parent, threads, activeId, depth, close }: { parent: Thread; threads: Thread[]; activeId?: string; depth: number; close: () => void }) {
  const children = threads.filter((t) => t.parentId === parent.id)
  return (
    <>
      {children.map((t) => (
        <div key={t.id}>
          <a
            className={`row thread sub ${t.id === activeId ? 'active' : ''}`}
            style={{ paddingLeft: 30 + depth * 12 }}
            href={`#/${t.botId}/${t.id}`}
            aria-current={t.id === activeId ? 'page' : undefined}
            onClick={close}
          >
            <Icon name="agents" size={13} />
            <span className="grow title">{t.title}</span>
            <span className="meta"><StatusDot thread={t} /></span>
          </a>
          <SubThreads parent={t} threads={threads} activeId={activeId} depth={depth + 1} close={close} />
        </div>
      ))}
    </>
  )
}
