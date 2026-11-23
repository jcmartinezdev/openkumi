// Keeps an installed server running in the background: started when its owner logs in, started
// again if it stops, and after it has updated itself. On a Mac that is a launchd agent; on Linux a
// systemd unit of the user's own. It runs as the person who installed it, not as the system, since
// the bots use that person's sign-ins to Claude Code, Codex and Chrome.
//
// Each person with bots on this computer (people.ts) has a server of their own, and so a service
// of their own, named after them. `who` is that person's name everywhere here.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BASE, PERSON, homeOf, people } from './config.ts'
import { RUNTIME } from './update.ts'

const label = (who: string) => `ai.openkumi.server.${who}`
const plistOf = (who: string) => path.join(os.homedir(), 'Library', 'LaunchAgents', `${label(who)}.plist`)
const unitName = (who: string) => `openkumi-${who}.service`
const unitOf = (who: string) => path.join(os.homedir(), '.config', 'systemd', 'user', unitName(who))
/**
 * The one service there was before each person had one. After an update it goes on running the
 * server, now the first person's, until that person's own service is set up in its place: so
 * for the first person it counts as theirs wherever one is asked about.
 */
const OLD = { label: 'ai.openkumi.server', unit: 'openkumi.service' }
const oldFile = () => (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'LaunchAgents', `${OLD.label}.plist`) : path.join(os.homedir(), '.config', 'systemd', 'user', OLD.unit))
/** Whether the service from before is what runs this person's server: only ever the first person's. */
const onOld = (who: string) => who === people()[0]?.name && fs.existsSync(oldFile()) && !fs.existsSync(process.platform === 'darwin' ? plistOf(who) : unitOf(who))
/** Where the service's output goes. The service from before writes where it always did. */
export const logOf = (who = PERSON) => path.join(onOld(who) ? BASE : homeOf(who), 'server.log')

/** `current` is asked each time the service starts, so a start after an update is the new version. */
const command = (who: string) => [path.join(RUNTIME, 'current', 'bin', 'openkumi'), 'serve', '--for', who]

/**
 * What the service is given of this terminal's surroundings: where programs are looked for (the
 * bots' engines are found there), and where OpenKumi keeps its data and listens, when those were chosen.
 * The ports named here are the first person's server's: everyone else's takes its port from the list of people.
 */
