// The settings: a full-window view with its sections down the left and one page of settings on the
// right. App-wide settings are kept by the environment; settings marked "this device" stay in the app.
import { type ReactNode, useEffect, useState } from 'react'
import type { Bot, PairedComputer, ProviderInfo, Settings } from '@openkumi/shared'
import type { EnvironmentReport, EnvironmentStatus, LocalEnvironment, RemoteEnvironment } from '@openkumi/shared/desktop'
import qrcode from 'qrcode-generator'
import { type Answer, KIND_NAMES, kindOf, ordered } from '@openkumi/client/addresses'
import { windowCount } from '@openkumi/client/browser'
import { pairingLink } from '@openkumi/client/pair'
import { BotPage, TABS } from './BotPage'
import { Principles } from './Principles'
import { Providers } from './Providers'
import { desktop, reason, useDesktop } from './desktop'
import { Icon } from './Icon'
import { PREF_DEFAULTS, type Prefs, setPrefs, usePrefs } from './prefs'
import { CopyButton, Field, Page, Pick, Row, Section, Switch, onServer, pointAt, usePref, useSetting } from './settingsUi'
import { api, closeSettings, openSettings, saveSettings, useStore } from './store'
import { SuperpowerList, SuperpowerPage } from './Superpowers'
import { BotHead } from './Mascot'

type PageId = 'general' | 'appearance' | 'chat' | 'providers' | 'bots' | 'superpowers' | 'principles' | 'browser' | 'environments' | 'advanced' | 'about'
type IconName = Parameters<typeof Icon>[0]['name']

const PAGES: Record<PageId, { label: string; icon: IconName }> = {
  general: { label: 'General', icon: 'sliders' },
  appearance: { label: 'Appearance', icon: 'sun' },
  chat: { label: 'Chat', icon: 'message' },
  providers: { label: 'Providers', icon: 'cpu' },
  bots: { label: 'Bots', icon: 'bot' },
  superpowers: { label: 'Superpowers', icon: 'sparkles' },
  principles: { label: 'Principles', icon: 'compass' },
  browser: { label: 'Browser', icon: 'globe' },
  environments: { label: 'Environments', icon: 'monitor' },
  advanced: { label: 'Advanced', icon: 'wrench' },
  about: { label: 'About', icon: 'info' },
}

const NAV: { heading: string | null; pages: PageId[] }[] = [
  { heading: null, pages: ['general', 'appearance', 'chat'] },
  { heading: 'Agents', pages: ['providers', 'bots', 'superpowers', 'principles', 'browser'] },
  { heading: 'Network', pages: ['environments'] },
  { heading: null, pages: ['advanced', 'about'] },
]

/** Every setting the search can find: the page it is on, the row to bring into view, and what it is called. */
const SEARCH: { page: PageId; id: string; title: string; also?: string; sub?: string }[] = [
  { page: 'general', id: 'default-provider', title: 'New bots run on', also: 'default provider model' },
  { page: 'general', id: 'default-web-search', title: 'Web search for new bots' },
  { page: 'general', id: 'default-show-browser', title: 'Show the browser window for new bots', also: 'headless' },
  { page: 'general', id: 'confirm-delete', title: 'Confirm before deleting a conversation', also: 'chat' },
  { page: 'appearance', id: 'theme', title: 'Theme', also: 'dark light mode' },
  { page: 'appearance', id: 'text-size', title: 'Message text size', also: 'font' },
  { page: 'appearance', id: 'wide', title: 'Wide conversation', also: 'width' },
  { page: 'chat', id: 'enter-sends', title: 'Enter sends the message', also: 'keyboard shortcut newline' },
  { page: 'chat', id: 'suggestions', title: 'Suggestions in a new chat' },
  { page: 'chat', id: 'expand-steps', title: 'Show the details of each step', also: 'tool calls thoughts activity' },
  { page: 'providers', id: 'provider-codex', sub: 'codex', title: 'Codex', also: 'openai chatgpt plan program path sign in' },
  { page: 'providers', id: 'provider-grok', sub: 'grok', title: 'Grok', also: 'xai grok build plan program path sign in' },
  { page: 'providers', id: 'provider-local', sub: 'local', title: 'Local models', also: 'ollama lm studio offline private free' },
  { page: 'providers', id: 'provider-claude-code', sub: 'claude-code', title: 'Claude Code', also: 'anthropic claude plan program path sign in' },
  { page: 'providers', id: 'provider-openai-compatible', sub: 'openai-compatible', title: 'Other models', also: 'api key base url ollama openrouter' },
  { page: 'bots', id: 'bots', title: 'Bots', also: 'rules model delete new bot' },
  { page: 'principles', id: 'principles', title: 'Principles for every bot', also: 'master prompt system instructions behaviour behavior rules all bots' },
  { page: 'principles', id: 'team', title: 'What each bot is for', also: 'description team hand over handoff delegate other bots' },
  { page: 'principles', id: 'told', title: 'What a bot is told', also: 'system prompt instructions preview read' },
  { page: 'browser', id: 'browser-program', title: 'Browser program', also: 'chrome edge chromium' },
  { page: 'browser', id: 'browser-panel', title: 'Open the panel when a bot starts browsing' },
  { page: 'browser', id: 'browsers-running', title: 'Browsers running now', also: 'stop' },
  { page: 'superpowers', id: 'superpowers', title: 'Superpowers', also: 'plugins apps tools notion linear atlassian jira confluence todoist granola otter readwise typefully sign in' },
  { page: 'environments', id: 'local-environment', title: 'Local environment', also: 'run on this computer server' },
  { page: 'environments', id: 'remote-environments', title: 'Remote environments', also: 'add another computer connect server lan' },
  { page: 'environments', id: 'lan', title: 'Let other computers connect', also: 'lan remote network access sharing' },
  { page: 'environments', id: 'pair', title: 'Pair a computer', also: 'code link token access connect' },
  { page: 'environments', id: 'paired-computers', title: 'Paired computers', also: 'remove revoke devices access' },
  { page: 'advanced', id: 'max-steps', title: 'Steps per turn', also: 'limit' },
  { page: 'advanced', id: 'max-subagents', title: 'Subagents at once', also: 'limit parallel' },
  { page: 'advanced', id: 'max-depth', title: 'Subagent levels', also: 'depth nested' },
  { page: 'advanced', id: 'instructions-limit', title: 'Size of a bot’s own instructions', also: 'agents.md limit' },
  { page: 'advanced', id: 'history-limit', title: 'Length of a conversation', also: 'context window summary tokens history' },
  { page: 'advanced', id: 'debug-engines', title: 'Log what the engines print', also: 'debug troubleshooting' },
  { page: 'advanced', id: 'data-folder', title: 'Data folder', also: 'files location' },
  { page: 'advanced', id: 'delete-chats', title: 'Delete all conversations', also: 'chats history' },
  { page: 'about', id: 'version', title: 'Version' },
]

