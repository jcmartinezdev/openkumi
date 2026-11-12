// Providers: what bots can run on. Every provider down the left, each with its mark, version and
// whether it is signed in, and a switch for offering it to bots at all; the one that is picked
// opens beside the list with its status, its settings, the models it reports and the bots on it.
import { useEffect, useState } from 'react'
import type { ProviderInfo, Settings } from '@openbot/shared'
import { Icon } from './Icon'
import { loadModels, useModelLists } from '@openbot/client/models'
import { ProviderIcon } from './ProviderIcon'
import { Field, Row, Switch, useSetting } from './settingsUi'
import { api, useStore } from './store'
import { BotHead } from './Mascot'

/** The setting that holds where each engine's program is. */
const PATH_KEY: Record<string, 'codexPath' | 'claudePath' | 'grokPath'> = { codex: 'codexPath', 'claude-code': 'claudePath', grok: 'grokPath' }
/** What each provider is, in a line, for the top of its page. */
const ABOUT: Record<string, string> = {
  codex: 'Runs on your ChatGPT plan, through the Codex program installed on this computer. You sign in there, not here.',
  'claude-code': 'Runs on your Claude plan, through the Claude Code program installed on this computer. You sign in there, not here.',
  grok: 'Runs on your Grok plan, through the Grok Build program installed on this computer. You sign in there, not here.',
  local: 'Models that run on the computer running Open Bot, through Ollama or LM Studio. Nothing is sent anywhere and nothing is paid for. Small models often cannot use tools well, so pick one made for tool use.',
  'openai-compatible': 'Any service that speaks the OpenAI API, such as OpenAI itself or OpenRouter, with a key of your own.',
  mock: 'Scripted replies, for testing Open Bot without a model.',
}

/** How a provider stands, in a few words: for the list and the top of its page. */
function standing(provider: ProviderInfo): string {
  if (provider.enabled === false) return 'Switched off'
  if (!provider.connected) return provider.detail
  return provider.kind === 'cli' ? `Signed in · ${provider.detail.replace(/^Signed in with /, '')}` : provider.detail
}

function ago(time: number, now: number): string {
  const minutes = Math.floor((now - time) / 60_000)
  return minutes < 1 ? 'just now' : minutes === 1 ? 'a minute ago' : minutes < 60 ? `${minutes} minutes ago` : 'over an hour ago'
}

export function Providers({ selected }: { selected?: string }) {
  const providers = useStore((s) => s.providers)
  const off = useSetting('disabledProviders')
  const [checking, setChecking] = useState(false)
  const [checkedAt, setCheckedAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const provider = providers.find((p) => p.id === selected) ?? providers[0]

  // The programs may have been installed, updated or signed in since the server last looked.
  const check = () => {
    setChecking(true)
    api('POST', '/api/providers/check')
      .then(() => setCheckedAt(Date.now()), () => {})
      .finally(() => setChecking(false))
  }
  useEffect(check, [])
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(tick)
  }, [])

  return (
    <div className="set-scroll">
      <div className="prov-page">
        <header className="prov-top">
          <h2>Providers</h2>
          <button className="ghost" disabled={checking} onClick={check}>
            <Icon name="reload" size={14} /> {checking ? 'Checking…' : checkedAt ? `Checked ${ago(checkedAt, now)}` : 'Check again'}
          </button>
        </header>
        <div className="prov">
          <nav className="prov-list" aria-label="Providers">
            {providers.map((p) => {
              const enabled = p.enabled !== false
              return (
                <div key={p.id} id={`provider-${p.id}`} className={`prov-item ${p.id === provider?.id ? 'active' : ''} ${enabled ? '' : 'off'}`}>
                  <a href={`#/settings/providers/${p.id}`} aria-current={p.id === provider?.id ? 'page' : undefined}>
                    <ProviderIcon provider={p} size={20} />
                    <span className="prov-item-text">
                      <span className="prov-name">{p.name}{p.version && <span className="prov-version">v{p.version}</span>}</span>
                      <span className={`prov-standing ${p.connected && enabled ? '' : 'dim'}`}>{standing(p)}</span>
                    </span>
                  </a>
                  <Switch label={`Use ${p.name} for bots`} checked={enabled} onChange={(on) => off.set(on ? off.value.filter((id) => id !== p.id) : [...off.value, p.id])} />
                </div>
              )
            })}
          </nav>
          {provider && <Detail key={provider.id} provider={provider} />}
        </div>
      </div>
    </div>
  )
}

