// How the apps and a server know they can work together. Their versions do not have to match: an
// app updates itself when it likes, a phone when the App Store lets it, a server when it is idle.
// What has to match is this number, which the server says in /api/hello.
//
// Raise it only for a change that an app or a server from before cannot live with: something
// taken away from the API or the events, or given another meaning. Adding to them needs nothing.
// The server keeps its own copy (apps/server/src/protocol.ts); a test holds the two together.
// What a server is asked before this number is compared, and to update itself, never changes:
// GET /api/hello, GET /api/update and POST /api/update.
export const PROTOCOL = 1

/** How a server's number stands against this app's: it can be used, it has to be updated first, or this app has to be. */
export function compatible(theirs: unknown): 'ok' | 'outdated' | 'newer' {
  // A server from before the number was introduced says none.
  const protocol = typeof theirs === 'number' ? theirs : 0
  return protocol === PROTOCOL ? 'ok' : protocol < PROTOCOL ? 'outdated' : 'newer'
}