/** The settings each page's "Restore defaults" puts back. */
const RESTORE: Partial<Record<PageId, { settings?: (keyof Settings)[]; prefs?: (keyof Prefs)[] }>> = {
  general: { settings: ['defaultProvider', 'defaultWebSearch', 'defaultShowBrowser'], prefs: ['confirmDelete'] },
  appearance: { prefs: ['theme', 'textSize', 'wide'] },
  chat: { prefs: ['enterSends', 'suggestions', 'expandSteps'] },
  browser: { settings: ['browserChannel'], prefs: ['autoOpenBrowser'] },
  advanced: { settings: ['maxSteps', 'maxSubagents', 'maxDepth', 'instructionsLimit', 'historyLimit', 'debugEngines'] },
}

function RestoreDefaults({ page }: { page: PageId }) {
  const settings = useStore((s) => s.settings)
  const defaults = useStore((s) => s.defaults)
  const prefs = usePrefs()
  const keys = RESTORE[page]
  if (!keys) return null
  const changedSettings = (keys.settings ?? []).filter((k) => JSON.stringify(settings[k]) !== JSON.stringify(defaults[k]))
  const changedPrefs = (keys.prefs ?? []).filter((k) => prefs[k] !== PREF_DEFAULTS[k])
  const restore = () => {
    if (changedSettings.length) void saveSettings(Object.fromEntries(changedSettings.map((k) => [k, defaults[k]]))).catch((e) => alert(e.message))
    if (changedPrefs.length) setPrefs(Object.fromEntries(changedPrefs.map((k) => [k, PREF_DEFAULTS[k]])))
  }
  return (
    <button className="ghost set-restore" disabled={!changedSettings.length && !changedPrefs.length} onClick={restore}>
      <Icon name="undo" size={14} /> <span>Restore defaults</span>
    </button>
  )
}

function Nav({ page }: { page: PageId }) {
  const [query, setQuery] = useState('')
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const results = words.length ? SEARCH.filter((s) => words.every((w) => `${s.title} ${s.also ?? ''} ${PAGES[s.page].label}`.toLowerCase().includes(w))) : null
  const go = (result: (typeof SEARCH)[number]) => {
    pointAt(result.id)
    setQuery('')
    // Some settings are on a part of their page that has an address of its own, such as one provider.
    openSettings(result.page, ...(result.sub ? [result.sub] : []))
    // The page may already be showing, in which case its rows do not mount again.
    requestAnimationFrame(() => {
      const row = document.getElementById(result.id)
      row?.scrollIntoView({ block: 'center' })
      row?.classList.add('found')
      pointAt(null)
    })
  }
  return (
    <nav className="set-nav" aria-label="Settings sections">
      <label className="set-search">
        <Icon name="search" size={15} />
        <input
          type="text"
          value={query}
          placeholder="Search"
          aria-label="Search settings"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results?.[0]) go(results[0])
            // Escape clears the search first; a second press closes the settings.
            if (e.key === 'Escape' && query) (e.stopPropagation(), setQuery(''))
          }}
        />
      </label>
      {results ? (
        <div className="set-results">
          {results.map((r) => (
            <button key={r.id} className="set-nav-item" onClick={() => go(r)}>
              <span className="grow">{r.title}</span>
              <span className="faint">{PAGES[r.page].label}</span>
            </button>
          ))}
          {!results.length && <p className="faint">No settings match.</p>}
        </div>
      ) : (
        NAV.map((group, i) => (
          <div key={group.heading ?? i} className="set-nav-group" role="group" aria-label={group.heading ?? undefined}>
            {group.heading && <h3 aria-hidden>{group.heading}</h3>}
            {group.pages.map((id) => (
              <a key={id} className={`set-nav-item ${id === page ? 'active' : ''}`} href={`#/settings/${id}`} aria-current={id === page ? 'page' : undefined} title={PAGES[id].label}>
                <Icon name={PAGES[id].icon} size={16} />
                <span>{PAGES[id].label}</span>
              </a>
            ))}
          </div>
        ))
      )}
    </nav>
  )
}

