// One bot's settings, as pages inside Settings. Each tab only reads and writes the bot's folder on
// the server: the owner's settings (Bot), what more the bot may do (Superpowers) and what the bot
// itself keeps (Workspace: its instructions, its memory and its working files).
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { Bot, Effort, FileEntry, HistoryEntry, Look } from '@openkumi/shared'
import { Icon } from './Icon'
import { triggerLabel } from '@openkumi/client/automations'
import { sizeOf } from '@openkumi/client/attachments'
import { windowCount } from '@openkumi/client/browser'
import { describeLook } from '@openkumi/client/mascot'
import { EFFORT_LABEL, effortsOf, useModels } from '@openkumi/client/models'
import { INSTRUCTIONS, authorOf, byDay, childrenOf, clockOf, fileUrl, findFiles, folderOf, hintOf, isRecorded, kindOfFile, lastChange, nameOf, notesAndFiles, parseDiff, since, summarize } from '@openkumi/client/workspace'
import { type Dress, LookEditor } from './LookEditor'
import { FileLinks, Markdown } from './Markdown'
import { Mascot } from './Mascot'
import { Field, Page, Pick, Row, Section, Switch, onServer } from './settingsUi'
import { api, download, openAutomations, openSettings, request, useChanges, useFiles, useStore } from './store'
import { SuperpowerCatalog, SuperpowerPage } from './Superpowers'

export type BotTab = 'bot' | 'superpowers' | 'workspace'
export const TABS: [BotTab, string][] = [['bot', 'Bot'], ['superpowers', 'Superpowers'], ['workspace', 'Workspace']]

const workspaceLink = (botId: string, path = '') => `#/settings/bots/${encodeURIComponent(botId)}/workspace${path ? `/${path.split('/').map(encodeURIComponent).join('/')}` : ''}`

/** Runs something that talks to the server and shows what went wrong, if anything did. */
function useAction() {
  const [error, setError] = useState('')
  const run = async (fn: () => Promise<unknown>) => {
    setError('')
    try {
      await fn()
    } catch (e: any) {
      setError(e.message)
    }
  }
  return { error, run, note: error && <div className="notice error">{error}</div> }
}

/** The bot's mascot and everything to change about it. Each change is saved at once, and shown before the server says so. */
function LookRow({ bot }: { bot: Bot }) {
  const [shown, setShown] = useState<Dress | null>(null)
  const { run, note } = useAction()
  useEffect(() => setShown(null), [bot.look, bot.emoji])
  const dress = shown ?? { look: bot.look, emoji: bot.emoji }
  const change = (patch: { look?: Partial<Look>; emoji?: string }) => {
    setShown({ look: { ...dress.look, ...patch.look }, emoji: patch.emoji ?? dress.emoji })
    run(() => api('PATCH', `/api/bots/${bot.id}`, patch))
  }
  return (
    <div className="set-row look-row" id="bot-look">
      <div className="look-stage">
        <Mascot look={dress.look} emoji={dress.emoji} live />
        <p>{bot.choosingLook ? `${bot.name} is choosing its look…` : describeLook(dress.look)}</p>
      </div>
      <div className="look-side">
        {note}
        <LookEditor look={dress.look} emoji={dress.emoji} change={change} pick={async () => change(await api<Dress>('POST', '/api/looks/pick', { botId: bot.id }))} />
      </div>
    </div>
  )
}

/** `file` is the file open in Workspace; `power`, the superpower whose page is open in Superpowers. */
export function BotPage({ botId, tab, file, power }: { botId: string; tab: BotTab; file?: string; power?: string }) {
  const bot = useStore((s) => s.bots).find((b) => b.id === botId)
  // The bot can be deleted from here or from another window.
  useEffect(() => {
    if (!bot) openSettings('bots')
  }, [bot])
  if (!bot) return null
  const counts: Partial<Record<BotTab, number>> = { superpowers: bot.superpowers.length }
  return (
    <>
      <div className="tabbar" role="tablist">
        {TABS.map(([id, label]) => (
          <a key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} href={`#/settings/bots/${encodeURIComponent(bot.id)}/${id}`}>
            {label}
            {!!counts[id] && <span className="count">{counts[id]}</span>}
          </a>
        ))}
      </div>
      {tab === 'bot' && <General bot={bot} />}
      {tab === 'superpowers' && (power ? <SuperpowerPage id={power} bot={bot} /> : <SuperpowerCatalog bot={bot} />)}
      {tab === 'workspace' && <Workspace key={file} bot={bot} initial={file} />}
    </>
  )
}

