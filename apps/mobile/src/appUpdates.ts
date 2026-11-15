// Updates to the app that do not go through the App Store: its JavaScript, published when a
// change is merged (docs/mobile-releases.md). The app that was installed fetches the newest one
// that fits it and runs it from the next start. A build that was not made for release has no
// updates to listen to, and all of this stays quiet.
//
// At launch that is the library's own doing (app.json: checkAutomatically). A phone keeps an app
// alive for days, though, so it is asked again when the app comes back after a while, and an
// update that has been waiting is started then: coming back after a long time is as good as a
// start, with nothing half typed to lose.
import { useEffect } from 'react'
import { AppState } from 'react-native'
import * as Updates from 'expo-updates'

/** Back after this long in the background, the app asks whether there is a newer update. */
const ASK_AGAIN_AFTER = 15 * 60_000
/** Back after this long, an update that is already downloaded is started at once. */
const START_AFTER = 30 * 60_000

async function fetchNewest() {
  const found = await Updates.checkForUpdateAsync()
  if (found.isAvailable) await Updates.fetchUpdateAsync()
}

/** Keeps the app looking for updates for as long as it is open. Called once, by the layout. */
export function useUpdateChecks() {
  const { isUpdatePending } = Updates.useUpdates()
  useEffect(() => {
    if (!Updates.isEnabled) return
    let left = 0
    const watching = AppState.addEventListener('change', (state) => {
      if (state === 'background') return void (left = Date.now())
      if (state !== 'active' || !left) return
      const away = Date.now() - left
      left = 0
      if (isUpdatePending && away >= START_AFTER) void Updates.reloadAsync().catch(() => {})
      // Offline, or nothing published for this build: there is nothing to say about either.
      else if (away >= ASK_AGAIN_AFTER) void fetchNewest().catch(() => {})
    })
    return () => watching.remove()
  }, [isUpdatePending])
}

/** How the app stands with its updates, for the About page. Null in a build that takes none. */
export function useAppUpdate(): { state: 'current' | 'checking' | 'downloading' | 'ready'; published: Date | null; check: () => void; restart: () => void } | null {
  const { isUpdatePending, isChecking, isDownloading } = Updates.useUpdates()
  if (!Updates.isEnabled) return null
  return {
    state: isUpdatePending ? 'ready' : isDownloading ? 'downloading' : isChecking ? 'checking' : 'current',
    // The JavaScript that came with the app has no date of its own worth showing.
    published: Updates.isEmbeddedLaunch ? null : Updates.createdAt,
    check: () => void fetchNewest().catch(() => {}),
    restart: () => void Updates.reloadAsync().catch(() => {}),
  }
}
