// A bot's earlier conversations, and a search through everything that was said to it and by it.
// A bot has one conversation; when its owner starts fresh, the one so far is set aside and listed
// here, where it can be read, searched, continued or deleted.
import { useEffect, useRef, useState } from 'react'
import type { Bot, HistoryMatch, Thread } from '@openkumi/shared'
import { Icon } from './Icon'
import { usePrefs } from './prefs'
import { api, navigate, useStore } from './store'

/** A date as it is said: "3 Nov", with the year when it is not this one. */
export function day(time: number): string {
  const date = new Date(time)
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) })
}

/** The time a conversation spans: one day, or from one to another. */
const span = (t: Thread) => (day(t.createdAt) === day(t.archivedAt ?? t.updatedAt) ? day(t.createdAt) : `${day(t.createdAt)} – ${day(t.archivedAt ?? t.updatedAt)}`)

/** `text` with the words that were searched for marked. */
function Marked({ text, words }: { text: string; words: string[] }) {
  if (!words.length) return <>{text}</>
  const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return <>{text.split(pattern).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>
}

export function History({ bot, open, setOpen }: { bot: Bot; open: boolean; setOpen: (open: boolean) => void }) {
  const threads = useStore((s) => s.threads)
  const { confirmDelete } = usePrefs()
  const [query, setQuery] = useState('')
  /** What the search found, or null while nothing has been asked or the answer is on its way. */
  const [matches, setMatches] = useState<HistoryMatch[] | null>(null)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const earlier = threads.filter((t) => t.botId === bot.id && !t.parentId && t.archivedAt).sort((a, b) => b.archivedAt! - a.archivedAt!)
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const searching = words.length > 0

  useEffect(() => {
    if (!open) return
    setQuery('')
    setError('')
    search.current?.focus()
    const outside = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', outside)
    return () => window.removeEventListener('mousedown', outside)
  }, [open])

  // Asks a moment after the typing stops; an answer to an earlier question is dropped.
  useEffect(() => {
    setMatches(null)
    if (!open || !searching) return
    let stale = false
    const wait = setTimeout(() => {
      api<{ matches: HistoryMatch[] }>('GET', `/api/bots/${bot.id}/search?q=${encodeURIComponent(query)}`).then(
        (found) => !stale && (setMatches(found.matches), setError('')),
        (e) => !stale && setError(e.message),
      )
    }, 180)
    return () => ((stale = true), clearTimeout(wait))
  }, [query, open, bot.id])

  const go = (threadId: string, itemId = 0) => (setOpen(false), navigate(bot.id, threadId, itemId))
  const remove = (t: Thread) => {
    if (confirmDelete && !confirm(`Delete the conversation “${t.title}”? This cannot be undone.`)) return
    api('DELETE', `/api/threads/${t.id}`).catch((e) => setError(e.message))
  }

  return (
    <div className="earlier" ref={root}>
      <button className={`icon ${open ? 'on' : ''}`} title="Earlier conversations" aria-label="Earlier conversations" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="history" size={17} />
      </button>
      {open && (
        <div className="earlier-pop" role="dialog" aria-label={`Earlier conversations with ${bot.name}`} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))}>
          <label className="model-search">
            <Icon name="search" size={14} />
            <input ref={search} value={query} placeholder={`Search what was said with ${bot.name}`} aria-label="Search conversations" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <div className="earlier-list">
            {error && <div className="notice error">{error}</div>}
            {searching ? (
              <>
                {matches?.map((m) => {
                  const thread = threads.find((t) => t.id === m.threadId)
                  return (
                    <button key={m.itemId} className="earlier-row" onClick={() => go(m.threadId, m.itemId)}>
                      <span className="earlier-meta">
                        <strong>{m.from === 'user' ? 'You' : m.from === 'bot' ? bot.name : m.from === 'automation' ? 'An automation' : 'A subagent'}</strong>
                        <span>{day(m.createdAt)}{thread?.archivedAt ? ' · earlier conversation' : ''}</span>
                      </span>
                      <span className="earlier-snippet"><Marked text={m.snippet} words={words} /></span>
                    </button>
                  )
                })}
                {matches?.length === 0 && <div className="earlier-empty">Nothing was said with all of these words.</div>}
              </>
            ) : (
              <>
                {earlier.map((t) => (
                  <div key={t.id} className="item">
                    <button className="earlier-row" onClick={() => go(t.id)}>
                      <span className="earlier-title">{t.title}</span>
                      <span className="earlier-meta"><span>{span(t)}</span></span>
                    </button>
                    <button className="icon reveal" title="Delete this conversation" aria-label={`Delete the conversation ${t.title}`} onClick={() => remove(t)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                ))}
                {!earlier.length && <div className="earlier-empty">Nothing has been set aside yet. When you start fresh, the conversation so far is kept here, and can be continued.</div>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
