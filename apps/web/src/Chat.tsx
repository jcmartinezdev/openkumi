import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Bot, Item, ItemData, Thread } from '@openkumi/shared'
import { MAX, addFiles, ready, removeFile, sent, usePending } from '@openkumi/client/attachments'
import { SentFiles, Tray, picked } from './Attachments'
import { History, day } from './History'
import { Icon } from './Icon'
import { CopyButton, FileLinks, Markdown } from './Markdown'
import { ModelPicker } from './ModelPicker'
import { PageFrame, PageViewer } from './PageFrame'
import { usePrefs } from './prefs'
import { StatusDot } from './Sidebar'
import { describe, parse, site } from '@openkumi/client/steps'
import { api, loadOlder, loadThread, mainThread, navigate, onEnvironmentChange, openSettings, openTasks, openThread, recentSubagents, rootOf, useStore } from './store'
import { BotHead, Mascot } from './Mascot'

type Call = Extract<ItemData, { type: 'function_call' }>

const FILE_TOOLS = new Set(['list_files', 'read_file', 'write_file', 'edit_file', 'search_files', 'move_file', 'delete_file'])
const toolIcon = (name: string) =>
  name.startsWith('browser_') || name === 'web_fetch' ? 'globe'
  : name.includes('subagent') ? 'agents'
  : name.includes('scheduled_task') || name === 'schedule_task' ? 'clock'
  : FILE_TOOLS.has(name) ? 'file'
  : name.startsWith('mcp__') ? 'sparkles'
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
  return (
    <button
      className="pill link"
      onClick={(e) => {
        e.preventDefault()
        if (child) return navigate(child.botId, child.id)
        // Older subagents and runs are not in the list: the thread is fetched to see whose it is.
        loadThread(id).then((t) => t && navigate(t.botId, t.id), () => {})
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

/** What a scheduled run came to, as it arrives in the bot's conversation; it opens the run. */
function TaskReport({ text }: { text: string }) {
  const m = text.match(/Scheduled task "(.*?)" \(task: (\S+), run: (\S+)\) — (\w+)\n([\s\S]*?)\n?<\/scheduled_task_result>/)
  if (!m) return <div className="notice">{text}</div>
  const [, name, , run, status, body] = m
  return (
    <div className="activity">
      <Step icon="clock" label={`Scheduled task “${name}” ${status === 'completed' ? 'ran' : status}`} trailing={<SubagentLink id={run} />}>
        <Markdown text={body} />
      </Step>
    </div>
  )
}

const isStep = (d: ItemData) => d.type === 'function_call' || d.type === 'web_search_call' || (d.type === 'reasoning' && !!d.summary)

const duration = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/**
 * What the bot did between two messages. A long run of steps is folded into one line once it is
 * over ("12 steps · 1m 04s"), so the conversation reads as what was said; the run that is under
 * way stays open.
 */
function Activity({ steps, took, live }: { steps: ReactNode[]; took: number; live: boolean }) {
  const open = usePrefs().expandSteps
  if (live || steps.length <= 3) return <div className="activity">{steps}</div>
  return (
    <div className="activity">
      <details className="step steps" open={open || undefined}>
        <summary className="step-head">
          <Icon name="steps" size={14} />
          <span className="step-label">{steps.length} steps{took >= 1000 ? ` · ${duration(took)}` : ''}</span>
          <Icon name="chevron" size={12} />
        </summary>
        <div className="steps-body">{steps}</div>
      </details>
    </div>
  )
}

function Items({ items, running, openFile }: { items: Item[]; running: boolean; openFile: OpenFile }) {
  const outputs = useMemo(() => {
    const map = new Map<string, string>()
    for (const { data } of items) if (data.type === 'function_call_output') map.set(data.call_id, data.output)
    return map
  }, [items])

  // Where the bot's own view of a long conversation begins: before it, it has a summary.
  const summary = useMemo(() => items.findLast((i) => i.data.type === 'summary')?.data as Extract<ItemData, { type: 'summary' }> | undefined, [items])

  // When each call came back, so a run of steps can say how long it took.
  const ended = useMemo(() => {
    const map = new Map<string, number>()
    for (const { data, createdAt } of items) if (data.type === 'function_call_output') map.set(data.call_id, createdAt)
    return map
  }, [items])

  // Consecutive tool calls and thoughts collapse into one quiet activity log between messages.
  const blocks: ReactNode[] = []
  let steps: ReactNode[] = []
  let began = 0
  let last = 0
  const flush = (key: number, live = false) => {
    if (steps.length) blocks.push(<Activity key={`a${key}`} steps={steps} took={last - began} live={live} />)
    steps = []
  }
  let marked = false
  for (const { id, threadId, data, createdAt } of items) {
    if (data.type === 'function_call_output' || data.type === 'summary') continue
    // A page stands for the call that showed it; the call is only listed when it failed.
    if (data.type === 'function_call' && data.name === 'show_page' && !outputs.get(data.call_id)?.startsWith('Error:')) continue
    if (summary && !marked && id > summary.upTo) {
      marked = true
      flush(-id)
      blocks.push(
        <details key="summary" className="summarised">
          <summary><span>Above here, the bot works from a summary</span><Icon name="chevron" size={12} /></summary>
          <Markdown text={summary.text} />
        </details>,
      )
    }
    if (isStep(data)) {
      if (!steps.length) began = createdAt
      last = Math.max(createdAt, data.type === 'function_call' ? (ended.get(data.call_id) ?? createdAt) : createdAt)
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
      if (data.role === 'assistant') {
        blocks.push(
          <div key={id} data-item={id} className="msg assistant">
            <Markdown text={data.text} />
            <div className="msg-actions"><CopyButton text={data.text} label="Copy reply" /></div>
          </div>,
        )
      }
      else if (data.source === 'subagent') blocks.push(<div key={id} data-item={id}><SubagentReport text={data.text} /></div>)
      else if (data.source === 'task') blocks.push(<div key={id} data-item={id}><TaskReport text={data.text} /></div>)
      else if (data.source === 'parent') blocks.push(<div key={id} className="msg task"><div className="eyebrow">Task</div>{data.text}</div>)
      else if (data.source === 'schedule') blocks.push(<div key={id} className="msg task"><div className="eyebrow">Scheduled task</div>{data.text}</div>)
      else if (!data.attachments?.length) blocks.push(<div key={id} data-item={id} className="msg user">{data.text}</div>)
      else {
        blocks.push(
          <div key={id} data-item={id} className="said">
            <SentFiles threadId={threadId} files={data.attachments} />
            {data.text && <div className="msg user">{data.text}</div>}
          </div>,
        )
      }
    } else if (data.type === 'notice') {
      blocks.push(<div key={id} className={`notice ${data.level}`}>{data.text}</div>)
    } else if (data.type === 'page') {
      blocks.push(<div key={id} data-item={id}><PageFrame title={data.title} html={data.html} height={data.height} /></div>)
    }
  }
  flush(-1, running)
  return <>{blocks}</>
}

/**
 * The subagents under this conversation as a strip of chips above the composer: tap to open, × to
 * stop. A conversation goes on for good, so only the ones at work, or just done, are kept here;
 * older ones are opened from where they were started, further up.
 */
function Subagents({ thread }: { thread: Thread }) {
  const threads = useStore((s) => s.threads)
  const all = recentSubagents(threads, rootOf(threads, thread))
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
const SUGGESTIONS = [
  'Find today’s top tech headlines and summarize them',
  'Compare three laptops in parallel using subagents',
  'Remember that I like short answers with sources',
]

interface Props {
  bot: Bot
  /** The bot's conversation (none until something is said), a subagent's thread, or an earlier conversation. */
  thread?: Thread
  /** A message to bring into view, or 0. */
  focus: number
  browserOpen: boolean
  toggleBrowser: () => void
  openNav: () => void
}

/** Unsent text per conversation, so looking at a subagent and coming back does not lose it. */
const drafts = new Map<string, string>()
// Chats in another environment can have the same ids.
onEnvironmentChange(() => drafts.clear())

export function Chat({ bot, thread, focus, browserOpen, toggleBrowser, openNav }: Props) {
  const items = useStore((s) => (thread ? s.items[thread.id] : undefined))
  const older = useStore((s) => (thread ? !!s.older[thread.id] : false))
  const partial = useStore((s) => (thread ? s.partial[thread.id] : undefined))
  const threads = useStore((s) => s.threads)
  const provider = useStore((s) => s.providers).find((p) => p.id === bot.provider)
  const archived = !!thread?.archivedAt
  /** The bot's own conversation, as opposed to a subagent's thread or an earlier conversation. */
  const main = !thread || (!thread.parentId && !archived)
  const draftKey = main ? bot.id : thread.id
  const [draft, setDraftState] = useState(drafts.get(draftKey) ?? '')
  const setDraft = (text: string) => {
    drafts.set(draftKey, text)
    setDraftState(text)
  }
  const [error, setError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(!focus)
  const input = useRef<HTMLTextAreaElement>(null)
  const prefs = usePrefs()

  const running = thread?.status === 'running'
  const parent = thread?.parentId ? threads.find((t) => t.id === thread.parentId) : undefined

  // Files to send with the message, each on its way to the server from when it is picked.
  const files = usePending(draftKey)
  const attach = (list: Iterable<File>) => {
    const chosen = [...list]
    if (!chosen.length) return
    if (files.length + chosen.length > MAX) setError(`At most ${MAX} files can go with one message.`)
    addFiles(draftKey, bot.id, picked(chosen))
    input.current?.focus()
  }
  const filePicker = useRef<HTMLInputElement>(null)
  /** Files are being dragged over the conversation. */
  const [dropping, setDropping] = useState(false)
  const canAttach = !archived
  const uploading = !ready(files)
  const sendable = files.some((f) => f.staged)

  const connected = useStore((s) => s.connected)
  useEffect(() => {
    // Shows what is kept of the chat at once, then brings it up to date; again when the connection comes back.
    if (thread) openThread(thread.id).then(() => setError(''), (e) => setError(e.message))
  }, [thread?.id, connected])

  // On touch devices focusing would pop up the keyboard on every navigation.
  useEffect(() => {
    if (matchMedia('(hover: hover)').matches) input.current?.focus()
  }, [thread?.id])

  // Earlier messages are fetched a page at a time as the reader nears the top. While they are put
  // in above, what was on screen is kept where it was.
  const [fetchingOlder, setFetchingOlder] = useState(false)
  const fetching = useRef(false)
  const anchor = useRef<{ first: number; height: number; top: number } | null>(null)
  const showOlder = (to?: number) => {
    const el = scroller.current
    if (!thread || !items?.length || !el || fetching.current) return
    fetching.current = true
    anchor.current = { first: items[0].id, height: el.scrollHeight, top: el.scrollTop }
    setFetchingOlder(true)
    loadOlder(thread.id, to)
      .then(
        (added) => !added && (anchor.current = null),
        (e) => ((anchor.current = null), setError(e.message)),
      )
      .finally(() => ((fetching.current = false), setFetchingOlder(false)))
  }

  // A message that was asked for (found by searching) is brought into view and marked for a moment.
  // If it is older than what is held, everything back to it is fetched first.
  const first = items?.[0]?.id
  useEffect(() => {
    if (!focus || !items) return
    if (older && !items.some((i) => i.id === focus)) return showOlder(focus)
    const found = scroller.current?.querySelector(`[data-item="${focus}"]`)
    if (!found) return
    stick.current = false
    found.scrollIntoView({ block: 'center' })
    found.classList.add('found')
    const fade = setTimeout(() => found.classList.remove('found'), 2400)
    return () => clearTimeout(fade)
  }, [focus, first, thread?.id])

  // Follow new output only while the reader is already at the bottom.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const kept = anchor.current
    if (kept && first !== kept.first) {
      anchor.current = null
      el.scrollTop = kept.top + el.scrollHeight - kept.height
    } else if (stick.current) el.scrollTop = el.scrollHeight
    // A first page too short to scroll could never reach the top by scrolling.
    if (older && el.scrollHeight <= el.clientHeight) showOlder()
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

  /** Files of a message that is on its way, so a message sent right after it does not take them again. */
  const going = useRef(new Set<string>())
  const submit = async (value = draft) => {
    const text = value.trim()
    // The files go once they are all on the server; any that failed stay behind in the composer.
    const attached = files.filter((f) => f.staged && !going.current.has(f.id))
    if ((!text && !attached.length) || uploading || !connected) return
    const ids = attached.map((f) => f.id)
    ids.forEach((id) => going.current.add(id))
    setDraft('')
    setError('')
    stick.current = true
    try {
      // What is said to the bot goes to its one conversation, which begins with the first message.
      await api('POST', main ? `/api/bots/${bot.id}/messages` : `/api/threads/${thread.id}/messages`, { text, attachments: attached.map((f) => f.staged) })
      sent(draftKey, ids)
    } catch (e: any) {
      setError(e.message)
      setDraft(text)
    } finally {
      ids.forEach((id) => going.current.delete(id))
    }
  }

  // Sets the conversation aside and begins an empty one. It is kept, and can be continued from the earlier conversations.
  const startFresh = () => api('POST', `/api/bots/${bot.id}/fresh`).then(() => (setError(''), navigate(bot.id)), (e) => setError(e.message))
  const resume = () => api('POST', `/api/threads/${thread!.id}/resume`).then(() => navigate(bot.id), (e) => setError(e.message))
  const earlier = threads.some((t) => t.botId === bot.id && !t.parentId && t.archivedAt)
  const [historyOpen, setHistoryOpen] = useState(false)
  const openFile = (path: string) => openSettings('bots', bot.id, 'files', ...path.split('/'))

  // A reply's link to a page the bot saved opens that page; a link to any other of its files opens it in Files.
  const [saved, setSaved] = useState<{ title: string; html: string } | null>(null)
  const openLink = (path: string) => {
    if (!/\.html?$/i.test(path)) return openFile(path)
    api<{ content: string; binary: boolean }>('GET', `/api/bots/${bot.id}/file?path=${encodeURIComponent(path)}`).then(
      (file) => (file.binary ? openFile(path) : setSaved({ title: path.split('/').pop()!, html: file.content })),
      (e) => setError(e.message),
    )
  }
  // Where "back" leads: from a scheduled run to its task, from a subagent to whoever started it, from
  // an earlier conversation to the current one.
  const task = useStore((s) => (thread?.taskId ? s.tasks.find((t) => t.id === thread.taskId) : undefined))
  const back = parent ? { to: parent, label: `Back to ${parent.kind === 'subagent' ? parent.title : 'the conversation'}` } : archived ? { to: null, label: 'Back to the current conversation' } : null
  const goBack = () => {
    if (task) return openTasks(task.id)
    if (back?.to && back.to.id !== mainThread(threads, back.to.botId)?.id) return navigate(back.to.botId, back.to.id)
    navigate(back?.to?.botId ?? bot.id)
  }

  return (
    <div
      className={`parts ${dropping ? 'dropping' : ''}`}
      // Files dropped anywhere on the conversation go with the next message.
      onDragOver={(e) => {
        if (!canAttach || !e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropping(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
      onDrop={(e) => {
        if (!canAttach || !e.dataTransfer.files.length) return
        e.preventDefault()
        setDropping(false)
        attach(e.dataTransfer.files)
      }}
    >
      {dropping && <div className="drop-hint"><Icon name="plus" size={20} /> Drop files to send them to {bot.name}</div>}
      <header>
        <button className="icon menu" aria-label="Menu" onClick={openNav}><Icon name="menu" size={18} /></button>
        {back && (
          <button className="icon" title={task ? 'Back to the scheduled task' : back.label} aria-label={task ? 'Back to the scheduled task' : back.label} onClick={goBack}>
            <Icon name="back" />
          </button>
        )}
        <div className="heading">
          <span className="title">{main ? bot.name : thread.title}</span>
          {!main && <span className="faint">{archived ? `Earlier conversation · ${day(thread.createdAt)}` : thread.kind === 'task' ? `Scheduled run · ${day(thread.createdAt)} · ${bot.name}` : bot.name}</span>}
        </div>
        {main && (
          <>
            <History bot={bot} open={historyOpen} setOpen={setHistoryOpen} />
            <button className="icon" title="Start fresh" aria-label="Start fresh" disabled={running || !items?.length} onClick={startFresh}><Icon name="compose" size={17} /></button>
          </>
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
          if (older && el.scrollTop < 600) showOlder()
        }}
      >
        <FileLinks.Provider value={openLink}>
        <div className="column">
          {older && (
            <div className="older">
              {fetchingOlder ? <span className="spinner" aria-label="Loading earlier messages" /> : <button className="quiet" onClick={() => showOlder()}>Show earlier messages</button>}
            </div>
          )}
          {main && (!thread || items?.length === 0) && (
            <div className="empty">
              <div className="empty-mascot"><Mascot look={bot.look} emoji={bot.emoji} live /></div>
              <h1>{bot.name}</h1>
              {bot.choosingLook && <p className="faint">Choosing its look…</p>}
              {provider?.connected ? (
                <>
                  {prefs.suggestions && (
                    <div className="suggestions">
                      {SUGGESTIONS.map((s) => <button key={s} onClick={() => submit(s)}>{s}</button>)}
                    </div>
                  )}
                  {/* After starting fresh: where the conversation went. */}
                  {earlier && <button className="quiet" onClick={() => setHistoryOpen(true)}><Icon name="history" size={14} /> Earlier conversations</button>}
                </>
              ) : (
                <>
                  <p>Connect a model to start chatting.</p>
                  <button className="primary" onClick={() => openSettings('providers')}>Connect</button>
                </>
              )}
            </div>
          )}
          {items && <Items items={items} running={running} openFile={openFile} />}
          {partial?.reasoning && (
            <div className="activity">
              <details className="step">
                <summary className="step-head"><span className="spinner" /><span className="step-label">Thinking</span><Icon name="chevron" size={12} /></summary>
                <div className="step-body"><Markdown text={partial.reasoning} live /></div>
              </details>
            </div>
          )}
          {partial?.text && <div className="msg assistant"><Markdown text={partial.text} live /></div>}
          {running && !partial?.text && !partial?.reasoning && <div className="working"><BotHead bot={bot} sign={false} className="bob" /> Working</div>}
          {error && <div className="notice error">{error}</div>}
        </div>
        </FileLinks.Provider>
      </div>
      {saved && <PageViewer title={saved.title} html={saved.html} close={() => setSaved(null)} />}

      <footer>
        <div className="column">
          {thread && <Subagents thread={thread} />}
          {archived ? (
            <div className="set-aside">
              <span className="grow">This is an earlier conversation with {bot.name}. It can be read, and continued in place of the current one.</span>
              <button onClick={resume}>Continue this one</button>
            </div>
          ) : (
          <div className="composer">
            <Tray files={files} remove={(id) => removeFile(draftKey, id)} />
            <textarea
              ref={input}
              value={draft}
              rows={1}
              placeholder={!connected ? 'Offline. You can send once the connection is back.' : thread?.kind === 'subagent' ? 'Message this subagent' : thread?.kind === 'task' ? 'Message this run' : `Message ${bot.name}`}
              aria-label="Message"
              onChange={(e) => setDraft(e.target.value)}
              // Files pasted (a screenshot, a picture copied from a page, a file copied in Finder)
              // are attached. What also comes as both text and markup, as cells copied from a
              // spreadsheet do with a picture of themselves, is pasted as the text.
              onPaste={(e) => {
                const data = e.clipboardData
                if (!data.files.length || (data.types.includes('text/plain') && data.types.includes('text/html'))) return
                e.preventDefault()
                attach(data.files)
              }}
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
              <button className="icon attach" title="Attach files" aria-label="Attach files" onClick={() => filePicker.current?.click()}>
                <Icon name="plus" size={18} />
              </button>
              <input ref={filePicker} type="file" multiple hidden onChange={(e) => (attach(e.target.files ?? []), (e.target.value = ''))} />
              <span className="grow" />
              <ModelPicker bot={bot} />
              {running && (
                <button className="send stop" title="Stop" aria-label="Stop" onClick={() => api('POST', `/api/threads/${thread.id}/stop`).catch((e) => setError(e.message))}>
                  <Icon name="stop" size={18} />
                </button>
              )}
              {(!running || draft.trim() || sendable) && (
                // Not taking focus keeps the phone keyboard up after sending.
                <button
                  className="send"
                  title={!connected ? 'Offline' : uploading ? 'Waiting for the files' : 'Send'}
                  aria-label="Send"
                  disabled={(!draft.trim() && !sendable) || uploading || !connected}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => submit()}
                >
                  <Icon name="up" size={18} />
                </button>
              )}
            </div>
          </div>
          )}
        </div>
      </footer>
    </div>
  )
}