export function SettingsView({ path, newBot }: { path: string[]; newBot: () => void }) {
  const page: PageId = path[0] in PAGES ? (path[0] as PageId) : 'general'
  const bots = useStore((s) => s.bots)
  const bot = page === 'bots' && path[1] ? bots.find((b) => b.id === path[1]) : undefined
  const power = useStore((s) => (page === 'superpowers' && path[1] ? s.superpowers.find((p) => p.id === path[1]) : undefined))

  // Escape closes the settings, unless a dialog on top of them is open (it closes itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.backdrop')) closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="set-view" role="dialog" aria-modal="true" aria-label="Settings">
      <Nav page={page} />
      <div className="set-main">
        <header className="set-head">
          <nav className="crumbs" aria-label="Breadcrumb">
            <span className="crumb-root">Settings</span>
            <Icon name="chevron" size={12} />
            {bot || power ? <a href={`#/settings/${page}`}>{PAGES[page].label}</a> : <span aria-current="page">{PAGES[page].label}</span>}
            {(bot || power) && (
              <>
                <Icon name="chevron" size={12} />
                <span aria-current="page">{bot ? `${bot.emoji} ${bot.name}` : power!.name}</span>
              </>
            )}
          </nav>
          <span className="grow" />
          {!bot && <RestoreDefaults page={page} />}
          <button className="icon" title="Close" aria-label="Close settings" onClick={closeSettings}><Icon name="x" /></button>
        </header>
        {/* Keyed by page so each one starts scrolled to the top. */}
        <div className="set-body" key={bot ? `bot:${bot.id}` : power ? `superpower:${power.id}` : page}>
          {page === 'general' && <General />}
          {page === 'appearance' && <Appearance />}
          {page === 'chat' && <ChatPage />}
          {page === 'providers' && <Providers selected={path[1]} />}
          {page === 'principles' && <Principles />}
          {page === 'bots' && (path[1] ? <BotPage botId={path[1]} tab={TABS.find(([tab]) => tab === path[2])?.[0] ?? 'bot'} file={path.slice(3).join('/') || undefined} /> : <Bots newBot={newBot} />)}
          {page === 'superpowers' && (path[1] ? <SuperpowerPage id={path[1]} /> : <SuperpowerList />)}
          {page === 'browser' && <BrowserPage />}
          {page === 'environments' && <Environments />}
          {page === 'advanced' && <Advanced />}
          {page === 'about' && <AboutPage />}
        </div>
      </div>
    </div>
  )
}

const DeviceNote = () => <p className="set-intro">These apply to this device only.</p>

// ---- General

function General() {
  const providers = useStore((s) => s.providers)
  const runsOn = useSetting('defaultProvider')
  const webSearch = useSetting('defaultWebSearch')
  const showBrowser = useSetting('defaultShowBrowser')
  const confirmDelete = usePref('confirmDelete')
  const usable = providers.filter((p) => (p.connected && p.enabled !== false) || p.id === runsOn.value)
  return (
    <Page>
      <Section title="New bots">
        <Row
          id="default-provider"
          title="Run on"
          description="What a new bot runs on. You can change it for each bot afterwards."
          reset={runsOn.reset}
          control={<Pick label="New bots run on" value={runsOn.value} options={[['', 'The first one connected'], ...usable.map((p) => [p.id, p.name] as const)]} onChange={runsOn.set} />}
        />
        <Row id="default-web-search" title="Web search" description="New bots may use the model’s built-in web search." reset={webSearch.reset} control={<Switch label="Web search for new bots" checked={webSearch.value} onChange={webSearch.set} />} />
        <Row
          id="default-show-browser"
          title="Show the browser window"
          description="New bots open their browser on this computer’s desktop as well as in the app."
          reset={showBrowser.reset}
          control={<Switch label="Show the browser window for new bots" checked={showBrowser.value} onChange={showBrowser.set} />}
        />
      </Section>
      <Section title="Confirmations">
        <Row id="confirm-delete" title="Confirm before deleting a conversation" description="Asked when you delete one of a bot’s earlier conversations. This device only." reset={confirmDelete.reset} control={<Switch label="Confirm before deleting a conversation" checked={confirmDelete.value} onChange={confirmDelete.set} />} />
      </Section>
    </Page>
  )
}

