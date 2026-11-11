// What the window shows while it has no environment to show: the first time the app is opened,
// while Open Bot starts on this computer, and when the environment cannot be reached.
import { useDesktop } from './desktop'
import { EnvironmentList } from './Settings'
import { useStore } from './store'

export function Gate() {
  const app = useDesktop()
  const failures = useStore((s) => s.failures)
  const refused = useStore((s) => s.refused)
  const connected = useStore((s) => s.connected)
  const { local } = app
  const name = app.current === 'local' ? 'This computer' : (app.environments.find((e) => e.id === app.current)?.name ?? 'The environment')

  /** What is going on, and whether there is anything for the person to decide. */
  let lead: string
  let waiting = false
  if (!app.current) {
    lead = local.enabled || app.environments.length ? 'No environment is turned on. Turn one on, or add one.' : 'Where should your bots run? On this computer, on another one, or both.'
  } else if (app.current === 'local' && local.state !== 'running') {
    // Turned on and not running: it is starting, it failed, or the app is on its way out.
    waiting = local.state !== 'failed'
    lead = local.state === 'starting' ? 'Starting Open Bot on this computer…' : local.state === 'off' ? 'Stopping Open Bot on this computer…' : 'Open Bot could not start on this computer.'
  } else if (refused && app.current !== 'local') {
    // (On this computer the app reads the new code by itself, so there is nothing to ask for.)
    lead = `${name} no longer lets this computer in. Pair them again: “Add environment” below, with a new code from its Settings.`
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
            <h1>Open Bot</h1>
            <p role="status">{waiting && <span className="spinner" />}{lead}</p>
          </div>
          {!waiting && <EnvironmentList />}
        </div>
      </div>
    </div>
  )
}
