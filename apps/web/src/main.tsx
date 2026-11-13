import { createRoot } from 'react-dom/client'
import { App } from './App'
import { desktop, desktopState, inDesktopApp, onDesktopState } from './desktop'
import { passSignIn } from './Superpowers'
import { follow, onLearn, recheck } from './store'
import './styles.css'

const root = document.getElementById('root')!
if (!inDesktopApp) {
  // The interface is part of the desktop app; a browser has no app behind it to say where the bots run.
  root.textContent = 'Open Bot is a desktop app. Start it with “npm start”.'
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
  follow(desktopState().connection)
  onDesktopState((state) => {
    chrome(state)
    follow(state.connection)
  })
  // A superpower's sign-in in this computer's own browser comes back by way of the app.
  desktop.onSignIn?.(passSignIn)
  createRoot(root).render(<App />)
}
