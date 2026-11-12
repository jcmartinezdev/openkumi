// Superpowers: what a bot can do beyond its own tools. A list to browse, a page for each that says
// what it does and lets the owner activate it for each bot, and the same buttons from the bot's
// side, in its settings. A superpower is always activated for one bot, never for all of them.
// Activating one that works in an app means signing the bot in to it, in this computer's browser or
// in the bot's own.
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Bot, Superpower, SuperpowerStatus } from '@openbot/shared'
import { control, driverOf, signInThread, windowOf } from '@openbot/client/browser'
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
const count = (n: number) => `Active for ${n} ${n === 1 ? 'bot' : 'bots'}`
const pageOf = (power: Superpower) => `#/settings/superpowers/${encodeURIComponent(power.id)}`

export function SuperpowerList() {
  const powers = useStore((s) => s.superpowers)
  // Grouped as the superpowers themselves say, in the order the groups first appear.
  const categories = [...new Set(powers.map((p) => p.category))]
  return (
    <Page wide>
      <p className="set-intro">What your bots can do beyond chatting and browsing, such as working in the apps you use. Open one to see what it does, then activate it for the bots that should have it. Only you can give a bot a superpower.</p>
      {categories.map((category, i) => (
        <section key={category} className="set-section">
          <div className="set-section-head"><h2>{category}</h2></div>
          <div className="power-grid" id={i === 0 ? 'superpowers' : undefined}>
            {powers.filter((p) => p.category === category).map((power) => (
              <a key={power.id} className="power-card" href={pageOf(power)}>
                <Tile power={power} />
                <div className="power-card-text">
                  <h3>{power.name}</h3>
                  <p>{power.tagline}</p>
                  {power.onFor.length > 0 && <span className="pill good">{count(power.onFor.length)}</span>}
                </div>
              </a>
            ))}
          </div>
        </section>
      ))}
      {!powers.length && <p className="set-intro">There are no superpowers in this version of Open Bot.</p>}
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
 * One superpower for one bot: how it stands, and activating or deactivating it. Activating one
 * that works in an app means signing the bot in to it, which the popup takes care of. With a
 * `description`, how it stands goes on the line under it, while it is active.
 */
function PowerRow({ power, bot, title, description, fail }: { power: Superpower; bot: Bot; title: ReactNode; description?: string; fail: (message: string) => void }) {
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
  const now = on ? standing(power, status) : 'Not active'
  // Each row has the same buttons, so their names say which bot and superpower they are for.
  const which = `${power.name} for ${bot.name}`
  return (
    <Row
      title={title}
      description={description ?? now}
      status={description && on ? now : undefined}
      control={
        <>
          {activating && <Activate bot={bot} power={power} again={activating === 'again'} close={() => setActivating(null)} />}
          {on && status?.state === 'needs-login' && <button className="primary" onClick={() => setActivating('again')}>Sign in again</button>}
          {on ? (
            <button className="ghost" disabled={busy} aria-label={`Deactivate superpower: ${which}`} onClick={deactivate}>Deactivate superpower</button>
          ) : (
            <button className="primary" aria-label={`Activate superpower: ${which}`} onClick={() => setActivating('activate')}>Activate superpower</button>
          )}
        </>
      }
    />
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
          {error && <div className="notice error">{error}</div>}
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
              {!ownBrowser && <p className="faint">To sign in with your own browser, use the latest Open Bot app installed on this computer.</p>}
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

export function SuperpowerPage({ id }: { id: string }) {
  const power = useStore((s) => s.superpowers.find((p) => p.id === id))
  const bots = useStore((s) => s.bots)
  const [error, setError] = useState('')
  useCheck(power?.service ? bots.filter((b) => b.superpowers.includes(power.id)).map((b) => b.id) : [])

  if (!power) return <Page><p className="set-intro">There is no such superpower. <a href="#/settings/superpowers">See all superpowers.</a></p></Page>
  return (
    <Page>
      <header className="power-head">
        <Tile power={power} size="big" />
        <div className="power-head-text">
          <h1>{power.name}</h1>
          <p>{power.tagline}</p>
          <p className="faint">{power.category}{power.site && <> · <a href={power.site} target="_blank" rel="noreferrer">{new URL(power.site).host.replace(/^www\./, '')}</a></>}</p>
        </div>
      </header>
      {error && <div className="notice error">{error}</div>}

      {/* The page is written with lines wrapped for reading as a file; here a paragraph is one flowing piece. */}
      <section className="power-about"><Markdown text={power.about.replace(/([^\n])\n(?!\n|\s*(?:[-*>#]|\d+\.)\s)/g, '$1 ')} /></section>

      <Section title="What a bot can do with it">
        {power.can.map((line) => <Row key={line} title={<><Icon name="check" size={14} />{line}</>} />)}
      </Section>

      <Section title="Your bots">
        {bots.map((bot) => <PowerRow key={bot.id} power={power} bot={bot} title={<><BotHead bot={bot} />{bot.name}</>} fail={setError} />)}
      </Section>

      <Section title="What it gives a bot">
        {power.instructions && (
          <Row title={<><Icon name="book" size={15} />Instructions</>} description={`How to go about it, which the bot reads when a task calls for ${power.name}. It can read them but never change them.`} />
        )}
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

/** A bot's superpowers, in its settings. */
export function BotSuperpowers({ bot }: { bot: Bot }) {
  const powers = useStore((s) => s.superpowers)
  const [error, setError] = useState('')
  useCheck([bot.id])
  return (
    <Page>
      <p className="set-intro">What {bot.name} can do beyond its own tools. Only you can activate a superpower; the bot cannot. Open one to read what it does, or see them all under <a href="#/settings/superpowers">Superpowers</a>.</p>
      {error && <div className="notice error">{error}</div>}
      <Section title="Superpowers">
        {powers.map((power) => (
          <PowerRow
            key={power.id}
            power={power}
            bot={bot}
            title={<a className="power-link" href={pageOf(power)}><Tile power={power} size="row" />{power.name}</a>}
            description={power.tagline}
            fail={setError}
          />
        ))}
        {!powers.length && <Row title="There are no superpowers in this version of Open Bot." />}
      </Section>
    </Page>
  )
}