// ---- Bot: what the owner sets

function General({ bot }: { bot: Bot }) {
  const providers = useStore((s) => s.providers)
  const home = useStore((s) => s.home)
  const browser = useStore((s) => s.browsers[bot.id])
  const zone = useStore((s) => s.about.timeZone)
  const automations = useStore((s) => s.automations).filter((a) => a.botId === bot.id)
  const { entries } = useFiles(bot.id)
  const { run, note } = useAction()
  const save = (patch: Partial<Bot>) => run(() => api('PATCH', `/api/bots/${bot.id}`, patch))
  const provider = providers.find((p) => p.id === bot.provider)
  const models = useModels(bot.provider, provider?.connected)
  // What the bot could run on: everything that is ready, plus what it runs on now.
  const choices = providers.filter((p) => (p.connected && p.enabled !== false) || p.id === bot.provider)
  // The first model is the provider's default, stored as "" so the bot follows it if it changes.
  const modelOptions = [
    ['', models[0] && models[0].name !== 'Default' ? `${models[0].name} (default)` : 'Default'] as const,
    ...models.slice(1).map((m) => [m.id, m.name] as const),
    // A model the bot was given that the provider no longer lists is still its model.
    ...(bot.model && !models.some((m) => m.id === bot.model) ? [[bot.model, bot.model] as const] : []),
  ]
  // The levels the bot's model takes, plus the one it has now if that is not among them.
  const model = models.find((m) => m.id === bot.model) ?? models[0]
  const levels = [...new Set([...effortsOf(model), ...(bot.effort ? [bot.effort] : [])])] as Exclude<Effort, ''>[]
  const effortOptions = [['', model?.defaultEffort ? `Auto (${EFFORT_LABEL[model.defaultEffort]})` : 'Auto'] as const, ...levels.map((level) => [level, EFFORT_LABEL[level]] as const)]

  const remove = async () => {
    if (!confirm(`Delete ${bot.name}? Its conversations, files, memory and saved logins are removed permanently.`)) return
    // The page goes back to the list of bots by itself once this bot is gone.
    await run(() => api('DELETE', `/api/bots/${bot.id}`))
  }

  return (
    <Page>
      {note}
      <Section title="Identity">
        <Row id="bot-name" title="Name" control={<Field label="Name" value={bot.name} onCommit={(name) => api('PATCH', `/api/bots/${bot.id}`, { name })} />} />
        <Row
          id="bot-description"
          title="What it is for"
          description={<>One line. The other bots are told it, so they know what to pass on to this bot; the bot cannot change it. What every bot is told is under <a href="#/settings/prompt">Master prompt</a>.</>}
        >
          <Field label="What it is for" className="set-input set-line" value={bot.description} placeholder="For example: plans trips and books travel." onCommit={(description) => api('PATCH', `/api/bots/${bot.id}`, { description })} />
        </Row>
      </Section>

      <Section title="Look">
        <LookRow bot={bot} />
      </Section>

      <Section title="Rules">
        <Row
          id="bot-rules"
          title="Rules from you"
          description={<>The bot follows these and cannot change them. Its own instructions, which it writes and updates itself, are in <a href={workspaceLink(bot.id, INSTRUCTIONS)}>its workspace</a>, in AGENTS.md.</>}
        >
          <Field label="Rules" rows={4} className="set-input set-area" value={bot.rules} placeholder="For example: never send an email without asking me first." onCommit={(rules) => api('PATCH', `/api/bots/${bot.id}`, { rules })} />
        </Row>
      </Section>

      <Section title="Workspace">
        <Row
          id="bot-workspace"
          title="Its workspace"
          description={<>{entries ? `AGENTS.md · ${notesAndFiles(summarize(entries))}` : 'AGENTS.md, its memory and its working files'}<br />{bot.name} keeps these itself. Its changes to instructions and memory can be undone.</>}
          control={<a className="button" href={workspaceLink(bot.id)}>Explore <Icon name="chevron" size={13} /></a>}
        />
        <Row
          title="Where it lives"
          description={<code>{home}/bots/{bot.id}</code>}
          control={onServer() && <button onClick={() => run(() => api('POST', '/api/reveal', { botId: bot.id }))}><Icon name="folder" size={14} /> Open folder</button>}
        />
      </Section>

      <Section title="Model">
        <Row
          id="bot-runs-on"
          title="Runs on"
          description="Whose model answers for this bot."
          status={provider && !provider.connected ? `${provider.name} is not connected.` : undefined}
          // Model names differ between providers, so the choice of model starts over.
          control={<Pick label="Runs on" value={bot.provider} options={choices.map((p) => [p.id, p.name] as const)} onChange={(id) => save({ provider: id, model: '' })} />}
        />
        <Row title="Model" control={<Pick label="Model" value={bot.model} options={modelOptions} onChange={(model) => save({ model })} />} />
        <Row
          title="Reasoning effort"
          description="How long the model may think before it answers."
          control={<Pick<Effort> label="Reasoning effort" value={bot.effort} options={effortOptions} onChange={(effort) => save({ effort })} />}
        />
        <Row title="Web search" description="Use the model’s built-in search." control={<Switch label="Web search" checked={bot.webSearch} onChange={(webSearch) => save({ webSearch })} />} />
      </Section>

      <Section title="Automations" action={<button onClick={() => openAutomations('new', bot.id)}><Icon name="plus" size={14} /> New automation</button>}>
        {automations.map((automation) => (
          <a key={automation.id} className="set-row set-link" href={`#/automations/${encodeURIComponent(automation.id)}`}>
            <div className="set-row-main">
              <span className="row-ic"><Icon name={automation.trigger.kind === 'time' ? 'clock' : automation.trigger.kind === 'watch' ? 'eye' : 'bolt'} size={15} /></span>
              <div className="set-row-text">
                <h3>{automation.title}</h3>
                <p>{automation.enabled ? triggerLabel(automation.trigger, zone) : 'Paused'}</p>
              </div>
              <Icon name="chevron" size={14} />
            </div>
          </a>
        ))}
        {!automations.length && <Row title="No automations yet" description={`Make one with New automation, or ask ${bot.name}, for example “every weekday at 8, send me a short news brief”.`} />}
      </Section>

      <Section title="Browser">
        <Row
          title="Show the browser window"
          description="Also open this bot’s browser on the desktop of the computer running OpenKumi. Some sites only allow sign-in this way. Takes effect the next time its browser starts."
          control={<Switch label="Show the browser window" checked={!bot.headless} onChange={(shown) => save({ headless: !shown })} />}
        />
        <Row
          title="Its browser"
          description={browser?.running ? `Running, with ${windowCount(browser)} open: one for each conversation, subagent or run of an automation that is browsing. They share its logins.` : 'Not running. It starts when the bot needs it.'}
          control={browser?.running && <button onClick={() => run(() => api('POST', `/api/bots/${bot.id}/browser/stop`))}>Stop</button>}
        />
      </Section>

      <Section title="Danger zone">
        <Row title="Delete this bot" description="Removes its conversations, files, memory and saved logins. This cannot be undone." control={<button className="danger" onClick={remove}>Delete bot</button>} />
      </Section>
    </Page>
  )
}

