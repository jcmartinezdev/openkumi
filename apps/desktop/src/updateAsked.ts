// Updating the app when a server it runs is asked to. A server inside the app is part of it, so it
// cannot update by itself: a computer or phone paired with it asks it all the same (POST
// /api/update), and it passes that on here (apps/server/src/update.ts). The app then fetches its
// new version, if it does not have it yet, and restarts into it once no bot is at work in any of
// the servers it runs, since everyone's stop with it. Asked not to wait, it restarts as soon as it
// has the new version.
//
// Nobody at this computer is asked: there may be nobody at it, and whoever asked from elsewhere
// was told how many bots that stops. Meanwhile each server is told how the app stands with its
// update, to report as its own, and how many bots are at work in the others.
//
// What it works with is handed to it (main.ts), so that test/update-requests.test.mjs can try it
// without an app around it.
import type { AppUpdate, FromServer, ToServer } from '@openkumi/shared/desktop'

export interface Parts<Server> {
  /** How the app stands with its update, and looking for a newer version now (updates.ts). */
  state: () => AppUpdate
  check: () => Promise<void>
  onChange: (fn: () => void) => void
  /** The servers this app runs, how many bots are at work in each, and the channel to each (local.ts). */
  servers: () => Server[]
  workingIn: (server: Server) => number
  tell: (server: Server, message: ToServer) => void
  onMessage: (fn: (server: Server, message: FromServer | { type: 'gone' }) => void) => void
  /** Stops the servers cleanly, puts the new version in place and opens it (main.ts). */
  restart: () => void
  /** How long to wait for the new version to be fetched, and before restarting once the answer is out. */
  waitMs?: number
  answerMs?: number
}

/** Called once, when the app starts, before its servers do: from then on they can have it updated. */
export function startUpdateRequests<Server>({ state, check, onChange, servers, workingIn, tell, onMessage, restart, waitMs = 100_000, answerMs = 1000 }: Parts<Server>) {
  /** A server was asked to update: the app restarts into its new version once it has it. */
  let asked = false
  /** And without waiting for the bots. That holds for what this request found only, as on a server installed alone. */
  let hurried = false
  /** Requests still to be answered: the app does not restart under them. */
  let answering = 0

  const atWork = () => servers().reduce((sum, server) => sum + workingIn(server), 0)
  const busy = () => state().state === 'checking' || state().state === 'downloading'

  /** Tells every server this app runs how the app stands with its update. */
  function tellAll() {
    const all = atWork()
    for (const server of servers()) tell(server, { type: 'app-update', update: state(), asked, elsewhere: all - workingIn(server) })
  }

  /** Restarts into the new version once there is one, if it was asked for, and nothing would be cut off by that or it was asked not to wait. */
  function settle() {
    if (!asked || answering || state().state !== 'ready' || (atWork() > 0 && !hurried)) return
    asked = false
    hurried = false
    restart()
  }

  /** Waits until the app is done looking for its new version and fetching it, or a while has gone by. */
  const settled = () =>
    new Promise<void>((resolve) => {
      const done = () => (clearTimeout(late), clearInterval(again), resolve())
      const late = setTimeout(done, waitMs)
      const again = setInterval(() => !busy() && done(), 250)
      if (!busy()) done()
    })

  async function updateAsked(server: Server, id: number, now: boolean) {
    answering++
    try {
      if (state().state !== 'unsupported') {
        asked = true
        hurried ||= now
        if (state().state !== 'ready') {
          await check().catch(() => {})
          await settled()
        }
        // Found nothing to restart into, and is not fetching anything either.
        if (!busy() && state().state !== 'ready') asked = hurried = false
      }
    } finally {
      tellAll()
      tell(server, { type: 'updated', id })
      answering--
    }
    // The answer goes out first: the server it reaches is stopped a moment later.
    setTimeout(settle, answerMs)
  }

  onChange(() => {
    // Nothing newer was found, or it could not be fetched: there is nothing to restart into, and nothing asked for lingers.
    if (asked && (state().state === 'none' || state().state === 'failed')) {
      asked = false
      hurried = false
    }
    tellAll()
    settle()
  })
  onMessage((server, message) => {
    if (message.type === 'update' && Number.isInteger(message.id)) return void updateAsked(server, message.id, message.now === true)
    // A server that has just started learns how things stand; the others hear how many bots are at work besides theirs.
    tellAll()
    settle()
  })
}
