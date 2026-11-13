// Superpowers: what a bot can do beyond its own tools. A catalog to browse and search, and a page
// for each that says what it does, shows what it gives a bot to read, and lets the owner activate
// it. Both come in two kinds: for every bot, under Superpowers, and for one bot, in its settings,
// where activating is for that bot alone. A superpower is always activated for one bot, never for
// all of them. Activating one that works in an app means signing the bot in to it, in this
// computer's browser or in the bot's own.
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Bot, Superpower, SuperpowerStatus } from '@openkumi/shared'
import { control, driverOf, signInThread, windowOf } from '@openkumi/client/browser'
import { PageView } from './BrowserPane'
import { useDesktop } from './desktop'
import { Markdown } from './Markdown'
import { Icon } from './Icon'
import { Dialog } from './Modals'
import { Page, Row, Section } from './settingsUi'
import { api, useStore } from './store'
import { BotHead } from './Mascot'

/** A superpower's app icon, or its first letter when it has none. Drawn as a picture, so nothing in it can run. */
export const Tile = ({ power, size = 'card' }: { power: Superpower; size?: 'row' | 'card' | 'big' }) => (
  <span className={`power-tile ${size}`} aria-hidden>
    {power.icon ? <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(power.icon)}`} alt="" draggable={false} /> : power.name.slice(0, 1)}
  </span>
)
/** For how many of the bots a superpower is active, when there is more than one bot to tell apart. */
const count = (n: number, of: number) => (of > 1 ? `Active for ${n} of ${of} bots` : 'Active')
/** A superpower's page: for every bot, or, from a bot's settings, for that bot. */
const pageOf = (power: Superpower, bot?: Bot) =>
  bot ? `#/settings/bots/${encodeURIComponent(bot.id)}/superpowers/${encodeURIComponent(power.id)}` : `#/settings/superpowers/${encodeURIComponent(power.id)}`

/** Whether every word looked for is somewhere in what the superpower says about itself. */
function matches(power: Superpower, words: string[]): boolean {
  const text = [power.name, power.tagline, ...power.categories, ...power.can].join(' ').toLowerCase()
  return words.every((word) => text.includes(word))
}

/**
 * A superpower's files are written with their lines wrapped for reading as text; shown formatted,
 * each paragraph and list item is one flowing piece. Code, tables and headings stay as they are.
 */
function unwrap(text: string): string {
  const out: string[] = []
  let code = false
  for (const line of text.split('\n')) {
    const fence = /^\s*(```|~~~)/.test(line)
    const prev = out.at(-1) ?? ''
    const joins = !code && !fence && line.trim() && prev.trim() && !/^\s*(```|~~~|#|\|)/.test(prev) && !/^\s*([-*+>#|]|\d+\.\s)/.test(line)
    if (joins) out[out.length - 1] = `${prev} ${line.trim()}`
    else out.push(line)
    if (fence) code = !code
  }
  return out.join('\n')
}

/** What the catalog showed last, so coming back to it from a superpower's page finds it as it was. */
const lastLook = { query: '', category: '' }

/**
 * Every superpower, apps and know-how together, to browse by what it is for or search. A superpower
 * is in every group it belongs to, and stands out where it is active; a search lists each once. For
 * one bot, active means for that bot, and each opens on a page that activates it for that bot.
 */
export function SuperpowerCatalog({ bot }: { bot?: Bot }) {
  const powers = useStore((s) => s.superpowers)
  const listed = useStore((s) => s.superpowerCategories)
  const bots = useStore((s) => s.bots.length)
  const statuses = useStore((s) => (bot ? s.superpowerStatus[bot.id] : undefined))
  const [query, setQuery] = useState(lastLook.query)
  const [category, setCategory] = useState(lastLook.category)
  useEffect(() => void Object.assign(lastLook, { query, category }), [query, category])
  useCheck(bot ? [bot.id] : [])

  const categories = listed.length ? listed : [...new Set(powers.flatMap((p) => p.categories))]
  const shown = category && categories.includes(category) ? category : ''
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const found = powers.filter((p) => (!shown || p.categories.includes(shown)) && matches(p, words))
  const groups: [title: string, powers: Superpower[]][] = words.length
    ? [[`${found.length} found`, found]]
    : (shown ? [shown] : categories).map((c) => [c, found.filter((p) => p.categories.includes(c))])
  const on = (p: Superpower) => (bot ? bot.superpowers.includes(p.id) : p.onFor.length > 0)
  const badge = (power: Superpower) => {
    if (!on(power)) return null
    if (!bot) return <span className="pill good"><Icon name="check" size={11} />{count(power.onFor.length, bots)}</span>
    const status = statuses?.[power.id]
    if (status?.state === 'needs-login') return <span className="pill warn">Sign in again</span>
    if (status?.state === 'error') return <span className="pill bad">Not working</span>
    return <span className="pill good"><Icon name="check" size={11} />Active</span>
  }

  return (
    <Page wide>
      <p className="set-intro">
        {bot
          ? `What ${bot.name} can do beyond its own tools. Open one to read what it does and activate it for ${bot.name}. Only you can give a bot a superpower; the bot cannot.`
          : 'What your bots can do beyond chatting and browsing, such as working in the apps you use. Open one to see what it does, then activate it for the bots that should have it. Only you can give a bot a superpower.'}
      </p>
      {powers.length > 0 && (
        <div className="catalog-bar">
          <label className="catalog-search">
            <Icon name="search" size={15} />
            <input
              type="text"
              value={query}
              placeholder={`Search ${powers.length} superpowers`}
              aria-label="Search superpowers"
              onChange={(e) => setQuery(e.target.value)}
              // Escape clears the search first; a second press closes the settings.
              onKeyDown={(e) => e.key === 'Escape' && query && (e.stopPropagation(), setQuery(''))}
            />
          </label>
          <div className="catalog-chips" role="group" aria-label="Groups">
            {[['', 'All', powers.length] as const, ...categories.map((c) => [c, c, powers.filter((p) => p.categories.includes(c)).length] as const)].map(([id, label, n]) => (
              <button key={id || 'all'} className={shown === id ? 'active' : ''} aria-pressed={shown === id} onClick={() => setCategory(id)}>
                {label} <span className="count">{n}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {groups.filter(([, list]) => list.length).map(([title, list], i) => (
        <section key={title} className="set-section">
          <div className="set-section-head"><h2>{title}</h2></div>
          <div className="power-grid" id={i === 0 && !bot ? 'superpowers' : undefined}>
            {list.map((power) => (
              <a key={power.id} className={`power-card ${on(power) ? 'on' : ''}`} href={pageOf(power, bot)}>
                <Tile power={power} />
                <div className="power-card-text">
                  <h3>{power.name}</h3>
                  <p>{power.tagline}</p>
                  {badge(power)}
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
      {powers.length > 0 && !found.length && <p className="set-intro">No superpowers match{query ? ` “${query.trim()}”` : ''}{shown ? ` in ${shown}` : ''}.</p>}
      {!powers.length && <p className="set-intro">There are no superpowers in this version of OpenKumi.</p>}
    </Page>
  )
}

/** How a superpower stands for a bot it is active for, in a few words. */
function standing(power: Superpower, status: SuperpowerStatus | undefined): string {
  if (!power.service) return 'Active. Nothing to sign in to.'
  if (status?.state === 'connected') return `${status.signedIn ? 'Signed in' : 'Connected'} · ${status.tools} ${status.tools === 1 ? 'tool' : 'tools'}`
  if (status?.state === 'needs-login') return 'Not signed in any more. Sign in again to use it.'
  if (status?.state === 'error') return status.error ?? 'Not working.'
  return 'Connecting…'
}

/** Nothing connects until it is needed, so a view that shows how bots' services stand asks for that when it opens. */
function useCheck(botIds: string[]) {
  const key = botIds.join()
  useEffect(() => {
    for (const botId of key ? key.split(',') : []) api('POST', `/api/bots/${botId}/superpowers/check`).catch(() => {})
  }, [key])
}

// ---- sign-ins in this computer's own browser, which come back by way of the app

/** What the views waiting for a sign-in hear when one came back: nothing, or what went wrong. */
const returns = new Set<(error: string) => void>()

/** The computer's own browser came back from a sign-in, and the app handed over where to: the environment finishes it. */
export function passSignIn(url: string) {
  api('POST', '/api/superpowers/return', { url }).then(
    () => returns.forEach((heard) => heard('')),
    (e) => returns.forEach((heard) => heard(e.message)),
  )
}

/**
 * One superpower for one bot: whether it is active and how it stands, and the buttons that activate
 * or deactivate it. Activating one that works in an app means signing the bot in to it, which the
 * popup takes care of.
 */
function usePower(power: Superpower, bot: Bot, fail: (message: string) => void): { on: boolean; now: string; control: ReactNode } {
  const status = useStore((s) => s.superpowerStatus[bot.id]?.[power.id])
  const on = bot.superpowers.includes(power.id)
  const [activating, setActivating] = useState<'activate' | 'again' | null>(null)
  // Until the server has answered, so a second press does not undo the first.
  const [busy, setBusy] = useState(false)
  const deactivate = () => {
    if (status?.signedIn && !confirm(`Deactivate ${power.name} for ${bot.name}? Its sign-in to ${power.name} is forgotten.`)) return
    fail('')
    setBusy(true)
    api('PUT', `/api/bots/${bot.id}/superpowers/${power.id}`, { on: false }).catch((e) => fail(e.message)).finally(() => setBusy(false))
  }
  // Every bot has the same buttons, so their names say which bot and superpower they are for.
  const which = `${power.name} for ${bot.name}`
  return {
    on,
    now: on ? standing(power, status) : 'Not active',
    control: (
      <>
        {activating && <Activate bot={bot} power={power} again={activating === 'again'} close={() => setActivating(null)} />}
        {on && status?.state === 'needs-login' && <button className="primary" onClick={() => setActivating('again')}>Sign in again</button>}
        {on ? (
          <button className="ghost" disabled={busy} aria-label={`Deactivate superpower: ${which}`} onClick={deactivate}>Deactivate superpower</button>
        ) : (
          <button className="primary" aria-label={`Activate superpower: ${which}`} onClick={() => setActivating('activate')}>Activate superpower</button>
        )}
      </>
    ),
  }
}

/** A row for a bot on a superpower's page, with how it stands for that bot. */
function PowerRow({ power, bot, fail }: { power: Superpower; bot: Bot; fail: (message: string) => void }) {
  const { now, control } = usePower(power, bot, fail)
  return <Row title={<><BotHead bot={bot} />{bot.name}</>} description={now} control={control} />
}

/** On a superpower's page opened from a bot's settings: how it stands for that bot, and its buttons, by the name. */
function PowerHeadAction({ power, bot, fail }: { power: Superpower; bot: Bot; fail: (message: string) => void }) {
  const { on, now, control } = usePower(power, bot, fail)
  return (
    <div className="power-head-action">
      <div className="set-control">{control}</div>
      <p className={on ? 'power-standing on' : 'power-standing'}>{on ? now : `Not active for ${bot.name}`}</p>
    </div>
  )
}

/**
 * The files a superpower gives a bot to read, which its owner can read too but not change: a list
 * of them that opens one at a time, its instructions first, shown formatted or as written.
 */
function SkillFiles({ power }: { power: Superpower }) {
  const [file, setFile] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [source, setSource] = useState(false)
  useEffect(() => {
    if (!file) return
    let current = true
    setText(null)
    setError('')
    api<{ text: string }>('GET', `/api/superpowers/${encodeURIComponent(power.id)}/file?path=${encodeURIComponent(file)}`).then(
      (d) => current && setText(d.text),
      (e) => current && setError(e.message),
    )
    return () => {
      current = false
    }
  }, [power.id, file])
  const n = power.files.length
  const open = file !== null
  return (
    <Row
      title={<><Icon name="book" size={15} />Skill</>}
      description={`What ${power.name} teaches a bot, which it reads when a task calls for it: ${n} ${n === 1 ? 'file' : 'files'}. The bot can read them but never change them, and neither can anyone else here.`}
      control={
        <button className="ghost" aria-expanded={open} onClick={() => setFile(open ? null : power.files[0])}>
          {open ? 'Hide files' : 'Read the files'}
        </button>
      }
    >
      {open && (
        <div className="skill">
          <div className="skill-files" role="list" aria-label={`${power.name}’s files`}>
            {power.files.map((path) => (
              <button key={path} role="listitem" className={`file-row ${path === file ? 'active' : ''}`} aria-current={path === file} onClick={() => setFile(path)}>
                <Icon name="file" size={14} /><span className="title mono">{path}</span>
              </button>
            ))}
          </div>
          <div className="skill-view">
            <div className="skill-view-head">
              <span className="grow title mono">{file}</span>
              {/\.md$/i.test(file) && (
                <div className="segmented" role="group" aria-label="Show the file">
                  <button className={source ? '' : 'active'} aria-pressed={!source} onClick={() => setSource(false)}>Formatted</button>
                  <button className={source ? 'active' : ''} aria-pressed={source} onClick={() => setSource(true)}>Source</button>
                </div>
              )}
            </div>
            {error ? (
              <div className="notice error">{error}</div>
            ) : text === null ? (
              <p className="muted">Loading…</p>
            ) : source || !/\.md$/i.test(file) ? (
              <pre className="skill-source" aria-label={`Contents of ${file}`}>{text}</pre>
            ) : (
              <div className="skill-text" aria-label={`Contents of ${file}`}><Markdown text={unwrap(text)} /></div>
            )}
          </div>
        </div>
      )}
    </Row>
  )
}

/**
 * Activating a superpower for a bot. One that works in an app is active only once the bot has
 * signed in to it, so the popup asks how: in the browser on this computer, where the person's
 * accounts already are, or in the bot's own browser, which works from any device and suits another
 * account. Giving up leaves the superpower as it was. `again` signs a bot in again that was signed out.
 */
function Activate({ bot, power, again, close }: { bot: Bot; power: Superpower; again: boolean; close: () => void }) {
  const [step, setStep] = useState<'ask' | 'browser' | 'bot' | 'done'>('ask')
  const [error, setError] = useState('')
  const [page, setPage] = useState('')
  const status = useStore((s) => s.superpowerStatus[bot.id]?.[power.id])
  const active = useStore((s) => !!s.bots.find((b) => b.id === bot.id)?.superpowers.includes(power.id))
  const ownBrowser = !!useDesktop().catchesSignIns
  const path = `/api/bots/${bot.id}/superpowers/${power.id}`
  const waiting = step === 'browser' || step === 'bot'

  // Done once the bot is signed in: the superpower is active, or (signing in again) works again.
  useEffect(() => {
    if (waiting && (again ? status?.state === 'connected' : active)) setStep('done')
  }, [waiting, active, status?.state])
  useEffect(() => {
    const heard = (problem: string) => problem && setError(problem)
    returns.add(heard)
    return () => void returns.delete(heard)
  }, [])

  const begin = async (via: 'app' | 'bot') => {
    setError('')
    try {
      const started = await api<{ url?: string; windowId?: string; done?: true }>('POST', `${path}/login`, { via })
      if (started.done) return setStep('done')
      if (started.url) {
        setPage(started.url)
        // Opens in the computer's own browser.
        window.open(started.url)
      }
      setStep(via === 'app' ? 'browser' : 'bot')
    } catch (e: any) {
      setError(e.message)
    }
  }
  const activate = () => api('PUT', path, { on: true }).then(() => setStep('done'), (e) => setError(e.message))
  const cancel = () => {
    if (step !== 'done' && power.signIn) void api('DELETE', `${path}/login`).catch(() => {})
    close()
  }

  const title = again ? `Sign ${bot.name} in to ${power.name} again` : `Activate ${power.name} for ${bot.name}`
  return createPortal(
    <Dialog title={title} close={cancel} full={step === 'bot'} wide={step !== 'bot'}>
      {step === 'bot' ? (
        <BotSignIn bot={bot} power={power} />
      ) : (
        <div className="form activate">
          <div className="activate-head">
            <Tile power={power} size="card" />
            <p>{power.tagline}</p>
          </div>
          {/* A browser can hand the same way back over twice; once the bot is signed in, the second one's "expired" does not matter. */}
          {error && step !== 'done' && <div className="notice error">{error}</div>}
          {step === 'ask' && !power.signIn && (
            <>
              <p className="muted">{bot.name} can use {power.name} as soon as you activate it. There is nothing to sign in to.</p>
              <div className="actions">
                <button onClick={cancel}>Cancel</button>
                <button className="primary" onClick={activate}>Activate superpower</button>
              </div>
            </>
          )}
          {step === 'ask' && power.signIn && (
            <>
              <p className="muted">
                {again ? `${bot.name} is not signed in to ${power.name} any more.` : `${bot.name} signs in to ${power.name} with an account of its own. Once it is signed in, ${power.name} is active for ${bot.name}.`}
              </p>
              <div className="sign-in-choices">
                {ownBrowser && (
                  <button className="primary" onClick={() => begin('app')}>
                    <strong>Sign in with your browser</strong>
                    <span>With the accounts you are already signed in to there.</span>
                  </button>
                )}
                <button className={ownBrowser ? '' : 'primary'} onClick={() => begin('bot')}>
                  <strong>Sign in inside {bot.name}’s browser</strong>
                  <span>{bot.name}’s own browser, on the computer that runs your bots. Good for using a different account for this bot.</span>
                </button>
              </div>
              {!ownBrowser && <p className="faint">To sign in with your own browser, use the latest OpenKumi app installed on this computer.</p>}
            </>
          )}
          {step === 'browser' && (
            <>
              <p className="activate-wait"><span className="spinner" /> Finish signing in to {power.name} in your browser. This updates by itself when you are done.</p>
              <div className="actions">
                <button onClick={cancel}>Cancel</button>
                <button onClick={() => window.open(page)}>Open the page again</button>
              </div>
            </>
          )}
          {step === 'done' && (
            <>
              <p className="activate-done"><Icon name="check" size={16} /> {again ? `${bot.name} is signed in to ${power.name} again.` : `${power.name} is active for ${bot.name}.`}</p>
              <p className="faint">{standing(power, status)}</p>
              <div className="actions">
                <button className="primary" onClick={close}>Done</button>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>,
    document.body,
  )
}

/**
 * The service's sign-in page, open in a window of the bot's own browser on the computer that runs
 * it, and used from here like any window the owner takes control of. The bot never works in it.
 */
function BotSignIn({ bot, power }: { bot: Bot; power: Superpower }) {
  const browser = useStore((s) => s.browsers[bot.id])
  const win = windowOf(browser, signInThread(power.id))
  const tab = browser?.tabs.find((t) => t.id === win?.activeTab)
  const windowId = win?.id
  useEffect(() => {
    if (!windowId) return
    control(bot.id, windowId, 'take')
    return () => control(bot.id, windowId, 'give')
  }, [bot.id, windowId])
  return (
    <>
      <p className="sign-in-note">This is {bot.name}’s own browser, so whoever signs in here is signed in for {bot.name} alone.</p>
      <PageView bot={bot} tab={tab} drive={driverOf(win) === 'you'}>
        {!tab ? <div className="view-wait"><span className="spinner" /> Opening the sign-in page</div> : undefined}
      </PageView>
    </>
  )
}

/** A superpower's page. Opened from a bot's settings, it is about that bot alone, whose buttons are by its name. */
export function SuperpowerPage({ id, bot }: { id: string; bot?: Bot }) {
  const power = useStore((s) => s.superpowers.find((p) => p.id === id))
  const bots = useStore((s) => s.bots)
  const [error, setError] = useState('')
  useCheck(power?.service ? (bot ? [bot.id] : bots.filter((b) => b.superpowers.includes(power.id)).map((b) => b.id)) : [])

  const all = bot ? `#/settings/bots/${encodeURIComponent(bot.id)}/superpowers` : '#/settings/superpowers'
  if (!power) return <Page><p className="set-intro">There is no such superpower. <a href={all}>See all superpowers.</a></p></Page>
  return (
    <Page>
      <header className="power-head">
        <Tile power={power} size="big" />
        <div className="power-head-text">
          <h1>{power.name}</h1>
          <p>{power.tagline}</p>
          <p className="faint power-groups">
            {/* Each group opens the catalog on it. */}
            {power.categories.map((c) => <a key={c} href={all} onClick={() => Object.assign(lastLook, { query: '', category: c })}>{c}</a>)}
            {power.site && <a href={power.site} target="_blank" rel="noreferrer">{new URL(power.site).host.replace(/^www\./, '')}</a>}
          </p>
        </div>
        {bot && <PowerHeadAction power={power} bot={bot} fail={setError} />}
      </header>
      {error && <div className="notice error">{error}</div>}

      <section className="power-about"><Markdown text={unwrap(power.about)} /></section>

      <Section title="What a bot can do with it">
        {power.can.map((line) => <Row key={line} title={<><Icon name="check" size={14} />{line}</>} />)}
      </Section>

      {!bot && (
        <Section title="Your bots">
          {bots.map((other) => <PowerRow key={other.id} power={power} bot={other} fail={setError} />)}
        </Section>
      )}

      <Section title="What it gives a bot">
        {power.files.length > 0 && <SkillFiles power={power} />}
        {power.service && (
          <Row
            title={<><Icon name="plug" size={15} />Tools from {power.service}</>}
            description="Each bot signs in in its own browser, with an account of its own, kept in that bot’s folder where the bot itself cannot read it. Deactivating the superpower for a bot forgets its sign-in."
          />
        )}
      </Section>
    </Page>
  )
}