// ---- Workspace: what the bot keeps for itself, and the recorded changes to it

/**
 * The bot's own folder: Files, a tree beside the file open (to read, or to edit), and Changes, what
 * was recorded about its instructions and memory, each with what it changed and a way to undo it.
 */
function Workspace({ bot, initial }: { bot: Bot; initial?: string }) {
  const [view, setView] = useState<'files' | 'changes'>('files')
  /** A change asked for from a file ("See change"), opened when Changes shows. */
  const [shown, setShown] = useState<string | null>(null)
  /** A file asked for from Changes ("Open people.md"). */
  const [wanted, setWanted] = useState<{ path: string } | null>(null)
  const { entries } = useFiles(bot.id)
  const changes = useChanges(bot.id)
  const switcher = (
    <div className="segmented" role="group" aria-label="View">
      <button className={view === 'files' ? 'active' : ''} aria-pressed={view === 'files'} onClick={() => setView('files')}>Files</button>
      <button className={view === 'changes' ? 'active' : ''} aria-pressed={view === 'changes'} onClick={() => setView('changes')}>Changes</button>
    </div>
  )
  return (
    <div className="files-tab">
      {/* Files stays as it was while Changes shows, edits included. */}
      <div className="files-part" hidden={view !== 'files'}>
        <Files bot={bot} entries={entries} changes={changes.data?.changes ?? []} initial={initial} wanted={wanted} switcher={switcher} seeChange={(id) => (setShown(id), setView('changes'))} />
      </div>
      {view === 'changes' && <Changes bot={bot} entries={entries} switcher={switcher} shown={shown} openFile={(path) => (setWanted({ path }), setView('files'))} {...changes} />}
    </div>
  )
}

