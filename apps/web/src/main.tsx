import { createRoot } from 'react-dom/client'
import type { DesktopState } from '@openkumi/shared/desktop'
import { keepCopies, keepOnlyCopies, saveCopyNow } from '@openkumi/client/copies'
import { App } from './App'
import { desktop, desktopState, inDesktopApp, onDesktopState } from './desktop'
import { shelf } from './shelf'
import { passSignIn } from './Superpowers'
import { follow, onLearn, recheck } from './store'
import './styles.css'

const root = document.getElementById('root')!
if (!inDesktopApp) {
  // The interface is part of the desktop app; a browser has no app behind it to say where the bots run.
  root.textContent = 'OpenKumi is a desktop app. Start it with “npm start”.'
} else {
  const chrome = (state = desktopState()) => {
    document.documentElement.dataset.platform = state.platform
    // On a Mac the window's buttons sit on top of the interface, except in full screen.
    document.documentElement.toggleAttribute('data-inset', state.platform === 'darwin' && !state.fullScreen)
  }
  chrome()
  // What the window learns about the environment it shows (its server's id, where else it can be
  // reached) is kept by the app, with the environment.
  onLearn((id, learned) => void desktop.learn(id, learned).catch(() => {}))
  // Coming back to the window, or onto a network, the environment's addresses are asked again:
  // home may answer again, or the one in use may be gone.
  addEventListener('online', recheck)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && recheck())
  // A copy of what each environment on another computer sent is kept, to show at once next time and
  // while it cannot be reached. It is written now when the window is hidden or goes, rather than
  // within the next few seconds; a removed environment's copy goes with it.
  keepCopies(shelf)
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void saveCopyNow())
  addEventListener('pagehide', () => void saveCopyNow())
  let environments = ''
  const tidy = (state: DesktopState) => {
    const ids = state.environments.map((e) => e.id)
    if (ids.join() !== environments) void keepOnlyCopies(ids).catch(() => {})
    environments = ids.join()
  }
  tidy(desktopState())
  follow(desktopState().connection)
  onDesktopState((state) => {
    chrome(state)
    // Followed first: leaving an environment writes what changed of it, and a removed one's copy goes after that.
    follow(state.connection)
    tidy(state)
  })
  // A superpower's sign-in in this computer's own browser comes back by way of the app.
  desktop.onSignIn?.(passSignIn)
  createRoot(root).render(<App />)
}
