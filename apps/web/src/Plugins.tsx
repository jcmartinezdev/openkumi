// Plugins: ready-made abilities for a bot. A list to browse, a page for each plugin that says
// what it does and what it adds, and "Install", which asks which bot it is for. A plugin is
// always installed for one bot, never for all of them.
import { useEffect, useState } from 'react'
import type { Bot, ConnectionStatus, Plugin } from '@openbot/shared'
import { Markdown } from './Markdown'
import { Icon } from './Icon'
import { Dialog } from './Modals'
import { Field, Page, Row, Section, onServer } from './settingsUi'
import { api, useStore } from './store'
import { BotHead } from './Mascot'

const Tile = ({ plugin, big }: { plugin: Plugin; big?: boolean }) => (
  <span className={`plugin-tile ${big ? 'big' : ''}`} style={{ background: `color-mix(in srgb, ${plugin.color} 16%, transparent)` }} aria-hidden>{plugin.icon}</span>
)
const count = (n: number) => `Installed for ${n} ${n === 1 ? 'bot' : 'bots'}`

export function PluginList() {
  const plugins = useStore((s) => s.plugins)
  // Grouped as the plugins themselves say, in the order the groups first appear.
  const categories = [...new Set(plugins.map((p) => p.category))]
  return (
    <Page wide>
      <p className="set-intro">Ready-made abilities for your bots, such as reading your mail or your calendar. Open one to see what it does, then install it for the bot that should have it. A plugin is installed for one bot at a time.</p>
      {categories.map((category, i) => (
        <section key={category} className="set-section">
          <div className="set-section-head"><h2>{category}</h2></div>
          <div className="plugin-grid" id={i === 0 ? 'plugins' : undefined}>
            {plugins.filter((p) => p.category === category).map((plugin) => (
              <a key={plugin.id} className="plugin-card" href={`#/settings/plugins/${plugin.id}`}>
                <Tile plugin={plugin} />
                <div className="plugin-card-text">
                  <h3>{plugin.name}</h3>
                  <p>{plugin.tagline}</p>
                  {plugin.installedOn.length > 0 && <span className="pill good">{count(plugin.installedOn.length)}</span>}
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
      {!plugins.length && <p className="set-intro">There are no plugins in this version of Open Bot.</p>}
    </Page>
  )
}

/** How the plugin's connection stands for one bot, in a few words. */
function standing(plugin: Plugin, status: ConnectionStatus | undefined): string {
  if (!plugin.connection) return 'Ready'
  if (plugin.setup && !plugin.setup.done) return 'Works through the bot’s browser. Finish “Direct connection” below for the faster way.'
  if (status?.state === 'connected') return `Signed in · ${status.tools} tools`
  if (status?.state === 'needs-login') return 'Installed. Sign in to finish.'
  if (status?.state === 'error') return status.error ?? 'The connection failed.'
  return 'Connecting…'
}

export function PluginPage({ id }: { id: string }) {
  const plugin = useStore((s) => s.plugins.find((p) => p.id === id))
  const bots = useStore((s) => s.bots)
  const skills = useStore((s) => s.skills)
  const statuses = useStore((s) => s.connectionStatus)
  const [choosing, setChoosing] = useState(false)
  const [error, setError] = useState('')
  const local = onServer()
  const installed = bots.filter((b) => plugin?.installedOn.includes(b.id))
  const watched = installed.map((b) => b.id).join()

  // Nothing connects until it is needed, so opening the page asks how each bot's connection stands.
  useEffect(() => {
    for (const botId of watched ? watched.split(',') : []) api('POST', `/api/bots/${botId}/connections/check`).catch(() => {})
  }, [watched])

  if (!plugin) return <Page><p className="set-intro">There is no such plugin. <a href="#/settings/plugins">See all plugins.</a></p></Page>
  const run = (work: () => Promise<unknown>) => (setError(''), void work().catch((e) => setError(e.message)))
  const set = (bot: Bot, on: boolean) => run(() => api('PUT', `/api/bots/${bot.id}/plugins/${plugin.id}`, { on }))
  const signIn = (bot: Bot) =>
    run(async () => {
      // The sign-in page opens in the computer's own browser, where the person's accounts already are.
      const { url } = await api<{ url: string | null }>('POST', `/api/bots/${bot.id}/connections/${plugin.connection!.name}/login`)
      if (url) window.open(url)
    })

  return (
    <Page>
      <header className="plugin-head">
        <Tile plugin={plugin} big />
        <div className="plugin-head-text">
          <h1>{plugin.name}</h1>
          <p>{plugin.tagline}</p>
          <p className="faint">{plugin.category} · by {plugin.publisher}</p>
        </div>
        <button className="primary" disabled={!bots.length} onClick={() => setChoosing(true)}><Icon name="download" size={14} /> Install</button>
      </header>
      {error && <div className="notice error">{error}</div>}

      {installed.length > 0 && (
        <Section title="Installed for">
          {installed.map((bot) => {
            const status = plugin.connection ? statuses[bot.id]?.[plugin.connection.name] : undefined
            const needsSignIn = status?.state === 'needs-login'
            return (
              <Row
                key={bot.id}
                title={<><BotHead bot={bot} />{bot.name}</>}
                description={standing(plugin, status)}
                status={needsSignIn && !local ? 'Sign in from the computer that runs Open Bot.' : undefined}
                control={
                  <>
                    {needsSignIn && local && <button className="primary" onClick={() => signIn(bot)}>Sign in</button>}
                    <button className="ghost danger" onClick={() => confirm(`Remove ${plugin.name} from ${bot.name}? Its sign-in for ${plugin.name} is forgotten.`) && set(bot, false)}>Remove</button>
                  </>
                }
              />
            )
          })}
        </Section>
      )}

      {/* The page is written with lines wrapped for reading as a file; here a paragraph is one flowing piece. */}
      <section className="plugin-about"><Markdown text={plugin.description.replace(/([^\n])\n(?!\n|\s*(?:[-*>#]|\d+\.)\s)/g, '$1 ')} /></section>

      <Section title="What a bot can do with it">
        {plugin.can.map((line) => <Row key={line} title={<><Icon name="check" size={14} />{line}</>} />)}
      </Section>

      <Section title="What installing adds to the bot">
        {plugin.skills.map((name) => {
          const skill = skills.find((s) => s.name === name)
          return <Row key={name} title={<><Icon name="book" size={15} />Skill: {skill?.title ?? name}</>} description={skill?.description} />
        })}
        {plugin.connection && (
          <Row
            title={<><Icon name="plug" size={15} />Connection: {plugin.connection.name}</>}
            description={<>A direct line to <span className="mono">{plugin.connection.host}</span>. Each bot signs in with its own account, kept in that bot’s folder where the bot itself cannot read it.</>}
          />
        )}
      </Section>

      {plugin.setup && <Setup plugin={plugin} fail={setError} />}
      {choosing && <ChooseBot plugin={plugin} close={() => setChoosing(false)} install={(bot) => (setChoosing(false), set(bot, true))} />}
    </Page>
  )
}

/** What the owner provides once so the plugin's direct connection can be used (the steps are on the plugin's page). */
function Setup({ plugin, fail }: { plugin: Plugin; fail: (message: string) => void }) {
  const setup = plugin.setup!
  const [saved, setSaved] = useState(false)
  const save = (key: string, value: string) =>
    api('PUT', `/api/plugins/setup/${setup.id}`, { ...Object.fromEntries(setup.fields.filter((f) => !f.secret).map((f) => [f.key, setup.values[f.key]])), [key]: value })
      .then(() => setSaved(true))
      .catch((e) => fail(e.message))
  return (
    <Section title="Direct connection" action={<span className={`pill ${setup.done ? 'good' : ''}`}>{setup.done ? 'Set up' : 'Not set up'}</span>}>
      <Row id="plugin-setup" title={setup.title} description="Optional. Follow the steps above, then fill these in. They are shared by every plugin that asks for the same thing, and kept on the computer that runs Open Bot." status={saved ? 'Saved.' : undefined} />
      {setup.fields.map((field) => (
        <Row key={field.key} title={field.label} control={<Field label={field.label} type={field.secret ? 'password' : 'text'} value={field.secret ? '' : setup.values[field.key]} placeholder={field.secret && setup.values[field.key] ? 'Saved' : ''} onCommit={(value) => save(field.key, value)} />} />
      ))}
    </Section>
  )
}

function ChooseBot({ plugin, close, install }: { plugin: Plugin; close: () => void; install: (bot: Bot) => void }) {
  const bots = useStore((s) => s.bots)
  return (
    <Dialog title={`Install ${plugin.name}`} close={close}>
      <div className="form">
        <p className="muted">Which bot is it for? Only that bot gets it.</p>
        <div className="choose-bot">
          {bots.map((bot) => {
            const has = plugin.installedOn.includes(bot.id)
            return (
              <button key={bot.id} disabled={has} onClick={() => install(bot)}>
                <BotHead bot={bot} />
                <span className="grow">{bot.name}</span>
                {has ? <span className="faint">Installed</span> : <Icon name="chevron" size={14} />}
              </button>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}
