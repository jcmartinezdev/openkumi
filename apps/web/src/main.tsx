import { createRoot } from 'react-dom/client'
import { App } from './App'
import { desktopState, inDesktopApp, onDesktopState } from './desktop'
import { follow } from './store'
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
  follow(desktopState().connection)
  onDesktopState((state) => {
    chrome(state)
    follow(state.connection)
  })
  createRoot(root).render(<App />)
}