interface OpenFile {
  path: string
  content: string
  binary: boolean
  size: number
}

const ICONS = { instructions: 'book', markdown: 'file', picture: 'image', table: 'table', text: 'file' } as const

/** The order of the top of the workspace, last first, as the tree shows it: what is not named comes after. */
const TOP = ['files', 'memory', INSTRUCTIONS]

/** The folders a path is in: "files/drafts/a.md" is in "files" and "files/drafts". */
const foldersOf = (path: string) => path.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))

function Files({ bot, entries, changes, initial, wanted, switcher, seeChange }: {
  bot: Bot
  entries: FileEntry[] | null
  changes: HistoryEntry[]
  initial?: string
  wanted: { path: string } | null
  switcher: ReactNode
  seeChange: (id: string) => void
}) {
  const version = useStore((s) => s.filesVersion[bot.id] ?? 0)
  // Above this the bot's instructions are cut off when they are loaded.
  const limit = useStore((s) => s.settings.instructionsLimit)
  const [open, setOpen] = useState<string | null>(initial ?? INSTRUCTIONS)
  const [file, setFile] = useState<OpenFile | null>(null)
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<'read' | 'edit'>('read')
  const [adding, setAdding] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // The top folders start open, and so does every folder the open file is in.
  const [expanded, setExpanded] = useState(() => new Set(['memory', 'files', ...foldersOf(initial ?? '')]))
  const { run, note } = useAction()
  const picker = useRef<HTMLInputElement>(null)
  const find = useRef<HTMLInputElement>(null)
  const dirty = !!file && !file.binary && draft !== file.content
  const unsaved = useRef(false)
  unsaved.current = dirty
  const summary = summarize(entries ?? [])

  // The open file follows the bot's own edits, unless the owner is in the middle of changing it.
  useEffect(() => {
    if (!open) return setFile(null)
    if (unsaved.current) return
    let current = true
    api<OpenFile>('GET', fileUrl(bot.id, open))
      .then((f) => {
        if (!current) return
        setFile(f)
        setDraft(f.content)
      })
      .catch(() => current && (setFile(null), setOpen(null)))
    return () => {
      current = false
    }
  }, [bot.id, open, version])

  useEffect(() => void (wanted && select(wanted.path)), [wanted])

  // ⌘F finds a file by name, while the files show.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'f' || !find.current?.offsetParent) return
      e.preventDefault()
      find.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const select = (path: string | null, as: 'read' | 'edit' = 'read') => {
    if (path === open) return
    if (dirty && !confirm(`Discard your unsaved changes to ${file!.path}?`)) return
    unsaved.current = false
    setFile(null)
    setMode(as)
    setOpen(path)
    if (path) setExpanded((had) => new Set([...had, ...foldersOf(path)]))
  }
  const toggle = (dir: string) => setExpanded((had) => (had.has(dir) ? new Set([...had].filter((d) => d !== dir)) : new Set([...had, dir])))
  const save = () =>
    run(async () => {
      await api('PUT', fileUrl(bot.id, file!.path), { content: draft })
      setFile({ ...file!, content: draft })
    })
  const create = () =>
    run(async () => {
      const path = (adding ?? '').trim().replace(/^\/+/, '')
      if (!path || path.endsWith('/')) throw new Error('Give the file a name, for example memory/people.md')
      if (entries?.some((e) => e.path === path)) throw new Error(`${path} already exists.`)
      await api('PUT', fileUrl(bot.id, path), { content: '' })
      setAdding(null)
      select(path, 'edit')
    })
  const remove = () => {
    if (!confirm(`Delete ${file!.path}?`)) return
    run(async () => {
      await api('DELETE', fileUrl(bot.id, file!.path))
      unsaved.current = false
      setFile(null)
      setOpen(null)
    })
  }
  const upload = (list: FileList | null) =>
    run(async () => {
      for (const f of Array.from(list ?? [])) {
        await request('POST', `/api/bots/${bot.id}/upload?name=${encodeURIComponent(f.name)}`, f)
      }
    })

  const row = (entry: FileEntry, depth: number, count = 0) => {
    const name = nameOf(entry.path)
    const hint = hintOf(entry.path, summary) || (entry.dir && depth ? String(count) : '')
    const style = { paddingLeft: 6 + depth * 14 }
    if (entry.dir) {
      const on = expanded.has(entry.path)
      return (
        <button key={entry.path} className="file-row dir" style={style} aria-expanded={on} onClick={() => toggle(entry.path)}>
          <span className="twisty"><Icon name="chevron" size={11} /></span>
          <Icon name="folder" size={14} />
          <span className="title">{name}</span>
          {hint && <span className="hint">{hint}</span>}
        </button>
      )
    }
    return (
      <button key={entry.path} className={`file-row ${entry.path === open ? 'active' : ''}`} style={style} aria-current={entry.path === open} onClick={() => select(entry.path)}>
        <span className="twisty" />
        <Icon name={ICONS[kindOfFile(entry.path)]} size={14} />
        <span className="title">{name}</span>
        {hint && <span className="hint">{hint}</span>}
      </button>
    )
  }
  const tree = (dir: string, depth: number): ReactNode[] =>
    childrenOf(entries ?? [], dir)
      // At the top: the bot's instructions on their own, then its memory, then its working files.
      .sort((a, b) => TOP.indexOf(b.entry.path) - TOP.indexOf(a.entry.path))
      .flatMap(({ entry, count }) => [
        row(entry, depth, count),
        ...(entry.path === INSTRUCTIONS && !depth ? [<div key="sep" className="tree-sep" />] : []),
        ...(entry.dir && expanded.has(entry.path) ? tree(entry.path, depth + 1) : []),
      ])
  const found = query.trim() ? findFiles(entries ?? [], query) : null

  return (
    <>
      <div className="files-bar">
        {switcher}
        <label className="file-find">
          <Icon name="search" size={14} />
          <input ref={find} aria-label="Find a file" placeholder="Find a file" value={query} spellCheck={false} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setQuery(''))} />
          {!query && <kbd>⌘F</kbd>}
        </label>
        <span className="grow" />
        <button className="ghost" onClick={() => setAdding(adding === null ? 'memory/' : null)}><Icon name="plus" size={14} /> New file</button>
        <button className="ghost" onClick={() => picker.current?.click()}><Icon name="upload" size={14} /> Upload</button>
        <input ref={picker} type="file" multiple hidden onChange={(e) => (upload(e.target.files), (e.target.value = ''))} />
      </div>
      {note}
      <div className={`files ${open ? 'has-open' : ''}`}>
        <div className="file-list">
          <div className="file-tree">
            {adding !== null && (
              <form className="new-file" onSubmit={(e) => (e.preventDefault(), create())}>
                <input autoFocus aria-label="Path of the new file" value={adding} spellCheck={false} autoCapitalize="off" onChange={(e) => setAdding(e.target.value)} />
                <button className="primary">Create</button>
              </form>
            )}
            {found
              ? found.map((entry) => (
                  <button key={entry.path} className={`file-row ${entry.path === open ? 'active' : ''}`} style={{ paddingLeft: 6 }} onClick={() => select(entry.path)}>
                    <Icon name={ICONS[kindOfFile(entry.path)]} size={14} />
                    <span className="title">{nameOf(entry.path)}</span>
                    <span className="hint">{folderOf(entry.path)}</span>
                  </button>
                ))
              : tree('', 0)}
            {found && !found.length && <p className="muted pad">No file is called that.</p>}
            {!entries && <p className="muted">Loading…</p>}
          </div>
          <div className="file-foot">
            <span className="grow">{summary.files} {summary.files === 1 ? 'file' : 'files'} · {sizeOf(summary.bytes)}</span>
            {onServer() && <button className="ghost" onClick={() => run(() => api('POST', '/api/reveal', { botId: bot.id }))}><Icon name="folder" size={13} /> Open folder</button>}
          </div>
        </div>
        <div className="file-view">
          {file ? (
            <>
              <div className="file-head">
                <button className="icon file-back" aria-label="Back to the file list" onClick={() => select(null)}><Icon name="back" /></button>
                <nav className="file-crumbs grow" aria-label="Where the file is">
                  {foldersOf(file.path).map((dir) => (
                    <span key={dir}>{nameOf(dir)}<Icon name="chevron" size={11} /></span>
                  ))}
                  <b>{nameOf(file.path)}</b>
                </nav>
                {!file.binary && (
                  <div className="segmented" role="group" aria-label="Read or edit">
                    <button className={mode === 'read' ? 'active' : ''} aria-pressed={mode === 'read'} onClick={() => setMode('read')}><Icon name="eye" size={13} /> Read</button>
                    <button className={mode === 'edit' ? 'active' : ''} aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}><Icon name="compose" size={13} /> Edit</button>
                  </div>
                )}
                <button className="icon" title="Download" aria-label="Download" onClick={() => run(() => download(`${fileUrl(bot.id, file.path)}&download=1`, nameOf(file.path)))}><Icon name="download" size={15} /></button>
                <details className="set-menu">
                  <summary className="icon" title="More" aria-label={`More for ${nameOf(file.path)}`}><Icon name="more" /></summary>
                  <div className="set-menu-items">
                    <button className="danger" onClick={(e) => (e.currentTarget.closest('details')!.removeAttribute('open'), remove())}>Delete file</button>
                  </div>
                </details>
                {(mode === 'edit' || dirty) && !file.binary && <button className="primary" disabled={!dirty} onClick={save}>{dirty ? 'Save' : 'Saved'}</button>}
              </div>
              <FileMeta bot={bot} path={file.path} size={file.size} entries={entries} changes={changes} seeChange={seeChange} />
              {file.path === INSTRUCTIONS && (
                <p className="faint">
                  The bot’s own instructions, loaded into every conversation. It keeps this file up to date itself; you can edit it too.
                  {draft.length > limit && <span className="err"> It is {draft.length.toLocaleString()} characters long; only the first {limit.toLocaleString()} are loaded.</span>}
                </p>
              )}
              {file.binary ? (
                kindOfFile(file.path) === 'picture' ? (
                  <Picture url={`${fileUrl(bot.id, file.path)}&download=1`} name={nameOf(file.path)} />
                ) : (
                  <p className="muted">This file cannot be shown here ({sizeOf(file.size)}). Download it to open it.</p>
                )
              ) : mode === 'edit' ? (
                <textarea className="editor" aria-label={`Contents of ${file.path}`} value={draft} spellCheck={false} autoFocus={!draft} onChange={(e) => setDraft(e.target.value)} />
              ) : kindOfFile(file.path) === 'markdown' || kindOfFile(file.path) === 'instructions' ? (
                <div className="file-read">
                  <FileLinks.Provider value={(path) => select(path)}>
                    <Markdown text={draft} />
                  </FileLinks.Provider>
                  {!draft.trim() && <p className="muted">This file is empty. Edit it to write something.</p>}
                </div>
              ) : (
                <pre className="file-read plain">{draft}</pre>
              )}
            </>
          ) : (
            <p className="muted file-empty">{open ? 'Loading…' : 'Choose a file to read or edit it.'}</p>
          )}
        </div>
      </div>
    </>
  )
}