function Detail({ provider }: { provider: ProviderInfo }) {
  const bots = useStore((s) => s.bots).filter((b) => b.provider === provider.id)
  const enabled = provider.enabled !== false
  const lists = useModelLists(provider.connected ? [provider.id] : [])
  const models = lists.get(provider.id)
  // The list is read again when the page opens: a model may have been added since.
  useEffect(() => {
    if (provider.connected) void loadModels(provider.id, true)
  }, [provider.id, provider.connected])

  return (
    <section className="prov-detail" aria-label={provider.name}>
      <header className="prov-head">
        <ProviderIcon provider={provider} size={26} />
        <h3>{provider.name}</h3>
        <span className="grow" />
        {provider.version && <span className="prov-version">v{provider.version}</span>}
      </header>

      <div className="prov-block">
        <h4>Status</h4>
        <p className={provider.connected && enabled ? '' : 'dim'}>
          {provider.connected && enabled && <span className="dot ok" aria-hidden />}
          {standing(provider)}
        </p>
        {!provider.connected && provider.hint && <p className="prov-hint">{provider.hint}</p>}
        {!enabled && <p className="prov-hint">It is not offered as something a bot can run on. Switch it on in the list to use it.</p>}
        <p className="faint">{ABOUT[provider.id]}</p>
      </div>

      {PATH_KEY[provider.id] && <ProgramPath provider={provider} setting={PATH_KEY[provider.id]} />}
      {provider.id === 'local' && <LocalAddress provider={provider} />}
      {provider.id === 'openai-compatible' && <Compatible provider={provider} />}

      {provider.connected && (
        <div className="prov-block">
          <h4>Models{models?.length ? <span className="faint"> · {models.length}</span> : null}</h4>
          {!models ? <p className="faint">Loading…</p> : !models.length ? <p className="faint">It lists no models.</p> : (
            <ul className="prov-models" aria-label={`Models of ${provider.name}`}>
              {models.map((model, i) => <li key={model.id} title={model.description} className={model.older ? 'older' : ''}>{model.name}{i === 0 && model.name !== 'Default' && <span className="pill">default</span>}</li>)}
            </ul>
          )}
          <p className="faint">What it reports itself. Choose one for a bot from the box where you write to it.</p>
        </div>
      )}

      <div className="prov-block">
        <h4>Bots on it</h4>
        {bots.length ? (
          <p className="prov-bots">{bots.map((bot) => <a key={bot.id} href={`#/settings/bots/${encodeURIComponent(bot.id)}`}><BotHead bot={bot} />{bot.name}</a>)}</p>
        ) : <p className="faint">No bot runs on it.</p>}
      </div>
    </section>
  )
}

function ProgramPath({ provider, setting }: { provider: ProviderInfo; setting: keyof Pick<Settings, 'codexPath' | 'claudePath' | 'grokPath'> }) {
  const path = useSetting(setting)
  return (
    <div className="prov-block">
      <h4>Program</h4>
      <Row
        title="Program path"
        description={`Where the ${provider.name} program is. Leave empty to have it found.`}
        status={provider.path ? <>Using <code>{provider.path}</code></> : undefined}
        reset={path.reset}
        control={<Field label={`Path of the ${provider.name} program`} value={path.value} placeholder="Found automatically" onCommit={path.set} />}
      />
    </div>
  )
}

function LocalAddress({ provider }: { provider: ProviderInfo }) {
  const address = useSetting('localUrl')
  return (
    <div className="prov-block">
      <h4>Where it is</h4>
      <Row
        title="Address"
        description="Ollama and LM Studio are found by themselves. Fill this in only for another program, or another port."
        status={provider.baseUrl ? <>Using <code>{provider.baseUrl}</code></> : undefined}
        reset={address.reset}
        control={<Field label="Address of the local model server" value={address.value} placeholder="Found automatically" onCommit={address.set} />}
      />
    </div>
  )
}

function Compatible({ provider }: { provider: ProviderInfo }) {
  const save = (patch: { baseUrl?: string; apiKey?: string }) => api('PUT', '/api/providers/openai-compatible', { baseUrl: provider.baseUrl ?? '', apiKey: '', ...patch })
  return (
    <div className="prov-block">
      <h4>Connection</h4>
      <Row title="Base URL" description="The address of the API. Clear it to disconnect." control={<Field label="Base URL" value={provider.baseUrl ?? ''} placeholder="https://api.openai.com/v1" onCommit={(baseUrl) => save({ baseUrl })} />} />
      <Row title="API key" description="Stored on the computer running Open Bot." control={<Field label="API key" type="password" value="" placeholder={provider.connected ? 'Saved' : 'None'} onCommit={(apiKey) => save({ apiKey })} />} />
    </div>
  )
}
