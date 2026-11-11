import DOMPurify from 'dompurify'
import { Lexer, marked } from 'marked'
import { type ReactNode, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Bot, Effort, Item, ItemData, Thread } from '@openbot/shared'
import { Icon } from './Icon'
import { useModels } from './models'
import { usePrefs } from './prefs'
import { StatusDot } from './Sidebar'
import { describe, parse, site } from '@openbot/client/steps'
import { api, loadThread, navigate, onEnvironmentChange, openSettings, rootOf, useStore } from './store'

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

const MARKDOWN = { gfm: true, breaks: true }
const toHtml = (text: string) => DOMPurify.sanitize(marked.parse(text, MARKDOWN) as string)

/** `live` is for text that is still being written: see LiveMarkdown. */
export const Markdown = memo(function Markdown({ text, live }: { text: string; live?: boolean }) {
  const html = useMemo(() => (live ? '' : toHtml(text)), [text, live])
  return live ? <LiveMarkdown text={text} /> : <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
})

/**
 * A reply as it is being written. It only ever grows at the end, so it is drawn piece by piece
 * (a paragraph, a list, a block of code…): the pieces already written stay exactly as they are on
 * the page, and only the last one is worked out again as more text arrives. A long reply then
 * costs the same to keep up with at its end as at its start.
 */
function LiveMarkdown({ text }: { text: string }) {
  const pieces = useMemo(() => new Lexer(MARKDOWN).blockTokens(text).map((token) => token.raw).filter((raw) => raw.trim()), [text])
  return <div className="md">{pieces.map((raw, i) => <Piece key={i} raw={raw} />)}</div>
}

const Piece = memo(function Piece({ raw }: { raw: string }) {
  const html = useMemo(() => toHtml(raw), [raw])
  return <div className="md-piece" dangerouslySetInnerHTML={{ __html: html }} />
})

type Call = Extract<ItemData, { type: 'function_call' }>

const FILE_TOOLS = new Set(['list_files', 'read_file', 'write_file', 'edit_file', 'search_files', 'move_file', 'delete_file'])
const toolIcon = (name: string) =>
  name.startsWith('browser_') || name === 'web_fetch' ? 'globe'
  : name.includes('subagent') ? 'agents'
  : FILE_TOOLS.has(name) ? 'file'
  : name.startsWith('mcp__') ? 'plug'
  : 'bolt'

/** Opens a file of the bot's workspace in its settings; set by the chat that is showing. */
type OpenFile = (path: string) => void

/** One line in the activity log; expands to show details when there are any. */
function Step({ icon, label, trailing, children }: { icon: Parameters<typeof Icon>[0]['name']; label: ReactNode; trailing?: ReactNode; children?: ReactNode }) {
  const head = (
    <>
      <Icon name={icon} size={14} />
      <span className="step-label">{label}</span>
      {trailing}
    </>
  )
  const open = usePrefs().expandSteps
  if (!children) return <div className="step"><div className="step-head">{head}</div></div>
  return (
    <details className="step" open={open || undefined}>
      <summary className="step-head">{head}<Icon name="chevron" size={12} /></summary>
      <div className="step-body">{children}</div>
    </details>
  )
}

function ToolStep({ call, output, running, openFile }: { call: Call; output?: string; running: boolean; openFile: OpenFile }) {
  const failed = output?.startsWith('Error:')
  const spawned = call.name === 'spawn_subagent' && output ? parse(output) : null
  const args = parse(call.arguments)
  // A file the bot wrote can be opened from the step that wrote it.
  const wrote = (call.name === 'write_file' || call.name === 'edit_file') && output !== undefined && !failed && typeof args.path === 'string' ? args.path.replace(/^\/+/, '') : null
  return (
    <Step
      icon={toolIcon(call.name)}
      label={describe(call)}
      trailing={
        <>
          {output === undefined ? running ? <span className="spinner" /> : <span className="faint">interrupted</span> : failed && <span className="pill bad">failed</span>}
          {spawned?.id && <SubagentLink id={spawned.id} />}
          {wrote && <button className="pill link" onClick={(e) => (e.preventDefault(), openFile(wrote))}>View</button>}
        </>
      }
    >
      {Object.keys(args).length > 0 && <pre>{JSON.stringify(args, null, 2)}</pre>}
      {output !== undefined && <pre>{output.length > 6000 ? output.slice(0, 6000) + '\n…' : output}</pre>}
    </Step>
  )
}

