import { type DragEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { Bot, BotSort, Thread } from '@openkumi/shared'
import { ALPHA_NOTE } from '@openkumi/shared/alpha'
import { type Attention, MARK_WORDS, attentionOf } from '@openkumi/client/attention'
import { BOT_SORTS, useBotOrder } from '@openkumi/client/bots'
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

/**
 * What a bot has for its owner, at the end of its row (@openkumi/client/attention): that it needs
 * them or has something to be read now, in words; that it is at work or failed; or when something
 * last happened in its conversation, with a dot before it when that is still to be read.
 */
function BotMark({ attention, at }: { attention: Attention; at?: number }) {
  switch (attention.mark) {
    case 'needs':
      return <span className="pill mark warn">{MARK_WORDS.needs}</span>
    case 'read':
      return <span className="pill mark new">{MARK_WORDS.read}</span>
    case 'working':
      return <span className="spinner" aria-label={MARK_WORDS.working} />
    case 'failed':
      return <span className="dot error" aria-label={MARK_WORDS.failed} />
    default:
      return at === undefined ? null : (
        <>
          {attention.mark === 'new' && <span className="dot new" aria-label={MARK_WORDS.new} />}
          <span className="time">{ago(at)}</span>
        </>
      )
  }
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

/** What each order of the bots does, said under its name where it is chosen. */
const SORT_HINTS: Record<BotSort, string> = {
  created: 'The oldest bot first',
  recent: 'The one you last talked with first',
  manual: 'Drag the bots into place',
}

/** The button over the list of bots that chooses their order. */
function SortMenu({ sort, choose }: { sort: BotSort; choose: (sort: BotSort) => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  return (
    <div className="sort" ref={box} onKeyDown={(e) => e.key === 'Escape' && open && (e.stopPropagation(), setOpen(false))}>
      <button className="icon small" title="Order of the bots" aria-label="Order of the bots" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="sort" size={14} />
      </button>
      {open && (
        <div className="sort-menu" role="menu" aria-label="Order of the bots">
          <h4>Order of the bots</h4>
          {BOT_SORTS.map(([value, label]) => (
            <button key={value} role="menuitemradio" aria-checked={sort === value} className="sort-item" onClick={() => (setOpen(false), choose(value))}>
              <span className="grow">
                {label}
                <small>{SORT_HINTS[value]}</small>
              </span>
              {sort === value && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A bot being dragged to another place in the list, and the bot it would be put before or after. */
interface Dragging {
  id: string
  over: string | null
  after: boolean
}

/** The bots, one row each: a bot has a single conversation, so there is nothing to pick beneath it. */
export function Sidebar({ bot, thread, automationsOpen, usageOpen, openModal, open, close }: Props) {
  const { bots, sort, choosable, choose, move } = useBotOrder()
  const threads = useStore((s) => s.threads)
  const providers = useStore((s) => s.providers)
  const browsers = useStore((s) => s.browsers)
  const queue = useStore((s) => s.queue)
  const automationCount = useStore((s) => s.automations.filter((a) => a.enabled).length)
  const runsGoing = threads.some((t) => t.kind === 'automation' && t.status === 'running')
  const root = thread && rootOf(threads, thread)
  // A subagent may run as another bot; the conversation it belongs to decides which bot is current.
  const currentBotId = root?.botId ?? bot?.id
  const connected = providers.some((p) => p.connected)
  const failed = (e: Error) => alert(e.message)

  // In the owner's own order a bot is dragged to its place, or moved a place with Alt and an arrow.
  const manual = sort === 'manual' && bots.length > 1
  const [drag, setDrag] = useState<Dragging | null>(null)
  const over = (id: string, after: boolean) => drag && (drag.over !== id || drag.after !== after) && setDrag({ ...drag, over: id, after })
  const drop = (e: DragEvent) => {
    if (!drag) return
    e.preventDefault()
    setDrag(null)
    if (!drag.over || drag.over === drag.id) return
    const rest = bots.filter((b) => b.id !== drag.id)
    void move(drag.id, rest.findIndex((b) => b.id === drag.over) + (drag.after ? 1 : 0)).catch(failed)
  }
  const nudge = (e: KeyboardEvent, id: string, place: number) => {
    if (!manual || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const to = place + (e.key === 'ArrowUp' ? -1 : 1)
    if (to < 0 || to >= bots.length) return
    void move(id, to).catch(failed)
    // The row is put elsewhere in the page, which can take the keyboard away from it.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.sidebar a[data-bot="${CSS.escape(id)}"]`)?.focus())
  }

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
      {/* With more than one bot, their order is chosen over the list. */}
      {choosable && bots.length > 1 && (
        <div className="side-caption">
          <span className="grow">Bots</span>
          <SortMenu sort={sort} choose={(next) => void choose(next).catch(failed)} />
        </div>
      )}
      <div
        className="side-scroll"
        // Below the last bot is the end of the list.
        onDragOver={drag ? (e) => (e.preventDefault(), e.target === e.currentTarget && over(bots[bots.length - 1].id, true)) : undefined}
        onDrop={drop}
      >
        {bots.map((b, place) => {
          const main = mainThread(threads, b.id)
          const current = b.id === currentBotId
          // What its subagents are doing shows under the bot being looked at, and in the mark of every bot.
          const subagents = main ? recentSubagents(threads, main) : []
          const attention = attentionOf(b.id, { threads, browsers, queue })
          return (
            <section
              key={b.id}
              className={`group ${drag?.id === b.id ? 'dragging' : drag?.over === b.id ? (drag.after ? 'drop-after' : 'drop-before') : ''}`}
              onDragOver={drag ? (e) => {
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                // Measured on the bot's own row: over the subagents listed beneath it is after it.
                const box = e.currentTarget.firstElementChild!.getBoundingClientRect()
                over(b.id, e.clientY > box.top + box.height / 2)
              } : undefined}
            >
              <div
                className="item"
                draggable={manual}
                onDragStart={manual ? (e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', b.name)
                  // A frame later, so that what is carried is drawn as the row was.
                  requestAnimationFrame(() => setDrag({ id: b.id, over: null, after: false }))
                } : undefined}
                onDragEnd={() => setDrag(null)}
              >
                <a
                  data-bot={b.id}
                  // The row is what is dragged, not its address.
                  draggable={manual ? false : undefined}
                  aria-keyshortcuts={manual ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                  onKeyDown={(e) => nudge(e, b.id, place)}
                  // Lit for its conversation and its earlier ones; a subagent listed beneath it is lit instead.
                  className={`row bot ${current && !subagents.some((t) => t.id === thread?.id) ? 'active' : ''}`}
                  href={`#/${b.id}`}
                  aria-current={current ? 'page' : undefined}
                  // Why it needs its owner, or what there is to read, in the bot's own few words.
                  title={attention.reason ? `${MARK_WORDS[attention.mark!]}: ${attention.reason}` : undefined}
                  onClick={close}
                >
                  <BotHead bot={b} />
                  <span className="grow name">{b.name}</span>
                  <span className="meta"><BotMark attention={attention} at={main?.updatedAt} /></span>
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
