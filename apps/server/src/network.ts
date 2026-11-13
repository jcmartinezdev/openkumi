// Where this computer can be reached from its owner's other devices: its addresses on the local
// network, and on Tailscale, which reaches it from anywhere over a connection of its own that is
// encrypted. Nothing else is served: a connection from the internet at large is closed at once.
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const v4 = (ip: string) => ip.replace(/^::ffff:/, '').match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)?.slice(1).map(Number)

/** An address Tailscale gives out: 100.64.0.0/10, or fd7a:115c:a1e0::/48. */
export function onTailscale(ip: string): boolean {
  const n = v4(ip)
  return n ? n[0] === 100 && n[1] >= 64 && n[1] < 128 : ip.toLowerCase().startsWith('fd7a:115c:a1e0:')
}

/**
 * Whether a connection from this address is served: this computer, the local network (and its
 * link-local addresses) and Tailscale. On the internet, plain http would show every device's key
 * to whoever is in between.
 */
export function nearby(ip: string): boolean {
  const n = v4(ip)
  if (n) {
    const [a, b] = n
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 169 && b === 254) || onTailscale(ip)
  }
  const six = ip.toLowerCase()
  // Loopback, unique local (Tailscale's among them) and link-local.
  return six === '::1' || /^f[cd]/.test(six) || /^fe[89ab]/.test(six)
}

/** This computer's addresses on the local network. */
export const homeAddresses = () =>
  Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal && !onTailscale(i.address))
    .map((i) => i!.address)

// ---- Tailscale
// Its own program says what this computer is called on the owner's tailnet. The name stays the
// same, and it is there even while Tailscale is off, so a device that learns it now can use it
// once Tailscale is on. Without the program, the address is still found among the network's.

/** Where the program usually is: the Mac app's own copy, or one on the PATH. A test names its own. */
const PROGRAMS = process.env.OPENKUMI_TAILSCALE_BIN ? [process.env.OPENKUMI_TAILSCALE_BIN] : ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'tailscale']
const PATH = [process.env.PATH ?? '', '/opt/homebrew/bin', '/usr/local/bin'].join(path.delimiter)

function status(program: string): Promise<any> {
  return new Promise((resolve) =>
    execFile(program, ['status', '--json'], { timeout: 3000, env: { ...process.env, PATH } }, (_error, stdout) => {
      try {
        resolve(JSON.parse(stdout))
      } catch {
        // Not installed, or not answering.
        resolve(null)
      }
    }),
  )
}

let known: { at: number; names: Promise<string[]> } | null = null

/** This computer's name and address on Tailscale, the name first. Looked up at most once a minute. */
export function tailscaleAddresses(): Promise<string[]> {
  if (known && Date.now() - known.at < 60_000) return known.names
  const names = (async () => {
    const found = new Set<string>()
    for (const program of PROGRAMS) {
      const self = (await status(program))?.Self
      if (!self) continue
      if (typeof self.DNSName === 'string' && self.DNSName) found.add(self.DNSName.replace(/\.$/, ''))
      for (const ip of Array.isArray(self.TailscaleIPs) ? self.TailscaleIPs : []) if (typeof ip === 'string' && v4(ip)) found.add(ip)
      break
    }
    for (const i of Object.values(os.networkInterfaces()).flat()) if (i && i.family === 'IPv4' && onTailscale(i.address)) found.add(i.address)
    return [...found]
  })()
  known = { at: Date.now(), names }
  return names
}
