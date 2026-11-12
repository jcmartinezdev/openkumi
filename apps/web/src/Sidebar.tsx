import type { Bot, Thread } from '@openbot/shared'
import type { Modal } from './App'
import { Icon } from './Icon'
import { desktop, useDesktop } from './desktop'
import { mainThread, openSettings, recentSubagents, rootOf, useStore } from './store'
import { BotHead } from './Mascot'

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
  /** The scheduled tasks are showing. */
  tasksOpen: boolean
  openModal: (m: Modal) => void
  /** Drawer state on narrow screens. */
  open: boolean
  close: () => void
}

/** The bots, one row each: a bot has a single conversation, so there is nothing to pick beneath it. */
export function Sidebar({ bot, thread, tasksOpen, openModal, open, close }: Props) {
  const bots = useStore((s) => s.bots)
  const threads = useStore((s) => s.threads)
  const providers = useStore((s) => s.providers)
  const taskCount = useStore((s) => s.tasks.filter((t) => t.enabled).length)
  const runsGoing = threads.some((t) => t.kind === 'task' && t.status === 'running')
  const root = thread && rootOf(threads, thread)
  // A subagent may run as another bot; the conversation it belongs to decides which bot is current.
  const currentBotId = root?.botId ?? bot?.id
  const connected = providers.some((p) => p.connected)
  const app = useDesktop()
  // The environments that are turned on, to switch between.
  const environments = [...(app.local.enabled ? [{ id: 'local', name: 'This computer' }] : []), ...app.environments.filter((e) => e.enabled)]

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
          const main = mainThread(threads, b.id)
          const current = b.id === currentBotId
          // What its subagents are doing shows under the bot being looked at, and as a mark on the others.
          const subagents = main ? recentSubagents(threads, main) : []
          const working = main?.status === 'running' || subagents.some((t) => t.status === 'running')
          return (
            <section key={b.id} className="group">
              <div className="item">
                <a
                  // Lit for its conversation and its earlier ones; a subagent listed beneath it is lit instead.
                  className={`row bot ${current && !subagents.some((t) => t.id === thread?.id) ? 'active' : ''}`}
                  href={`#/${b.id}`}
                  aria-current={current ? 'page' : undefined}
                  onClick={close}
                >
                  <BotHead bot={b} />
                  <span className="grow name">{b.name}</span>
                  <span className="meta">
                    {working ? <span className="spinner" aria-label="Working" /> : main?.status === 'error' ? <span className="dot error" aria-label="Failed" /> : main && <span className="time">{ago(main.updatedAt)}</span>}
                  </span>
                </a>
                <button className="icon reveal" title="Bot settings" aria-label={`Settings for ${b.name}`} onClick={() => (close(), openSettings('bots', b.id))}>
                  <Icon name="more" />
                </button>
              </div>
              {current && subagents.map((t) => (
                <a
                  key={t.id}
                  className={`row thread sub ${t.id === thread?.id ? 'active' : ''}`}
                  href={`#/${t.botId}/${t.id}`}
                  aria-current={t.id === thread?.id ? 'page' : undefined}
                  onClick={close}
                >
                  <Icon name={t.kind === 'task' ? 'clock' : 'agents'} size={13} />
                  <span className="grow title">{t.title}</span>
                  <span className="meta"><StatusDot thread={t} /></span>
                </a>
              ))}
            </section>
          )
        })}
      </div>
      <a className={`row settings tasks-link ${tasksOpen ? 'active' : ''}`} href="#/tasks" aria-current={tasksOpen ? 'page' : undefined} onClick={close}>
        <Icon name="clock" />
        <span className="grow">Scheduled tasks</span>
        <span className="meta">{runsGoing ? <span className="spinner" aria-label="A task is running" /> : taskCount > 0 && <span className="time">{taskCount}</span>}</span>
      </a>
      <button className="row settings" onClick={() => (close(), openSettings(connected ? 'general' : 'providers'))}>
        <Icon name="sliders" />
        <span className="grow">Settings</span>
        {!connected && <span className="pill warn">Connect a model</span>}
      </button>
    </nav>
  )
}