// ---- Appearance

function Appearance() {
  const theme = usePref('theme')
  const textSize = usePref('textSize')
  const wide = usePref('wide')
  return (
    <Page>
      <DeviceNote />
      <Section title="Theme">
        <Row id="theme" title="Theme" description="Follow the system setting, or always use one." reset={theme.reset} control={<Pick label="Theme" value={theme.value} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} onChange={theme.set} />} />
      </Section>
      <Section title="Conversation">
        <Row id="text-size" title="Message text size" reset={textSize.reset} control={<Pick label="Message text size" value={textSize.value} options={[['small', 'Small'], ['default', 'Default'], ['large', 'Large']]} onChange={textSize.set} />} />
        <Row id="wide" title="Wide conversation" description="Let messages use more of a wide window." reset={wide.reset} control={<Switch label="Wide conversation" checked={wide.value} onChange={wide.set} />} />
      </Section>
    </Page>
  )
}

// ---- Chat

function ChatPage() {
  const enterSends = usePref('enterSends')
  const suggestions = usePref('suggestions')
  const expandSteps = usePref('expandSteps')
  return (
    <Page>
      <DeviceNote />
      <Section title="Composer">
        <Row
          id="enter-sends"
          title="Enter sends the message"
          description="When off, Enter starts a new line and ⌘ or Ctrl with Enter sends."
          reset={enterSends.reset}
          control={<Switch label="Enter sends the message" checked={enterSends.value} onChange={enterSends.set} />}
        />
        <Row id="suggestions" title="Suggestions in a new chat" description="Offer a few example messages when a chat is empty." reset={suggestions.reset} control={<Switch label="Suggestions in a new chat" checked={suggestions.value} onChange={suggestions.set} />} />
      </Section>
      <Section title="Activity">
        <Row
          id="expand-steps"
          title="Show the details of each step"
          description="Open tool calls and thoughts as they appear, instead of one line each."
          reset={expandSteps.reset}
          control={<Switch label="Show the details of each step" checked={expandSteps.value} onChange={expandSteps.set} />}
        />
      </Section>
    </Page>
  )
}

// ---- Providers

// ---- Bots

function Bots({ newBot }: { newBot: () => void }) {
  const bots = useStore((s) => s.bots)
  const providers = useStore((s) => s.providers)
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`
  return (
    <Page>
      <p className="set-intro">Each bot is a folder with its own instructions, memory, files and browser. Open one to change its rules, model and superpowers. What all of them are told is under <a href="#/settings/principles">Principles</a>.</p>
      <Section title="Bots" action={<button onClick={newBot}><Icon name="plus" size={14} /> New bot</button>}>
        {bots.map((bot: Bot) => (
          <a key={bot.id} className="set-row set-link" id={bot.id === bots[0]?.id ? 'bots' : undefined} href={`#/settings/bots/${encodeURIComponent(bot.id)}`}>
            <div className="set-row-main">
              <BotHead bot={bot} />
              <div className="set-row-text">
                <h3>{bot.name}{bot.id === bots[0]?.id && <span className="pill" title="The first bot. It can schedule, change and delete tasks for every bot.">Main assistant</span>}</h3>
                {bot.description && <p>{bot.description}</p>}
                <p>Runs on {providers.find((p) => p.id === bot.provider)?.name ?? bot.provider} · {count(bot.superpowers.length, 'superpower')}</p>
              </div>
              <Icon name="chevron" size={14} />
            </div>
          </a>
        ))}
        {!bots.length && <Row title="No bots yet" description="Create one to get started." />}
      </Section>
    </Page>
  )
}

// ---- Browser

function BrowserPage() {
  const program = useSetting('browserChannel')
  const autoOpen = usePref('autoOpenBrowser')
  const bots = useStore((s) => s.bots)
  const browsers = useStore((s) => s.browsers)
  const running = bots.filter((b) => browsers[b.id]?.running)
  return (
    <Page>
      <Section title="Browser">
        <Row
          id="browser-program"
          title="Program"
          description="Which browser the bots use. Every bot keeps its own profile and logins. Takes effect the next time a bot’s browser starts."
          reset={program.reset}
          control={<Pick label="Browser program" value={program.value} options={[['chrome', 'Google Chrome'], ['msedge', 'Microsoft Edge'], ['chromium', 'Chromium (comes with OpenKumi)']]} onChange={program.set} />}
        />
        <Row
          id="browser-panel"
          title="Show the browser when a bot starts browsing"
          description="A small live view of the window the bot is using floats over the chat, from where it can go beside the chat or fill the window. A window where the bot asks for your help is always shown. This device only."
          reset={autoOpen.reset}
          control={<Switch label="Show the browser when a bot starts browsing" checked={autoOpen.value} onChange={autoOpen.set} />}
        />
      </Section>
      <Section title="Running now">
        {running.map((bot, i) => (
          <Row
            key={bot.id}
            id={i === 0 ? 'browsers-running' : undefined}
            title={<><BotHead bot={bot} />{bot.name}</>}
            description={`${windowCount(browsers[bot.id])} open${browsers[bot.id].headless ? ', out of sight' : ', also on the desktop'}.`}
            control={<button onClick={() => api('POST', `/api/bots/${bot.id}/browser/stop`).catch((e) => alert(e.message))}>Stop</button>}
          />
        ))}
        {!running.length && <Row id="browsers-running" title="No browser is running" description="A bot’s browser starts when the bot needs it, or when you open its panel." />}
      </Section>
    </Page>
  )
}