/**
 * What is known of a file: for the instructions and memory, who changed it last and when, from
 * the recorded changes; for a working file, only when it changed, since those are not recorded.
 */
function FileMeta({ bot, path, size, entries, changes, seeChange }: { bot: Bot; path: string; size: number; entries: FileEntry[] | null; changes: HistoryEntry[]; seeChange: (id: string) => void }) {
  const modified = entries?.find((e) => e.path === path)?.modified
  if (!isRecorded(path)) {
    return (
      <p className="file-meta">
        Working file{modified ? ` · changed ${since(modified)}` : ''} · {sizeOf(size)} · Changes to working files are not recorded.
      </p>
    )
  }
  const last = lastChange(changes, path)
  return (
    <p className="file-meta">
      {last ? <>{authorOf(last, bot.name)} changed this {since(last.time)} · </> : modified ? <>Changed {since(modified)} · </> : null}
      {sizeOf(size)}
      {last && <> · <button className="link" onClick={() => seeChange(last.id)}>See change</button></>}
    </p>
  )
}

/** A picture from the workspace, fetched with the access code, as the window cannot ask for it by address. */
function Picture({ url, name }: { url: string; name: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let made = ''
    let current = true
    request('GET', url)
      .then((res) => res.blob())
      .then((blob) => current && setSrc((made = URL.createObjectURL(blob))), () => current && setFailed(true))
    return () => {
      current = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [url])
  if (failed) return <p className="muted">This picture could not be loaded. Download it to open it.</p>
  return <div className="file-picture">{src ? <img src={src} alt={name} /> : <p className="muted">Loading…</p>}</div>
}

/** A change, file by file: added, removed and unchanged lines. */
function Diff({ text }: { text: string }) {
  const sign = { add: '+', del: '−', same: ' ', gap: '' }
  return (
    <pre className="diff">
      {parseDiff(text).map(({ file, lines }) => (
        <span key={file} className="diff-file">
          <span className="file">{file}</span>
          {lines.map((line, i) => (
            <span key={i} className={line.kind}>
              {line.kind !== 'gap' && <span className="sign">{sign[line.kind]}</span>}
              {line.text + '\n'}
            </span>
          ))}
        </span>
      ))}
    </pre>
  )
}

function Changes({ bot, entries, switcher, shown, openFile, data, error: failed, showOlder }: {
  bot: Bot
  entries: FileEntry[] | null
  switcher: ReactNode
  shown: string | null
  openFile: (path: string) => void
} & ReturnType<typeof useChanges>) {
  const [openId, setOpenId] = useState<string | null>(shown)
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!openId) return
    let current = true
    setDiff(null)
    setError('')
    api<{ diff: string }>('GET', `/api/bots/${bot.id}/history/${openId}`).then((d) => current && setDiff(d.diff), (e) => current && setError(e.message))
    return () => {
      current = false
    }
  }, [bot.id, openId])

  const undo = async (entry: HistoryEntry) => {
    if (!confirm(`Undo “${entry.message}”? Later changes are kept.`)) return
    setError('')
    try {
      await api('POST', `/api/bots/${bot.id}/history/${entry.id}/undo`)
      setOpenId(null)
    } catch (e: any) {
      setError(e.message)
    }
  }

  const body = !data ? (
    <p className="muted pad">{failed || 'Loading…'}</p>
  ) : !data.available ? (
    <p className="muted pad">History needs git, which was not found on this computer. Install git and restart OpenKumi to record changes.</p>
  ) : (
    <div className="history">
      {error && <div className="notice error">{error}</div>}
      {data.problem && <div className="notice error">Changes are not being recorded right now: {data.problem}</div>}
      {byDay(data.changes).map(({ day, changes }) => (
        <div key={day}>
          <div className="change-day">{day}</div>
          {changes.map((entry) => {
            const only = entry.files.length === 1 && entries?.some((e) => e.path === entry.files[0]) ? entry.files[0] : null
            return (
              <div key={entry.id} className={`change ${openId === entry.id ? 'open' : ''}`}>
                <button className="change-head" aria-expanded={openId === entry.id} onClick={() => setOpenId(openId === entry.id ? null : entry.id)}>
                  <span className={`pill ${entry.author === 'bot' ? 'warn' : ''}`}>{authorOf(entry, bot.name)}</span>
                  <span className="grow title">{entry.message}</span>
                  <span className="time">{clockOf(entry.time)}</span>
                  <span className="twisty"><Icon name="chevron" size={12} /></span>
                </button>
                {openId === entry.id && (
                  <div className="change-body">
                    {diff === null ? <p className="muted">Loading…</p> : <Diff text={diff} />}
                    <div className="change-actions">
                      {entry.author !== 'system' && <button onClick={() => undo(entry)}><Icon name="undo" size={14} /> Undo this change…</button>}
                      {only && <button className="ghost" onClick={() => openFile(only)}><Icon name="file" size={14} /> Open {nameOf(only)}</button>}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}
      {data.more && <button className="ghost change-more" onClick={showOlder}>Show older changes</button>}
      {!data.changes.length && <p className="muted pad">Nothing has changed yet.</p>}
      <p className="faint pad">Changes to its instructions and memory are recorded here, and each can be undone. Changes to working files are not recorded.</p>
    </div>
  )
  return (
    <>
      <div className="files-bar">{switcher}</div>
      {body}
    </>
  )
}
