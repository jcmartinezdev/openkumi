// One bot's settings, as pages inside Settings. Each tab only reads and writes the bot's folder on
// the server: the owner's settings (Bot), what the bot may use (Skills, Connections) and what the
// bot itself keeps (Files).
import { useEffect, useRef, useState } from 'react'
import type { Bot, Connection, ConnectionStatus, Effort, FileEntry, HistoryEntry, Skill } from '@openbot/shared'
import { Icon } from './Icon'
import { useModels } from './models'
import { ago } from './Sidebar'
import { Field, Page, Pick, Row, Section, Switch, onServer } from './settingsUi'
import { api, download, openSettings, refreshSkills, request, useStore } from './store'

export type BotTab = 'bot' | 'skills' | 'connections' | 'files'
const TABS: [BotTab, string][] = [['bot', 'Bot'], ['skills', 'Skills'], ['connections', 'Connections'], ['files', 'Files']]

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

export function BotPage({ botId, tab, file }: { botId: string; tab: BotTab; file?: string }) {
  const bot = useStore((s) => s.bots).find((b) => b.id === botId)
  // The bot can be deleted from here or from another window.
  useEffect(() => {
    if (!bot) openSettings('bots')
  }, [bot])
  if (!bot) return null
  const counts: Partial<Record<BotTab, number>> = { skills: bot.skills.length, connections: bot.connections.length }
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
      {tab === 'skills' && <Skills bot={bot} />}
      {tab === 'connections' && <Connections bot={bot} />}
      {tab === 'files' && <Files key={file} bot={bot} initial={file} />}
    </>
  )
}

// ---- Bot: what the owner sets