function SubagentLink({ id }: { id: string }) {
  const child = useStore((s) => s.threads).find((t) => t.id === id)
  if (!child) return null
  return (
    <button
      className="pill link"
      onClick={(e) => {
        e.preventDefault()
        navigate(child.botId, child.id)
      }}
    >
      Open
    </button>
  )
}

function SubagentReport({ text }: { text: string }) {
  const m = text.match(/Subagent "(.*?)" \(id: (\S+)\) — (\w+)\n([\s\S]*?)\n?<\/subagent_notification>/)
  if (!m) return <div className="notice">{text}</div>
  const [, name, id, status, body] = m
  return (
    <div className="activity">
      <Step icon="agents" label={`Subagent “${name}” ${status}`} trailing={<SubagentLink id={id} />}>
        <Markdown text={body} />
      </Step>
    </div>
  )
}

const isStep = (d: ItemData) => d.type === 'function_call' || d.type === 'web_search_call' || (d.type === 'reasoning' && !!d.summary)

function Items({ items, running, openFile }: { items: Item[]; running: boolean; openFile: OpenFile }) {
  const outputs = useMemo(() => {
    const map = new Map<string, string>()
    for (const { data } of items) if (data.type === 'function_call_output') map.set(data.call_id, data.output)
    return map
  }, [items])

  // Consecutive tool calls and thoughts collapse into one quiet activity log between messages.
  const blocks: ReactNode[] = []
  let steps: ReactNode[] = []
  const flush = (key: number) => {
    if (steps.length) blocks.push(<div key={`a${key}`} className="activity">{steps}</div>)
    steps = []
  }
  for (const { id, data } of items) {
    if (data.type === 'function_call_output') continue
    if (isStep(data)) {
      if (data.type === 'function_call') steps.push(<ToolStep key={id} call={data} output={outputs.get(data.call_id)} running={running} openFile={openFile} />)
      else if (data.type === 'reasoning') steps.push(<Step key={id} icon="thought" label="Thought"><Markdown text={data.summary} /></Step>)
      else if (data.type === 'web_search_call') {
        const action = data.action as { query?: string; url?: string } | null
        steps.push(<Step key={id} icon="search" label={action?.query ? `Search “${action.query}”` : action?.url ? `Read ${site(action.url)}` : 'Search the web'} />)
      }
      continue
    }
    flush(id)
    if (data.type === 'message') {
      if (data.role === 'assistant') blocks.push(<div key={id} className="msg assistant"><Markdown text={data.text} /></div>)
      else if (data.source === 'subagent') blocks.push(<SubagentReport key={id} text={data.text} />)
      else if (data.source === 'parent') blocks.push(<div key={id} className="msg task"><div className="eyebrow">Task</div>{data.text}</div>)
      else blocks.push(<div key={id} className="msg user">{data.text}</div>)
    } else if (data.type === 'notice') {
      blocks.push(<div key={id} className={`notice ${data.level}`}>{data.text}</div>)
    }
  }
  flush(-1)
  return <>{blocks}</>
}

