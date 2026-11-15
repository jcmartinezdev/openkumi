// The number the apps compare with their own to know whether they can work with this server.
// What it means, and when to raise it, is in packages/shared/src/protocol.ts, which holds the
// apps' copy: the server runs without that package, so it has its own. A test holds the two together.
export const PROTOCOL = 1