function General({ bot }: { bot: Bot }) {
  const providers = useStore((s) => s.providers)
  const home = useStore((s) => s.home)
  const browser = useStore((s) => s.browsers[bot.id])
  const { run, note } = useAction()
  const save = (patch: Partial<Bot>) => run(() => api('PATCH', `/api/bots/${bot.id}`, patch))
  const provider = providers.find((p) => p.id === bot.provider)
  const models = useModels(bot.provider, provider?.connected)
  // What the bot could run on: everything that is ready, plus what it runs on now.
  const choices = providers.filter((p) => (p.connected && p.enabled !== false) || p.id === bot.provider)
  // The first model is the provider's default, stored as "" so the bot follows it if it changes.
  const modelOptions = [['', models[0] ? `Default (${models[0]})` : 'Default'] as const, ...[...new Set([...models.slice(1), ...(bot.model ? [bot.model] : [])])].map((m) => [m, m] as const)]

  const remove = async () => {
    if (!confirm(`Delete ${bot.name}? Its chats, files, memory and saved logins are removed permanently.`)) return
    // The page goes back to the list of bots by itself once this bot is gone.
    await run(() => api('DELETE', `/api/bots/${bot.id}`))
  }

  return (
    <Page>
      {note}
      <Section title="Identity">
        <Row id="bot-name" title="Name" control={<Field label="Name" value={bot.name} onCommit={(name) => api('PATCH', `/api/bots/${bot.id}`, { name })} />} />
        <Row title="Avatar" description="An emoji shown beside the bot’s name." control={<Field label="Avatar emoji" className="set-input emoji" value={bot.emoji} onCommit={(emoji) => api('PATCH', `/api/bots/${bot.id}`, { emoji })} />} />
      </Section>

      <Section title="Rules">
        <Row
          id="bot-rules"
          title="Rules from you"
          description={<>The bot follows these and cannot change them. Its own instructions, which it writes and updates itself, are in <a href={`#/settings/bots/${encodeURIComponent(bot.id)}/files`}>Files</a>, in AGENTS.md.</>}
        >
          <Field label="Rules" rows={4} className="set-input set-area" value={bot.rules} placeholder="For example: never send an email without asking me first." onCommit={(rules) => api('PATCH', `/api/bots/${bot.id}`, { rules })} />
        </Row>
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
          control={<Pick<Effort> label="Reasoning effort" value={bot.effort} options={[['', 'Auto'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]} onChange={(effort) => save({ effort })} />}
        />
        <Row title="Web search" description="Use the model’s built-in search." control={<Switch label="Web search" checked={bot.webSearch} onChange={(webSearch) => save({ webSearch })} />} />
      </Section>

      <Section title="Browser">
        <Row
          title="Show the browser window"
          description="Also open this bot’s browser on the desktop of the computer running Open Bot. Some sites only allow sign-in this way. Takes effect the next time its browser starts."
          control={<Switch label="Show the browser window" checked={!bot.headless} onChange={(shown) => save({ headless: !shown })} />}
        />
        <Row
          title="Its browser"
          description={browser?.running ? `Running, with ${browser.tabs.length} ${browser.tabs.length === 1 ? 'tab' : 'tabs'} open.` : 'Not running. It starts when the bot needs it.'}
          control={browser?.running && <button onClick={() => run(() => api('POST', `/api/bots/${bot.id}/browser/stop`))}>Stop</button>}
        />
      </Section>

      <Section title="Folder">
        <Row
          title="Where this bot lives"
          description={<code>{home}/bots/{bot.id}</code>}
          control={onServer() && <button onClick={() => run(() => api('POST', '/api/reveal', { botId: bot.id }))}><Icon name="folder" size={14} /> Open folder</button>}
        />
      </Section>

      <Section title="Danger zone">
        <Row title="Delete this bot" description="Removes its chats, files, memory and saved logins. This cannot be undone." control={<button className="danger" onClick={remove}>Delete bot</button>} />
      </Section>
    </Page>
  )
}

// ---- Skills: the catalog, switched on per bot

function Skills({ bot }: { bot: Bot }) {
  const skills = useStore((s) => s.skills)
  const { run, note } = useAction()
  useEffect(() => {
    refreshSkills().catch(() => {})
  }, [])

  const set = (skill: Skill, on: boolean) => {
    const warning = `“${skill.title}” did not come with Open Bot. The bot will follow its instructions with access to its browser and accounts. Switch it on?`
    if (on && !skill.bundled && !confirm(warning)) return
    run(() => api('PUT', `/api/bots/${bot.id}/skills/${encodeURIComponent(skill.name)}`, { on }))
  }

  return (
    <Page>
      <p className="set-intro">Instructions the bot reads when a task calls for them. Only you can switch them on; the bot cannot change them. The catalog is under <a href="#/settings/skills">Skills</a>.</p>
      {note}
      <Section title="Skills">
        {skills.map((skill) => (
          <Row
            key={skill.name}
            title={<>{skill.title}{!skill.bundled && <span className="pill">Added by you</span>}</>}
            description={skill.description}
            control={<Switch label={`Use ${skill.title}`} checked={bot.skills.includes(skill.name)} onChange={(on) => set(skill, on)} />}
          />
        ))}
        {!skills.length && <Row title="The catalog is empty" />}
      </Section>
    </Page>
  )
}

// ---- Connections: MCP servers, switched on and signed in per bot

export function statusPill(status: ConnectionStatus | undefined) {
  if (!status || status.state === 'connecting') return <span className="pill">Connecting…</span>
  if (status.state === 'connected') return <span className="pill good">{status.tools} {status.tools === 1 ? 'tool' : 'tools'}</span>
  if (status.state === 'needs-login') return <span className="pill warn">Sign-in needed</span>
  return <span className="pill bad">Not working</span>
}

function Connections({ bot }: { bot: Bot }) {
  const connections = useStore((s) => s.connections)
  const statuses = useStore((s) => s.connectionStatus[bot.id])
  const { run, note } = useAction()
  const local = onServer()

  // Nothing connects until it is needed, so opening the page asks for the current state.
  useEffect(() => {
    api('POST', `/api/bots/${bot.id}/connections/check`).catch(() => {})
  }, [bot.id])

  const path = (c: Connection) => `/api/bots/${bot.id}/connections/${encodeURIComponent(c.name)}`
  const signIn = (c: Connection) =>
    run(async () => {
      // The sign-in page opens in the computer's own browser, where the person's accounts already are.
      const { url } = await api<{ url: string | null }>('POST', `${path(c)}/login`)
      if (url) window.open(url)
    })

  return (
    <Page>
      <p className="set-intro">Services the bot can use through MCP, such as mail or a calendar. Each bot signs in with its own account. Add or remove connections under <a href="#/settings/connections">Connections</a>.</p>
      {note}
      <Section title="Connections">
        {connections.map((c) => {
          const on = bot.connections.includes(c.name)
          const status = statuses?.[c.name]
          return (
            <Row
              key={c.name}
              title={<>{c.name}{on && statusPill(status)}</>}
              description={<span className="mono">{c.target}</span>}
              status={on && (status?.error ? <span className="err">{status.error}</span> : status?.state === 'needs-login' && !local ? 'Sign in from the computer that runs Open Bot.' : undefined)}
              control={
                <>
                  {on && status?.state === 'needs-login' && local && <button className="primary" onClick={() => signIn(c)}>Sign in</button>}
                  {on && status?.signedIn && <button className="ghost" onClick={() => run(() => api('POST', `${path(c)}/logout`))}>Sign out</button>}
                  <Switch label={`Use ${c.name}`} checked={on} onChange={(next) => run(() => api('PUT', path(c), { on: next }))} />
                </>
              }
            />
          )
        })}
        {!connections.length && <Row title="No connections yet" description="Add one under Connections, then switch it on here." />}
      </Section>
    </Page>
  )
}

// ---- Files: the bot's own workspace, and the history of what changed in it

interface OpenFile {
  path: string
  content: string
  binary: boolean
  size: number
}

function Files({ bot, initial }: { bot: Bot; initial?: string }) {
  const version = useStore((s) => s.filesVersion[bot.id] ?? 0)
  // Above this the bot's instructions are cut off when they are loaded.
  const limit = useStore((s) => s.settings.instructionsLimit)
  const [view, setView] = useState<'files' | 'history'>('files')
  const [entries, setEntries] = useState<FileEntry[] | null>(null)
  const [open, setOpen] = useState<string | null>(initial ?? 'AGENTS.md')
  const [file, setFile] = useState<OpenFile | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const { run, note } = useAction()
  const picker = useRef<HTMLInputElement>(null)
  const dirty = !!file && !file.binary && draft !== file.content
  const unsaved = useRef(false)
  unsaved.current = dirty
  const url = (path: string) => `/api/bots/${bot.id}/file?path=${encodeURIComponent(path)}`
  const name = (path: string) => path.split('/').pop() || 'file'

  useEffect(() => {
    let current = true
    api<{ entries: FileEntry[] }>('GET', `/api/bots/${bot.id}/files`).then((r) => current && setEntries(r.entries)).catch(() => {})
    return () => {
      current = false
    }
  }, [bot.id, version])

  // The open file follows the bot's own edits, unless the owner is in the middle of changing it.
  useEffect(() => {
    if (!open) return setFile(null)
    if (unsaved.current) return
    let current = true
    api<OpenFile>('GET', url(open))
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

  const select = (path: string | null) => {
    if (path === open) return
    if (dirty && !confirm(`Discard your unsaved changes to ${file!.path}?`)) return
    unsaved.current = false
    setFile(null)
    setOpen(path)
  }
  const save = () =>
    run(async () => {
      await api('PUT', url(file!.path), { content: draft })
      setFile({ ...file!, content: draft })
    })
  const create = () =>
    run(async () => {
      const path = (adding ?? '').trim().replace(/^\/+/, '')
      if (!path || path.endsWith('/')) throw new Error('Give the file a name, for example memory/people.md')
      if (entries?.some((e) => e.path === path)) throw new Error(`${path} already exists.`)
      await api('PUT', url(path), { content: '' })
      setAdding(null)
      select(path)
    })
  const remove = () => {
    if (!confirm(`Delete ${file!.path}?`)) return
    run(async () => {
      await api('DELETE', url(file!.path))
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

  return (
    <div className="files-tab">
      <div className="files-bar">
        <div className="segmented" role="group" aria-label="View">
          <button className={view === 'files' ? 'active' : ''} aria-pressed={view === 'files'} onClick={() => setView('files')}>Files</button>
          <button className={view === 'history' ? 'active' : ''} aria-pressed={view === 'history'} onClick={() => setView('history')}>History</button>
        </div>
        <span className="grow" />
        {view === 'files' && (
          <>
            <button className="ghost" onClick={() => setAdding(adding === null ? 'memory/' : null)}><Icon name="plus" size={14} /> New file</button>
            <button className="ghost" onClick={() => picker.current?.click()}><Icon name="upload" size={14} /> Upload</button>
            <input ref={picker} type="file" multiple hidden onChange={(e) => (upload(e.target.files), (e.target.value = ''))} />
          </>
        )}
      </div>
      {note}
      {view === 'history' ? (
        <History bot={bot} version={version} />
      ) : (
        <div className={`files ${open ? 'has-open' : ''}`}>
          <div className="file-list">
            {adding !== null && (
              <form className="new-file" onSubmit={(e) => (e.preventDefault(), create())}>
                <input autoFocus aria-label="Path of the new file" value={adding} spellCheck={false} autoCapitalize="off" onChange={(e) => setAdding(e.target.value)} />
                <button className="primary">Create</button>
              </form>
            )}
            {entries?.map((entry) => {
              const depth = entry.path.split('/').length - 1
              const name = entry.path.split('/').pop()
              const style = { paddingLeft: 8 + depth * 14 }
              return entry.dir ? (
                <div key={entry.path} className="file-row dir" style={style}><Icon name="folder" size={14} /><span className="title">{name}</span></div>
              ) : (
                <button key={entry.path} className={`file-row ${entry.path === open ? 'active' : ''}`} style={style} aria-current={entry.path === open} onClick={() => select(entry.path)}>
                  <Icon name="file" size={14} /><span className="title">{name}</span>
                </button>
              )
            })}
            {!entries && <p className="muted">Loading…</p>}
          </div>
          <div className="file-view">
            {file ? (
              <>
                <div className="file-head">
                  <button className="icon file-back" aria-label="Back to the file list" onClick={() => select(null)}><Icon name="back" /></button>
                  <span className="grow title mono">{file.path}</span>
                  <button className="ghost" title="Download" aria-label="Download" onClick={() => run(() => download(`${url(file.path)}&download=1`, name(file.path)))}><Icon name="download" size={14} /></button>
                  <button className="icon" title="Delete" aria-label="Delete this file" onClick={remove}><Icon name="trash" size={14} /></button>
                  {!file.binary && <button className="primary" disabled={!dirty} onClick={save}>{dirty ? 'Save' : 'Saved'}</button>}
                </div>
                {file.path === 'AGENTS.md' && (
                  <p className="faint">
                    The bot’s own instructions, loaded into every conversation. It keeps this file up to date itself; you can edit it too.
                    {draft.length > limit && <span className="err"> It is {draft.length.toLocaleString()} characters long; only the first {limit.toLocaleString()} are loaded.</span>}
                  </p>
                )}
                {file.binary ? (
                  <p className="muted">This file cannot be shown here ({Math.max(1, Math.round(file.size / 1024)).toLocaleString()} KB). Download it to open it.</p>
                ) : (
                  <textarea className="editor" aria-label={`Contents of ${file.path}`} value={draft} spellCheck={false} onChange={(e) => setDraft(e.target.value)} />
                )}
              </>
            ) : (
              <p className="muted file-empty">{open ? 'Loading…' : 'Choose a file to read or edit it.'}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const AUTHOR = { bot: 'Bot', you: 'You', system: 'Open Bot' } as const

/** A change as git reports it, reduced to file names and added, removed and unchanged lines. */
function Diff({ text }: { text: string }) {
  const rows: { kind: 'file' | 'gap' | 'add' | 'del' | 'same'; text: string }[] = []
  for (const line of text.split('\n')) {
    const file = line.match(/^diff --git a\/.* b\/(.*)$/)
    if (file) rows.push({ kind: 'file', text: file[1] })
    else if (line.startsWith('@@')) rows.at(-1)?.kind !== 'file' && rows.push({ kind: 'gap', text: '⋯' })
    else if (/^(index |--- |\+\+\+ |new file|deleted file|similarity|rename |\\ No newline)/.test(line)) continue
    else if (line.startsWith('+')) rows.push({ kind: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) rows.push({ kind: 'del', text: line.slice(1) })
    else if (line.startsWith(' ')) rows.push({ kind: 'same', text: line.slice(1) })
  }
  const sign = { add: '+', del: '−', same: ' ', file: '', gap: '' }
  return (
    <pre className="diff">
      {rows.map((row, i) => (
        <span key={i} className={row.kind}>
          {row.kind !== 'file' && row.kind !== 'gap' && <span className="sign">{sign[row.kind]}</span>}
          {row.text + '\n'}
        </span>
      ))}
    </pre>
  )
}

function History({ bot, version }: { bot: Bot; version: number }) {
  const [data, setData] = useState<{ available: boolean; entries: HistoryEntry[]; problem?: string } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let current = true
    api<{ available: boolean; entries: HistoryEntry[]; problem?: string }>('GET', `/api/bots/${bot.id}/history`).then((d) => current && setData(d)).catch((e) => current && setError(e.message))
    return () => {
      current = false
    }
  }, [bot.id, version])

  const toggle = (id: string) => {
    setDiff(null)
    setError('')
    if (openId === id) return setOpenId(null)
    setOpenId(id)
    api<{ diff: string }>('GET', `/api/bots/${bot.id}/history/${id}`).then((d) => setDiff(d.diff)).catch((e) => setError(e.message))
  }
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

  if (!data) return <p className="muted pad">{error || 'Loading…'}</p>
  if (!data.available) return <p className="muted pad">History needs git, which was not found on this computer. Install git and restart Open Bot to record changes.</p>
  return (
    <div className="history">
      {error && <div className="notice error">{error}</div>}
      {data.problem && <div className="notice error">Changes are not being recorded right now: {data.problem}</div>}
      {data.entries.map((entry) => (
        <div key={entry.id} className="change">
          <button className="change-head" aria-expanded={openId === entry.id} onClick={() => toggle(entry.id)}>
            <span className={`pill ${entry.author === 'bot' ? 'warn' : ''}`}>{AUTHOR[entry.author]}</span>
            <span className="grow title">{entry.message}</span>
            <span className="time">{ago(entry.time)}</span>
          </button>
          {openId === entry.id && (
            <div className="change-body">
              {diff === null ? <p className="muted">Loading…</p> : <Diff text={diff} />}
              {entry.author !== 'system' && <button onClick={() => undo(entry)}><Icon name="undo" size={14} /> Undo this change</button>}
            </div>
          )}
        </div>
      ))}
      {!data.entries.length && <p className="muted pad">Nothing has changed yet.</p>}
      <p className="faint pad">Changes to AGENTS.md and memory are recorded here. Working files under files/ are not.</p>
    </div>
  )
}