/** Every subagent under this chat as a strip of chips above the composer: tap to open, × to stop. */
function Subagents({ thread }: { thread: Thread }) {
  const threads = useStore((s) => s.threads)
  const root = rootOf(threads, thread)
  const all: Thread[] = []
  const collect = (parent: Thread) => {
    for (const t of threads.filter((x) => x.parentId === parent.id)) {
      all.push(t)
      collect(t)
    }
  }
  collect(root)
  if (!all.length) return null
  const running = all.filter((t) => t.status === 'running')
  return (
    <div className="subagents">
      <span className="subagents-label">
        <Icon name="agents" size={14} />
        {running.length ? `${running.length} running` : `${all.length} done`}
      </span>
      <div className="chips">
        {all.map((t) => (
          <span key={t.id} className={`chip ${t.id === thread.id ? 'active' : ''}`}>
            <button className="chip-main" onClick={() => navigate(t.botId, t.id)}>
              <StatusDot thread={t} />
              <span className="chip-title">{t.title}</span>
            </button>
            {t.status === 'running' && (
              <button className="chip-x" title="Stop" aria-label={`Stop ${t.title}`} onClick={() => api('POST', `/api/threads/${t.id}/stop`).catch(() => {})}>
                <Icon name="x" size={12} />
              </button>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

/** Model and reasoning pickers that live in the composer, so they are one tap away. */
function ModelPicker({ bot }: { bot: Bot }) {
  const connected = useStore((s) => s.providers).find((p) => p.id === bot.provider)?.connected
  const models = useModels(bot.provider, connected)

  const save = (patch: Partial<Bot>) => api('PATCH', `/api/bots/${bot.id}`, patch).catch(() => {})
  // The first model is the provider's default, stored as "" so the bot follows it if it changes.
  const options = bot.model && !models.includes(bot.model) ? [...models, bot.model] : models
  return (
    <>
      <select className="picker" aria-label="Model" value={bot.model === models[0] ? '' : bot.model} onChange={(e) => save({ model: e.target.value })}>
        <option value="">{models[0] ?? 'Default model'}</option>
        {options.filter((m) => m !== models[0]).map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <select className="picker" aria-label="Reasoning effort" value={bot.effort} onChange={(e) => save({ effort: e.target.value as Effort })}>
        <option value="">Auto</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </>
  )
}

const SUGGESTIONS = [
  'Find today’s top tech headlines and summarize them',
  'Compare three laptops in parallel using subagents',
  'Remember that I like short answers with sources',
]

interface Props {
  bot: Bot
  thread?: Thread
  browserOpen: boolean
  toggleBrowser: () => void
  openNav: () => void
}

/** Unsent text per chat, so looking at a subagent and coming back does not lose it. */
const drafts = new Map<string, string>()
// Chats in another environment can have the same ids.
onEnvironmentChange(() => drafts.clear())

export function Chat({ bot, thread, browserOpen, toggleBrowser, openNav }: Props) {
  const items = useStore((s) => (thread ? s.items[thread.id] : undefined))
  const partial = useStore((s) => (thread ? s.partial[thread.id] : undefined))
  const threads = useStore((s) => s.threads)
  const provider = useStore((s) => s.providers).find((p) => p.id === bot.provider)
  const draftKey = thread?.id ?? bot.id
  const [draft, setDraftState] = useState(drafts.get(draftKey) ?? '')
  const setDraft = (text: string) => {
    drafts.set(draftKey, text)
    setDraftState(text)
  }
  const [error, setError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const input = useRef<HTMLTextAreaElement>(null)
  const prefs = usePrefs()

  const running = thread?.status === 'running'
  const parent = thread?.parentId ? threads.find((t) => t.id === thread.parentId) : undefined

  const connected = useStore((s) => s.connected)
  useEffect(() => {
    // Asked again when the connection comes back, in case the chat was opened while it was away.
    if (thread && !items && connected) loadThread(thread.id).then(() => setError(''), (e) => setError(e.message))
  }, [thread?.id, items, connected])

  // On touch devices focusing would pop up the keyboard on every navigation.
  useEffect(() => {
    if (matchMedia('(hover: hover)').matches) input.current?.focus()
  }, [thread?.id])

  // Follow new output only while the reader is already at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items, partial])

  // The conversation area changes height when the browser docks or the keyboard opens.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Grow the composer with its content.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [draft])

  const submit = async (value = draft) => {
    const text = value.trim()
    if (!text) return
    setDraft('')
    setError('')
    stick.current = true
    try {
      const id = thread?.id ?? (await api<Thread>('POST', `/api/bots/${bot.id}/threads`)).id
      await api('POST', `/api/threads/${id}/messages`, { text })
      if (!thread) navigate(bot.id, id)
    } catch (e: any) {
      setError(e.message)
      setDraft(text)
    }
  }

  return (
    <div className="parts">
      <header>
        <button className="icon menu" aria-label="Menu" onClick={openNav}><Icon name="menu" size={18} /></button>
        {parent && (
          <button className="icon" title={`Back to ${parent.title}`} aria-label="Back to parent chat" onClick={() => navigate(parent.botId, parent.id)}>
            <Icon name="back" />
          </button>
        )}
        <div className="heading">
          <span className="title">{thread ? thread.title : bot.name}</span>
          {thread && <span className="faint">{bot.name}</span>}
        </div>
        {thread && (
          <button className="icon" title="New chat" aria-label="New chat" onClick={() => navigate(bot.id)}><Icon name="compose" size={17} /></button>
        )}
        <button className="icon" title="Bot settings" aria-label={`Settings for ${bot.name}`} onClick={() => openSettings('bots', bot.id)}>
          <Icon name="sliders" size={17} />
        </button>
        <button className={`icon ${browserOpen ? 'on' : ''}`} title="Browser" aria-label="Toggle browser" aria-pressed={browserOpen} onClick={toggleBrowser}>
          <Icon name="globe" size={17} />
        </button>
      </header>

      <div
        className="scroller"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        <div className="column">
          {!thread && (
            <div className="empty">
              <div className="avatar big">{bot.emoji}</div>
              <h1>{bot.name}</h1>
              {provider?.connected ? (
                prefs.suggestions && (
                  <div className="suggestions">
                    {SUGGESTIONS.map((s) => <button key={s} onClick={() => submit(s)}>{s}</button>)}
                  </div>
                )
              ) : (
                <>
                  <p>Connect a model to start chatting.</p>
                  <button className="primary" onClick={() => openSettings('providers')}>Connect</button>
                </>
              )}
            </div>
          )}
          {items && <Items items={items} running={running} openFile={(file) => openSettings('bots', bot.id, 'files', ...file.split('/'))} />}
          {partial?.reasoning && (
            <div className="activity">
              <details className="step">
                <summary className="step-head"><span className="spinner" /><span className="step-label">Thinking</span><Icon name="chevron" size={12} /></summary>
                <div className="step-body"><Markdown text={partial.reasoning} live /></div>
              </details>
            </div>
          )}
          {partial?.text && <div className="msg assistant"><Markdown text={partial.text} live /></div>}
          {running && !partial?.text && !partial?.reasoning && <div className="working"><span className="spinner" /> Working</div>}
          {error && <div className="notice error">{error}</div>}
        </div>
      </div>

      <footer>
        <div className="column">
          {thread && <Subagents thread={thread} />}
          <div className="composer">
            <textarea
              ref={input}
              value={draft}
              rows={1}
              placeholder={thread?.kind === 'subagent' ? 'Message this subagent' : `Message ${bot.name}`}
              aria-label="Message"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // Touch keyboards have no Shift+Enter, so there Enter makes a new line and the button sends.
                const desktop = matchMedia('(hover: hover) and (pointer: fine)').matches
                // With "Enter sends" off, Enter makes a new line and Cmd or Ctrl with Enter sends.
                const sends = e.metaKey || e.ctrlKey || (desktop && prefs.enterSends && !e.shiftKey)
                if (e.key === 'Enter' && sends && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit()
                }
              }}
            />
            <div className="composer-bar">
              <ModelPicker bot={bot} />
              <span className="grow" />
              {running && (
                <button className="send stop" title="Stop" aria-label="Stop" onClick={() => api('POST', `/api/threads/${thread.id}/stop`).catch((e) => setError(e.message))}>
                  <Icon name="stop" size={18} />
                </button>
              )}
              {(!running || draft.trim()) && (
                // Not taking focus keeps the phone keyboard up after sending.
                <button className="send" title="Send" aria-label="Send" disabled={!draft.trim()} onPointerDown={(e) => e.preventDefault()} onClick={() => submit()}>
                  <Icon name="up" size={18} />
                </button>
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
