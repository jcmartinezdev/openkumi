// Keeping OpenKumi up to date, as the window shows it. There are two things to update, and they
// do it apart: this app (apps/desktop/src/updates.ts), and the server of the environment the
// window shows (apps/server/src/update.ts). The server on this computer is part of the app and
// comes with it; one installed on another computer updates itself, and can be told to from here.
import { useState } from 'react'
import type { ServerUpdate } from '@openkumi/shared'
import type { AppUpdate } from '@openkumi/shared/desktop'
import { desktop, reason, useDesktop } from './desktop'
import { Row, Section, Switch, useSetting } from './settingsUi'
import { api, useStore } from './store'

const bots = (n: number) => (n === 1 ? '1 bot is' : `${n} bots are`)
const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60_000)
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`
}

/** Whether version `a` comes after `b` (plain x.y.z versions). */
const newer = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split('-')[0].split('.').map(Number))
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}

/**
 * Restarts the app into the version it has downloaded. Quitting stops the server this app runs,
 * and with it the bots at work on this computer, so the person is asked first when there are any.
 */
export function useRestartForUpdate(): () => void {
  const app = useDesktop()
  const working = useStore((s) => s.threads.filter((t) => t.status === 'running').length)
  return () => {
    // Bots in another environment, or in a server started outside the app, carry on.
    const cutOff = app.current === 'local' && app.local.startedHere ? working : 0
    if (cutOff && !confirm(`${bots(cutOff)} working on this computer. Restarting stops them; what they have done so far is kept. Restart now?`)) return
    void desktop.installUpdate?.().catch((e) => alert(reason(e)))
  }
}

/** A word in the sidebar once a new version of the app is ready, so it is not only found in the settings. */
export function UpdatePill() {
  const update = useDesktop().update
  const restart = useRestartForUpdate()
  if (update?.state !== 'ready') return null
  return (
    <button className="row settings update-ready" onClick={restart} title={`OpenKumi ${update.version} is downloaded. Restart the app to use it.`}>
      <span className="update-dot" />
      <span className="grow">Restart to update</span>
      <span className="time">{update.version}</span>
    </button>
  )
}

const APP_STATE: Record<AppUpdate['state'], (update: AppUpdate) => string> = {
  none: (u) => (u.checkedAt ? `This is the newest version. Looked ${ago(u.checkedAt)}.` : 'Looks for a newer version by itself, and downloads it in the background.'),
  checking: () => 'Looking for a newer version…',
  downloading: (u) => `Downloading OpenKumi ${u.version}… ${u.progress}%`,
  ready: (u) => `OpenKumi ${u.version} is downloaded. It takes this version’s place when you restart the app, or the next time you quit it.`,
  failed: (u) => u.error,
  unsupported: () => 'This copy of the app does not update itself: it runs from the repository, or was installed in a way the system looks after.',
}

const HOW: Record<ServerUpdate['how'], string> = {
  app: 'It is part of the desktop app on that computer, and is updated with the app.',
  source: 'It runs from its source, and is updated there with git.',
  installed: 'It was installed on its own, and keeps itself up to date.',
}

/** The About page's part on updates: this app, then the server of the environment it shows. */
export function UpdatesSection() {
  const app = useDesktop()
  const about = useStore((s) => s.about)
  const update = useStore((s) => s.update)
  const auto = useSetting('autoUpdate')
  const restart = useRestartForUpdate()
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const mine = app.update
  const here = app.current === 'local'
  const name = here ? 'This computer' : (app.environments.find((e) => e.id === app.current)?.name ?? 'The environment')

  /** Has the server fetch the newest version now, and start it at once (`now`) or when its bots are done. */
  const updateServer = async (now: boolean) => {
    setError('')
    setAsking(true)
    try {
      const said = await api<ServerUpdate>('POST', '/api/update', { now })
      if (said.state === 'failed') setError(said.error)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setAsking(false)
    }
  }

  const out = !!update.latest && newer(update.latest, about.version)
  const serverStatus =
    update.state === 'checking'
      ? 'Looking for a newer version…'
      : update.state === 'downloading'
        ? `Downloading OpenKumi ${update.latest}…`
        : update.state === 'ready'
          ? `OpenKumi ${update.latest} is in place${update.working ? `, and starts once ${bots(update.working)} done working` : ' and is starting'}.`
          : update.state === 'failed'
            ? update.error
            : out
              ? `OpenKumi ${update.latest} is out.`
              : update.checkedAt
                ? `This is the newest version. Looked ${ago(update.checkedAt)}.`
                : undefined

  return (
    <Section title="Updates">
      {mine && (
        <Row
          id="app-update"
          title={<>This app<span className="set-version">{app.version}</span></>}
          description={APP_STATE[mine.state](mine)}
          control={
            mine.state === 'ready' ? (
              <button className="primary" onClick={restart}>Restart to update</button>
            ) : mine.state !== 'unsupported' ? (
              <button disabled={mine.state === 'checking' || mine.state === 'downloading'} onClick={() => void desktop.checkForUpdate?.()}>Check for updates</button>
            ) : undefined
          }
        />
      )}
      {/* The server on this computer, run by this app, has nothing of its own to say: it is the app's. */}
      {!(here && app.local.startedHere) && !!about.version && (
        <>
          <Row
            id="server-update"
            title={<>{here ? 'OpenKumi on this computer' : name}<span className="set-version">{about.version}</span></>}
            description={here ? 'It was started outside this app, so it is updated on its own. ' + HOW[update.how] : HOW[update.how]}
            status={error || serverStatus}
            control={
              update.how === 'installed' &&
              (update.state === 'ready' && update.working ? (
                <button disabled={asking} onClick={() => confirm(`${bots(update.working)} working there. Starting the new version now stops them; what they have done so far is kept. Start it now?`) && void updateServer(true)}>Start it now</button>
              ) : (
                <button disabled={asking || update.state === 'checking' || update.state === 'downloading' || update.state === 'ready'} onClick={() => void updateServer(false)}>{out ? 'Update' : 'Check for updates'}</button>
              ))
            }
          />
          {update.how === 'installed' && (
            <Row
              id="server-auto-update"
              title="Update by itself"
              description="It fetches a new version when one is out, and starts it once no bot is working. Off, it only updates when you ask."
              reset={auto.reset}
              control={<Switch label="Update by itself" checked={auto.value} onChange={auto.set} />}
            />
          )}
        </>
      )}
    </Section>
  )
}
