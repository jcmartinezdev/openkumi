import type { Bot, Thread } from '@openkumi/shared'
import { ALPHA_NOTE } from '@openkumi/shared/alpha'
import type { Modal } from './App'
import { Icon } from './Icon'
import { USAGE_ADDRESS, mainThread, openSettings, recentSubagents, rootOf, useStore } from './store'
import { BotHead } from './Mascot'
import { Switcher } from './Switcher'
import { UpdatePill } from './Updates'

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
  /** The automations are showing. */
  automationsOpen: boolean
  /** What the models used is showing. */
  usageOpen: boolean
  openModal: (m: Modal) => void
  /** Drawer state on narrow screens. */
  open: boolean
  close: () => void
}

/** The bots, one row each: a bot has a single conversation, so there is nothing to pick beneath it. */
export function Sidebar({ bot, thread, automationsOpen, usageOpen, openModal, open, close }: Props) {
  const bots = useStore((s) => s.bots)
  const threads = useStore((s) => s.threads)
  const providers = useStore((s) => s.providers)
  const automationCount = useStore((s) => s.automations.filter((a) => a.enabled).length)
  const runsGoing = threads.some((t) => t.kind === 'automation' && t.status === 'running')
  const root = thread && rootOf(threads, thread)
  // A subagent may run as another bot; the conversation it belongs to decides which bot is current.
  const currentBotId = root?.botId ?? bot?.id
  const connected = providers.some((p) => p.connected)

  return (
    <nav className={`sidebar ${open ? 'open' : ''}`}>
      <div className="side-head">
        <span className="wordmark">OpenKumi</span>
        {/* OpenKumi is an alpha; Settings › About says what that means. */}
        <button className="alpha-badge" title={ALPHA_NOTE} onClick={() => (close(), openSettings('about'))}>Alpha</button>
        <span className="grow" />
        <button className="icon" title="New bot" aria-label="New bot" onClick={() => openModal({ kind: 'new-bot' })}>
          <Icon name="plus" />
        </button>
      </div>
      {/* Whose bots these are, and where: switched here, for everyone on this computer and the other computers. */}
      <Switcher picked={close} />
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
                  <Icon name={t.kind === 'automation' ? 'clock' : 'agents'} size={13} />
                  <span className="grow title">{t.title}</span>
                  <span className="meta"><StatusDot thread={t} /></span>
                </a>
              ))}
            </section>
          )
        })}
      </div>
      <a className={`row settings automations-link ${automationsOpen ? 'active' : ''}`} href="#/automations" aria-current={automationsOpen ? 'page' : undefined} onClick={close}>
        <Icon name="clock" />
        <span className="grow">Automations</span>
        <span className="meta">{runsGoing ? <span className="spinner" aria-label="An automation is running" /> : automationCount > 0 && <span className="time">{automationCount}</span>}</span>
      </a>
      <a className={`row settings usage-link ${usageOpen ? 'active' : ''}`} href={USAGE_ADDRESS} aria-current={usageOpen ? 'page' : undefined} onClick={close}>
        <Icon name="chart" />
        <span className="grow">Usage</span>
      </a>
      <UpdatePill />
      <button className="row settings" onClick={() => (close(), openSettings(connected ? 'general' : 'providers'))}>
        <Icon name="sliders" />
        <span className="grow">Settings</span>
        {!connected && <span className="pill warn">Connect a model</span>}
      </button>
    </nav>
  )
}