function surroundings(who: string): Record<string, string> {
  const usual = ['/opt/homebrew/bin', '/usr/local/bin', path.join(os.homedir(), '.local', 'bin'), '/usr/bin', '/bin', '/usr/sbin', '/sbin']
  const have = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  const names = who === people()[0]?.name ? ['OPENKUMI_HOME', 'OPENKUMI_PORT', 'OPENKUMI_HOOKS_PORT', 'OPENKUMI_RELEASES_URL'] : ['OPENKUMI_HOME', 'OPENKUMI_RELEASES_URL']
  const kept = Object.fromEntries(names.flatMap((name) => (process.env[name] ? [[name, process.env[name]!]] : [])))
  return { PATH: [...have, ...usual.filter((dir) => !have.includes(dir))].join(path.delimiter), ...kept }
}

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function plist(who: string) {
  const env = Object.entries(surroundings(who)).map(([name, value]) => `      <key>${xml(name)}</key>\n      <string>${xml(value)}</string>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${xml(label(who))}</string>
    <key>ProgramArguments</key>
    <array>
${command(who).map((part) => `      <string>${xml(part)}</string>`).join('\n')}
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
    <string>${xml(logOf(who))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(logOf(who))}</string>
  </dict>
</plist>
`
}

/** A value in a unit file: quoted, with what systemd would read as its own escaped. */
const quoted = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`

function unit(who: string) {
  return `[Unit]
Description=OpenKumi server (${who})
After=network-online.target

[Service]
ExecStart=${command(who).map(quoted).join(' ')}
${Object.entries(surroundings(who)).map(([name, value]) => `Environment=${quoted(`${name}=${value}`)}`).join('\n')}
Restart=always
RestartSec=2
StandardOutput=append:${logOf(who)}
StandardError=append:${logOf(who)}

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
export function serviceStatus(who = PERSON): { installed: boolean; running: boolean } {
  const [file, name] = onOld(who) ? [oldFile(), mac ? OLD.label : OLD.unit] : mac ? [plistOf(who), label(who)] : [unitOf(who), unitName(who)]
  if (mac) return { installed: fs.existsSync(file), running: fs.existsSync(file) && works('launchctl', ['print', `${domain()}/${name}`]) }
  return { installed: fs.existsSync(file), running: fs.existsSync(file) && works('systemctl', ['--user', 'is-active', '--quiet', name]) }
}

/**
 * Stops and takes away the service from before each person had one: it would start a second
 * server for the first person. True when there was one. It is given a moment to stop, so that
 * what is started in its place does not find its server still there.
 */
function retire(): boolean {
  const file = oldFile()
  if (!fs.existsSync(file)) return false
  const running = () => (mac ? works('launchctl', ['print', `${domain()}/${OLD.label}`]) : works('systemctl', ['--user', 'is-active', '--quiet', OLD.unit]))
  if (mac) works('launchctl', ['bootout', `${domain()}/${OLD.label}`])
  else works('systemctl', ['--user', 'disable', '--now', OLD.unit])
  for (let tries = 0; tries < 12 && running(); tries++) execFileSync('sleep', ['0.5'])
  if (running()) throw new Error(`The background service from before could not be stopped, so nothing was changed. Stop it by hand (${mac ? `launchctl bootout ${domain()}/${OLD.label}` : `systemctl --user stop ${OLD.unit}`}) and run this again.`)
  fs.rmSync(file, { force: true })
  if (!mac) works('systemctl', ['--user', 'daemon-reload'])
  return true
}

/** Sets the service up and starts it. Done again, it is set up afresh and started again. */
export function installService(who = PERSON): string[] {
  supported()
  const notes: string[] = []
  if (who === people()[0]?.name) retire()
  // What the service prints goes into the data folder, which a server that never ran does not have yet.
  fs.mkdirSync(homeOf(who), { recursive: true })
  if (mac) {
    const file = plistOf(who)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    works('launchctl', ['bootout', `${domain()}/${label(who)}`])
    fs.writeFileSync(file, plist(who))
    try {
      sh('launchctl', ['bootstrap', domain(), file])
    } catch (e) {
      throw new Error(`macOS did not take the service: ${why(e)}. It can only be set up while you are logged in at this Mac’s screen (or with screen sharing), not over ssh alone.`)
    }
    notes.push('It runs while you are logged in at this Mac. For a Mac nobody sits at, switch on automatic login in System Settings › Users & Groups.')
    return notes
  }
  const file = unitOf(who)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, unit(who))
  try {
    sh('systemctl', ['--user', 'daemon-reload'])
    sh('systemctl', ['--user', 'enable', unitName(who)])
    sh('systemctl', ['--user', 'restart', unitName(who)])
  } catch (e) {
    throw new Error(`systemd did not take the service: ${why(e)}`)
  }
  // Without this, a user's services stop when that user logs out.
  if (!works('loginctl', ['enable-linger', os.userInfo().username])) notes.push(`It stops when you log out. To keep it running, an administrator can run: sudo loginctl enable-linger ${os.userInfo().username}`)
  return notes
}

/** Whether the service still runs, asked a few times: it is given a moment to stop. */
function stillRunning(who: string) {
  for (let tries = 0; tries < 12; tries++) {
    if (!serviceStatus(who).running) return false
    execFileSync('sleep', ['0.5'])
  }
  return true
}

/**
 * Stops the service and takes it away. The server's data is left alone. One that could not be
 * stopped is left set up, and this throws: taking its files away would leave a server running
 * that nothing looks after.
 */
export function removeService(who = PERSON): boolean {
  const file = mac ? plistOf(who) : unitOf(who)
  const old = who === people()[0]?.name && retire()
  if (!fs.existsSync(file)) return old
  if (mac) works('launchctl', ['bootout', `${domain()}/${label(who)}`])
  else works('systemctl', ['--user', 'disable', '--now', unitName(who)])
  if (stillRunning(who)) throw new Error(`The background service could not be stopped, so nothing was removed. Stop it by hand (${mac ? `launchctl bootout ${domain()}/${label(who)}` : `systemctl --user stop ${unitName(who)}`}) and run this again.`)
  fs.rmSync(file, { force: true })
  if (!mac) works('systemctl', ['--user', 'daemon-reload'])
  return true
}
