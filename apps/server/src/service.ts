// Keeps an installed server running in the background: started when its owner logs in, started
// again if it stops, and after it has updated itself. On a Mac that is a launchd agent; on Linux a
// systemd unit of the user's own. It runs as the person who installed it, not as the system, since
// the bots use that person's sign-ins to Claude Code, Codex and Chrome.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { HOME } from './config.ts'
import { RUNTIME } from './update.ts'

const LABEL = 'ai.openkumi.server'
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)
const UNIT = path.join(os.homedir(), '.config', 'systemd', 'user', 'openkumi.service')
/** Where the service's output goes. */
export const LOG = path.join(HOME, 'server.log')

/** `current` is asked each time the service starts, so a start after an update is the new version. */
const command = () => [path.join(RUNTIME, 'current', 'bin', 'openkumi'), 'serve']

/**
 * What the service is given of this terminal's surroundings: where programs are looked for (the
 * bots' engines are found there), and where OpenKumi keeps its data and listens, when those were chosen.
 */
function surroundings(): Record<string, string> {
  const usual = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  const have = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const kept = Object.fromEntries(['OPENKUMI_HOME', 'OPENKUMI_PORT', 'OPENKUMI_HOOKS_PORT', 'OPENKUMI_RELEASES_URL'].flatMap((name) => (process.env[name] ? [[name, process.env[name]!]] : [])))
  return { PATH: [...have, ...usual.filter((dir) => !have.includes(dir))].join(path.delimiter), ...kept }
}

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function plist() {
  const env = Object.entries(surroundings()).map(([name, value]) => `      <key>${xml(name)}</key>\n      <string>${xml(value)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${command().map((part) => `      <string>${xml(part)}</string>`).join('\n')}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
${env}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
    <key>StandardOutPath</key>
    <string>${xml(LOG)}</string>
    <key>StandardErrorPath</key>
    <string>${xml(LOG)}</string>
  </dict>
</plist>
`
}

/** A value in a unit file: quoted, with what systemd would read as its own escaped. */
const quoted = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`

function unit() {
  return `[Unit]
Description=OpenKumi server
After=network-online.target

[Service]
ExecStart=${command().map(quoted).join(' ')}
${Object.entries(surroundings()).map(([name, value]) => `Environment=${quoted(`${name}=${value}`)}`).join('\n')}
Restart=always
RestartSec=2
StandardOutput=append:${LOG}
StandardError=append:${LOG}

[Install]
WantedBy=default.target
`
}

const sh = (program: string, args: string[]) => execFileSync(program, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
/** Runs it, and says whether it worked. */
function works(program: string, args: string[]) {
  try {
    sh(program, args)
    return true
  } catch {
    return false
  }
}
/** The last line a program that failed printed, which is where it says why. */
const why = (e: unknown) => String((e as { stderr?: string }).stderr || (e as Error).message).trim().split('\n').pop()

const mac = process.platform === 'darwin'
const domain = () => `gui/${process.getuid!()}`

function supported() {
  if (!RUNTIME) throw new Error('The background service is for an installed OpenKumi (openkumi.ai/install.sh). From the repository, start the server with “npm run server”.')
  if (mac) return
  if (process.platform !== 'linux') throw new Error('The background service is set up on macOS and Linux only.')
  if (!works('systemctl', ['--user', 'show-environment'])) throw new Error('This computer has no systemd for your user, which the background service needs. Start the server with “openkumi start” instead.')
}

/** Whether the service is set up, and whether it is running right now. */
export function serviceStatus(): { installed: boolean; running: boolean } {
  if (mac) return { installed: fs.existsSync(PLIST), running: fs.existsSync(PLIST) && works('launchctl', ['print', `${domain()}/${LABEL}`]) }
  return { installed: fs.existsSync(UNIT), running: fs.existsSync(UNIT) && works('systemctl', ['--user', 'is-active', '--quiet', 'openkumi.service']) }
}

/** Sets the service up and starts it. Done again, it is set up afresh and started again. */
export function installService(): string[] {
  supported()
  const notes: string[] = []
  if (mac) {
    fs.mkdirSync(path.dirname(PLIST), { recursive: true })
    works('launchctl', ['bootout', `${domain()}/${LABEL}`])
    fs.writeFileSync(PLIST, plist())
    try {
      sh('launchctl', ['bootstrap', domain(), PLIST])
    } catch (e) {
      throw new Error(`macOS did not take the service: ${why(e)}. It can only be set up while you are logged in at this Mac’s screen (or with screen sharing), not over ssh alone.`)
    }
    notes.push('It runs while you are logged in at this Mac. For a Mac nobody sits at, switch on automatic login in System Settings › Users & Groups.')
    return notes
  }
  fs.mkdirSync(path.dirname(UNIT), { recursive: true })
  fs.writeFileSync(UNIT, unit())
  try {
    sh('systemctl', ['--user', 'daemon-reload'])
    sh('systemctl', ['--user', 'enable', 'openkumi.service'])
    sh('systemctl', ['--user', 'restart', 'openkumi.service'])
  } catch (e) {
    throw new Error(`systemd did not take the service: ${why(e)}`)
  }
  // Without this, a user's services stop when that user logs out.
  if (!works('loginctl', ['enable-linger', os.userInfo().username])) notes.push(`It stops when you log out. To keep it running, an administrator can run: sudo loginctl enable-linger ${os.userInfo().username}`)
  return notes
}

/** Stops the service and takes it away. The server's data is left alone. */
export function removeService(): boolean {
  if (mac) {
    if (!fs.existsSync(PLIST)) return false
    works('launchctl', ['bootout', `${domain()}/${LABEL}`])
    fs.rmSync(PLIST, { force: true })
    return true
  }
  if (!fs.existsSync(UNIT)) return false
  works('systemctl', ['--user', 'disable', '--now', 'openkumi.service'])
  fs.rmSync(UNIT, { force: true })
  works('systemctl', ['--user', 'daemon-reload'])
  return true
}
