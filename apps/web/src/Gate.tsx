// What the window shows while it has no environment to show: the welcome while there is none at
// all, then while OpenKumi starts on this computer, and when the environment cannot be reached.
import { useDesktop } from './desktop'
import { EnvironmentList } from './Settings'
import { useStore } from './store'
import { Welcome } from './Welcome'

export function Gate() {
  const app = useDesktop()
  const failures = useStore((s) => s.failures)
  const refused = useStore((s) => s.refused)
  const outdated = useStore((s) => s.outdated)
  const connected = useStore((s) => s.connected)
  const { local } = app
  const name = app.current === 'local' ? 'This computer' : (app.environments.find((e) => e.id === app.current)?.name ?? 'The environment')
  // The first time the app is opened, and again once no environment is left.
  if (!app.current && !local.enabled && !app.environments.length) return <Welcome />

  /** What is going on, and whether there is anything for the person to decide. */
  let lead: string
  let waiting = false
  if (!app.current) {
    lead = 'No environment is turned on. Turn one on, or add one.'
  } else if (app.current === 'local' && local.state !== 'running') {
    // Turned on and not running: it is starting, it failed, or the app is on its way out.
    waiting = local.state !== 'failed'
    lead = local.state === 'starting' ? 'Starting OpenKumi on this computer…' : local.state === 'off' ? 'Stopping OpenKumi on this computer…' : 'OpenKumi could not start on this computer.'
  } else if (refused && app.current !== 'local') {
    // (On this computer the app reads the new code by itself, so there is nothing to ask for.)
    lead = `${name} no longer lets this computer in. Pair them again: “Add environment” below, with a new code from its Settings.`
  } else if (outdated && app.current !== 'local') {
    lead = `${name} runs an older OpenKumi, which cannot show that it is the computer this one was paired with, so it is not sent this computer’s key. Update OpenKumi there; this connects by itself once it is.`
  } else if (failures >= 2) {
    lead = `${name} cannot be reached. Still trying…`
  } else {
    waiting = true
    lead = connected ? 'Loading…' : `Connecting to ${name}…`
  }

  return (
    <div className="gate">
      <div className="gate-bar" />
      <div className="set-scroll">
        <div className="set-column">
          <div className="gate-head">
            <h1>OpenKumi</h1>
            <p role="status">{waiting && <span className="spinner" />}{lead}</p>
          </div>
          {!waiting && <EnvironmentList />}
        </div>
      </div>
    </div>
  )
}