// ---- Environments: where bots run. The local environment and the remote ones, and how the
// environment being shown lets the app on other computers in.

const REMOTE_STATUS: Record<EnvironmentStatus, string> = { connected: 'Connected', unreachable: 'Not reachable', refused: 'No longer lets this computer in', outdated: 'Needs a newer OpenKumi', off: 'Turned off' }
const ANSWERS: Record<Answer, string> = { ok: 'Answers', refused: 'No longer lets this computer in', other: 'Something else answers', outdated: 'Needs a newer OpenKumi', unreachable: 'Not reachable from here', blocked: 'Needs https' }
/** An address as it is shown: without the http:// that most of them start with. */
const shown = (url: string) => url.replace(/^http:\/\//, '')
const LOCAL_STATE: Record<LocalEnvironment['state'], string> = {
  off: 'Turned off. Bots only run in remote environments.',
  starting: 'Starting OpenKumi on this computer…',
  running: 'OpenKumi runs on this computer.',
  failed: 'OpenKumi could not start on this computer.',
}

function Environments() {
  const loaded = useStore((s) => s.loaded)
  return (
    <Page>
      <EnvironmentList />
      {loaded && <Sharing />}
    </Page>
  )
}

/** The local environment and the remote ones. Part of the settings, and what the window shows while there is nothing to connect to. */
export function EnvironmentList() {
  const app = useDesktop()
  const inUse = useStore((s) => s.address)
  const [statuses, setStatuses] = useState<Record<string, EnvironmentReport>>({})
  const [adding, setAdding] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  /** The environment whose addresses are open below it. */
  const [opened, setOpened] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // Whether each remote environment answers: asked when the page opens and when the list changes.
  const listed = JSON.stringify(app.environments)
  useEffect(() => {
    let current = true
    desktop.statuses().then((found) => current && setStatuses(found)).catch(() => {})
    return () => void (current = false)
  }, [listed])

  /** Asks the app to change something. True when it worked. */
  const change = async (fn: () => Promise<void>) => {
    setError('')
    setBusy(true)
    try {
      await fn()
      return true
    } catch (e) {
      setError(reason(e))
      return false
    } finally {
      setBusy(false)
    }
  }

  const { local } = app
  const showing = (id: string) => app.current === id && <span className="pill good">Showing now</span>
  return (
    <>
      {error && <div className="notice error">{error}</div>}
      <Section title="This app">
        <Row
          id="local-environment"
          title={<>Local environment{showing('local')}</>}
          description={LOCAL_STATE[local.state]}
          status={local.state === 'failed' ? local.error : local.state === 'running' && !local.startedHere ? 'It was started outside this app, so it keeps running when the app quits.' : undefined}
          control={
            <>
              {local.state === 'failed' && <button disabled={busy} onClick={() => change(() => desktop.retry())}>Try again</button>}
              {local.enabled && app.current !== 'local' && <button onClick={() => change(() => desktop.open('local'))}>Open</button>}
              <Switch label="Local environment" checked={local.enabled} disabled={busy} onChange={(on) => change(() => desktop.setLocal(on))} />
            </>
          }
        />
      </Section>

      <Section title="Environments" action={<button className="ghost" onClick={() => setAdding(!adding)}><Icon name="plus" size={14} /> Add environment</button>}>
        {/* The form stays open when the link was not accepted, so it can be corrected. */}
        {adding && <AddEnvironment add={(input) => change(() => desktop.add(input)).then((added) => added && setAdding(false))} busy={busy} />}
        {app.environments.map((environment, i) => {
          const report = statuses[environment.id]
          // The address the window uses, for the one it shows; for the others, the one it would use.
          const via = app.current === environment.id ? inUse : ordered(environment.addresses).find((url) => report?.addresses[url] === 'ok')
          const count = environment.addresses.length
          return (
            <Row
              key={environment.id}
              id={i === 0 ? 'remote-environments' : undefined}
              title={
                renaming === environment.id ? (
                  <Field label="Name" value={environment.name} onCommit={(name) => change(() => desktop.update(environment.id, { name })).then(() => setRenaming(null))} />
                ) : (
                  <><Icon name="monitor" size={15} />{environment.name}{showing(environment.id)}</>
                )
              }
              description={
                <>
                  {!environment.enabled ? REMOTE_STATUS.off : report ? REMOTE_STATUS[report.status] : 'Checking…'}
                  {environment.enabled && via && <> · via {KIND_NAMES[kindOf(via)]} · <span className="mono">{shown(via)}</span></>}
                </>
              }
              control={
                <>
                  <button className="ghost" aria-expanded={opened === environment.id} onClick={() => setOpened(opened === environment.id ? null : environment.id)}>
                    {count === 1 ? '1 address' : `${count} addresses`}
                  </button>
                  {environment.enabled && app.current !== environment.id && <button onClick={() => change(() => desktop.open(environment.id))}>Open</button>}
                  <Switch label={`Use ${environment.name}`} checked={environment.enabled} disabled={busy} onChange={(enabled) => change(() => desktop.update(environment.id, { enabled }))} />
                  <details className="set-menu">
                    <summary className="icon" title="More" aria-label={`More for ${environment.name}`}><Icon name="more" /></summary>
                    <div className="set-menu-items">
                      <button onClick={(e) => (e.currentTarget.closest('details')!.removeAttribute('open'), setRenaming(environment.id))}>Rename</button>
                      <button className="danger" onClick={() => change(() => desktop.remove(environment.id))}>Remove</button>
                    </div>
                  </details>
                </>
              }
            >
              {opened === environment.id && <Addresses environment={environment} report={report} inUse={via ?? null} busy={busy} change={change} />}
            </Row>
          )
        })}
        {!app.environments.length && !adding && <Row id="remote-environments" title="No remote environments" description="Add one to work with OpenKumi running on another computer on your network." />}
      </Section>
    </>
  )
}

/**
 * Where a remote environment can be reached, tried from the top: its home network, then Tailscale,
 * then any put in by hand. The ones it reports itself are kept up to date by themselves.
 */
function Addresses({ environment, report, inUse, busy, change }: { environment: RemoteEnvironment; report?: EnvironmentReport; inUse: string | null; busy: boolean; change: (fn: () => Promise<void>) => Promise<boolean> }) {
  const [address, setAddress] = useState('')
  const [note, setNote] = useState('')
  const add = async () => {
    setNote('')
    let checked = true
    const added = await change(async () => {
      checked = (await desktop.addAddress(environment.id, address)).checked
    })
    if (!added) return
    setAddress('')
    if (!checked) setNote(`Added. Nothing answers there right now: it is sent this computer’s key only once it has shown it is ${environment.name}.`)
  }
  return (
    <div className="set-below set-links set-addresses">
      {ordered(environment.addresses).map((url) => {
        const found = environment.addresses.find((a) => a.url === url)?.found
        const answer = report?.addresses[url]
        return (
          <div key={url} className="set-link-row">
            <span className="faint">{KIND_NAMES[kindOf(url)]}</span>
            <code>{shown(url)}</code>
            <span className="faint address-state">{[url === inUse ? 'In use' : answer && ANSWERS[answer], found && 'reported by it'].filter(Boolean).join(' · ')}</span>
            {!found && environment.addresses.length > 1 && <button className="ghost danger" disabled={busy} onClick={() => change(() => desktop.removeAddress(environment.id, url))}>Remove</button>}
          </div>
        )
      })}
      <div className="set-link-row">
        <input className="set-input wide" spellCheck={false} autoCapitalize="off" aria-label={`Another address for ${environment.name}`} value={address} placeholder="mac-mini.tail1234.ts.net:4317, or an https address" onChange={(e) => setAddress(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && address.trim() && void add()} />
        <button disabled={busy || !address.trim()} onClick={() => void add()}>Add address</button>
      </div>
      {note && <p className="faint">{note}</p>}
      <p className="faint">This computer’s key goes to an address only after whatever answers there has shown it is {environment.name}. Plain http works on the home network and over Tailscale; anywhere else the address needs https.</p>
    </div>
  )
}

function AddEnvironment({ add, busy }: { add: (input: { address: string; code: string; name: string }) => void; busy: boolean }) {
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const plain = { spellCheck: false, autoCapitalize: 'off', className: 'set-input wide' } as const
  return (
    <>
      <Row
        title="Address of the other computer"
        description="On that computer, open Settings, go to Environments, switch on “Let other computers connect” and choose “Pair a computer”. It shows its address and a code."
        control={<input {...plain} autoFocus aria-label="Address of the other computer" value={address} placeholder="192.168.1.20:4317" onChange={(e) => setAddress(e.target.value)} />}
      />
      <Row title="Pairing code" description="Works once, for ten minutes. It is checked on both computers and never sent between them." control={<input {...plain} aria-label="Pairing code" value={code} placeholder="ABCD-EFGH-JKMN" onChange={(e) => setCode(e.target.value)} />} />
      <Row title="Name" description="What to call it here." control={<input {...plain} aria-label="Name" value={name} placeholder="Optional, such as “Mac mini”" onChange={(e) => setName(e.target.value)} />} />
      <Row title="" control={<button className="primary" disabled={busy || !address.trim() || !code.trim()} onClick={() => add({ address, code, name })}>{busy ? 'Pairing…' : 'Pair and add'}</button>} />
    </>
  )
}

/** A QR code, drawn as squares, dark on light whatever the app's colours, so a camera can always read it. */
function Qr({ text }: { text: string }) {
  const code = qrcode(0, 'M')
  code.addData(text)
  code.make()
  const size = code.getModuleCount()
  const squares = []
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (code.isDark(y, x)) squares.push(`M${x + 2} ${y + 2}h1v1h-1z`)
  return (
    <svg className="qr" viewBox={`0 0 ${size + 4} ${size + 4}`} role="img" aria-label="Pairing code as a QR code">
      <rect width="100%" height="100%" fill="#fff" />
      <path d={squares.join('')} fill="#000" />
    </svg>
  )
}

interface AccessInfo {
  on: boolean
  port: number
  /** On the local network. */
  addresses: string[]
  /** Its name and address on Tailscale, when it is on it. Missing from older servers. */
  tailscale?: string[]
  computers: PairedComputer[]
}

const day = (time: number) => new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** How the environment being shown lets the app on other computers in: one at a time, each with a key of its own. */
function Sharing() {
  const lan = useSetting('lan')
  const about = useStore((s) => s.about)
  const connected = useStore((s) => s.connected)
  const [info, setInfo] = useState<AccessInfo | null>(null)
  const [pairing, setPairing] = useState<{ code: string; expiresAt: number } | null>(null)
  const [error, setError] = useState('')
  const local = !!useDesktop().connection?.local
  const on = about.lanForced || lan.value
  const load = () => api<AccessInfo>('GET', '/api/access').then(setInfo).catch((e) => setError(e.message))

  // Asked again after the server has switched over (the connection drops and comes back).
  useEffect(() => {
    if (connected) void load()
  }, [connected, lan.value])
  // While a code is waiting to be used, the list is watched for the computer that uses it.
  useEffect(() => {
    if (!pairing) return
    const known = info?.computers.length ?? 0
    const watch = setInterval(async () => {
      const now = await api<AccessInfo>('GET', '/api/access').catch(() => null)
      if (now && now.computers.length > known) (setInfo(now), setPairing(null))
      else if (Date.now() > pairing.expiresAt) setPairing(null)
    }, 2000)
    return () => clearInterval(watch)
  }, [pairing])

  const toggle = (next: boolean) => {
    if (!next && !local && !confirm('This app reaches the environment over the network, so it will lose it. Switch it off?')) return
    lan.set(next)
  }
  const run = (work: () => Promise<unknown>) => (setError(''), void work().catch((e) => setError(e.message)))
  const revoke = (computer: PairedComputer) => {
    if (!confirm(`Stop letting “${computer.name}” in? It is disconnected at once and has to be paired again to come back.`)) return
    run(async () => {
      await api('DELETE', `/api/computers/${computer.id}`)
      await load()
    })
  }

  return (
    <>
      {error && <div className="notice error">{error}</div>}
      <Section title="Sharing this environment">
        <Row
          id="lan"
          title="Let other computers connect"
          description="The OpenKumi app on your other computers and phone can use this environment once they are paired with it: on the same network, or from anywhere over Tailscale. On the local network the connection is not encrypted, so use it only on networks you trust; Tailscale encrypts it."
          status={about.lanForced ? 'OpenKumi was started with --lan, which keeps this on. Start it without that to control it here.' : undefined}
          reset={about.lanForced ? undefined : lan.reset && (() => toggle(false))}
          control={<Switch label="Let other computers connect" checked={on} disabled={about.lanForced} onChange={toggle} />}
        />
        {on && info && (
          <>
            <Row
              id="pair"
              title="Pair a computer"
              description={local ? 'Makes a code that lets one computer or phone in. In the OpenKumi app on a computer, choose Settings, Environments, “Add environment”, and enter this computer’s address and the code. On a phone, scan the picture.' : 'Computers are paired, and removed, in the app on the computer that runs this environment.'}
              control={local && <button onClick={() => run(async () => setPairing(await api('POST', '/api/pairing')))}>{pairing ? 'New code' : 'Pair a computer'}</button>}
            >
              {pairing && (
                <div className="set-below set-links">
                  <div className="set-link-row">
                    <span className="faint">Code</span>
                    <code className="pair-code">{pairing.code}</code>
                    <CopyButton text={pairing.code} />
                  </div>
                  {info.addresses.map((ip) => (
                    <div key={ip} className="set-link-row">
                      <span className="faint">Address</span>
                      <code>{ip}:{info.port}</code>
                      <CopyButton text={`${ip}:${info.port}`} />
                    </div>
                  ))}
                  {info.tailscale?.map((host) => (
                    <div key={host} className="set-link-row">
                      <span className="faint">Tailscale</span>
                      <code>{host}:{info.port}</code>
                      <CopyButton text={`${host}:${info.port}`} />
                    </div>
                  ))}
                  {!info.addresses.length && !info.tailscale?.length && <p className="faint">This computer is not connected to a network right now.</p>}
                  {info.addresses[0] && (
                    <div className="pair-qr">
                      <Qr text={pairingLink(`${info.addresses[0]}:${info.port}`, pairing.code)} />
                      <p className="faint">On a phone, open the OpenKumi app and choose “Scan the code”. It carries the address and the code, so there is nothing to type.</p>
                    </div>
                  )}
                  <p className="faint">The code works once, until {new Date(pairing.expiresAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. This closes by itself when the other computer has used it. Paired once, it learns this computer’s other addresses by itself, so it also finds it over Tailscale.</p>
                </div>
              )}
            </Row>
            {info.computers.map((computer, i) => (
              <Row
                key={computer.id}
                id={i === 0 ? 'paired-computers' : undefined}
                title={<><Icon name="monitor" size={15} />{computer.name}</>}
                description={`Paired ${day(computer.pairedAt)} · last here ${day(computer.lastSeenAt)}`}
                control={local && <button className="danger" onClick={() => revoke(computer)}>Remove</button>}
              />
            ))}
            {!info.computers.length && <Row id="paired-computers" title="No computers are paired" description="Only the app on this computer can use this environment." />}
          </>
        )}
      </Section>
    </>
  )
}

// ---- Advanced

function Advanced() {
  const maxSteps = useSetting('maxSteps')
  const maxSubagents = useSetting('maxSubagents')
  const maxDepth = useSetting('maxDepth')
  const limit = useSetting('instructionsLimit')
  const history = useSetting('historyLimit')
  const debug = useSetting('debugEngines')
  const home = useStore((s) => s.home)
  // Each bot's conversation, and the earlier ones that were set aside.
  const chats = useStore((s) => s.threads.filter((t) => !t.parentId).length)
  const number = (bind: { value: number; set: (n: number) => void }, label: string) => (
    <Field label={label} type="number" className="set-input number" value={String(bind.value)} onCommit={(v) => bind.set(Number(v))} />
  )
  const deleteChats = () => {
    if (!confirm(`Delete every conversation of every bot, ${chats} in all, the earlier ones included? Bots, their files and their memory are kept. This cannot be undone.`)) return
    api('DELETE', '/api/threads').catch((e) => alert(e.message))
  }
  return (
    <Page>
      <Section title="Limits">
        <Row id="max-steps" title="Steps per turn" description="How many times a bot may call the model in one turn before it is stopped. Each tool call takes a step." reset={maxSteps.reset} control={number(maxSteps, 'Steps per turn')} />
        <Row id="max-subagents" title="Subagents at once" description="How many subagents of one conversation may run at the same time." reset={maxSubagents.reset} control={number(maxSubagents, 'Subagents at once')} />
        <Row
          id="max-depth"
          title="Subagent levels"
          description="Whether subagents may start subagents of their own, and how deep that goes."
          reset={maxDepth.reset}
          control={<Pick label="Subagent levels" value={maxDepth.value} options={[[0, 'No subagents'], [1, 'One level'], [2, 'Two levels'], [3, 'Three levels']]} onChange={maxDepth.set} />}
        />
        <Row
          id="instructions-limit"
          title="Size of a bot’s own instructions"
          description="How many characters of a bot’s AGENTS.md are loaded into each conversation. Anything beyond is left out, and the bot is told to shorten the file."
          reset={limit.reset}
          control={number(limit, 'Characters of AGENTS.md loaded')}
        />
        <Row
          id="history-limit"
          title="Length of a conversation"
          description="How long a bot’s conversation may get, in tokens, before its older part is replaced by a summary for the bot. Lower it for a local model with a small context window. Nothing is deleted: you still see every message, and the bot can look them up. Bots on Claude Code, Codex or Grok are not affected, as those programs look after this themselves."
          reset={history.reset}
          control={number(history, 'Tokens of conversation sent to the model')}
        />
      </Section>
      <Section title="Troubleshooting">
        <Row
          id="debug-engines"
          title="Log what the engines print"
          description="Write everything those programs print to the output of the OpenKumi server, to work out why a turn went wrong."
          reset={debug.reset}
          control={<Switch label="Log what the engines print" checked={debug.value} onChange={debug.set} />}
        />
      </Section>
      <Section title="Data">
        <Row
          id="data-folder"
          title="Data folder"
          description={<>Everything OpenKumi keeps is in <code>{home}</code>: bots, conversations and these settings.</>}
          control={onServer() && <button onClick={() => api('POST', '/api/reveal', {}).catch((e) => alert(e.message))}><Icon name="folder" size={14} /> Open folder</button>}
        />
        <Row id="delete-chats" title="Delete all conversations" description="Removes what was said with every bot, the earlier conversations included. Bots, their files and their memory are kept." control={<button className="danger" disabled={!chats} onClick={deleteChats}>Delete all conversations</button>} />
      </Section>
    </Page>
  )
}

// ---- About

function AboutPage() {
  const about = useStore((s) => s.about)
  const home = useStore((s) => s.home)
  const fact = (title: string, value: ReactNode, id?: string) => <Row id={id} title={title} control={<span className="set-fact">{value}</span>} />
  return (
    <Page>
      <Section title="OpenKumi">
        {fact('Version', about.version, 'version')}
        {fact('Runs with', `Node.js ${about.node.replace(/^v/, '')} on ${about.platform}`)}
        {fact('Port', <>{about.port} <span className="faint">(set with OPENKUMI_PORT when starting OpenKumi)</span></>)}
        {fact('Data folder', <code>{home}</code>)}
        {fact('License', 'MIT')}
      </Section>
    </Page>
  )
}
