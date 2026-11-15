// The `openkumi` command of a server installed on its own (openkumi.ai/install.sh): everything
// its owner does at that computer without the app. From the repository it is "npm run openkumi --".
// `start` and `serve` never get here when installed: bin/openkumi runs the server itself for those.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppState, ServerUpdate } from '@openkumi/shared'

const [command = 'help', ...rest] = process.argv.slice(2)
const flag = (name: string) => rest.includes(name)

// Said before anything else is loaded: a version being tried out before it replaces another is
// asked only this (update.ts), and must answer without touching the data folder.
if (command === 'version' || command === '--version' || command === '-v') {
  console.log(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')).version)
  process.exit(0)
}

const HELP = `
  openkumi start              run the server here, in this terminal
  openkumi service install    keep it running in the background, also after a restart
  openkumi service remove     stop that
  openkumi status             whether it runs, which version, and what the bots can run on
  openkumi pair               a code for the OpenKumi app on another computer or phone
  openkumi lan on|off         whether other computers on your network can reach it
  openkumi update             fetch the newest version and start it once no bot is working
                              --now    do not wait for the bots
                              --check  only say whether there is a newer version
  openkumi logs               the last of what the background service printed
  openkumi uninstall          remove OpenKumi from this computer; your bots and data stay
  openkumi version
`

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(HELP)
  process.exit(0)
}

if (command === 'start' || command === 'serve') {
  await import('./index.ts')
} else {
  const { HOME_LABEL, PORT, accessToken } = await import('./config.ts')
  const { RUNTIME, VERSION, WHY_NOT, newer, update } = await import('./update.ts')
  const service = await import('./service.ts')

  const stop = (message: string): never => {
    console.error(`\n  ${message}\n`)
    process.exit(1)
  }

  /** Asks the server running on this computer. Null when none answers. */
  async function ask<T>(method: string, route: string, body?: unknown): Promise<T | null> {
    const res = await fetch(`http://127.0.0.1:${PORT}${route}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null)
    if (!res) return null
    const said = await res.json().catch(() => ({}))
    if (!res.ok) stop(said.error ?? `The server answered ${res.status}.`)
    return said
  }
  const notRunning = () => stop(`The OpenKumi server is not running here (port ${PORT}). ${RUNTIME ? 'Start it with “openkumi start”, or keep it running with “openkumi service install”.' : 'Start it with “npm run server”.'}`)

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const bots = (n: number) => (n === 1 ? '1 bot is' : `${n} bots are`)

  if (command === 'status') {
    const state = await ask<AppState>('GET', '/api/state')
    const { installed } = service.serviceStatus()
    console.log()
    if (!state) console.log(`  Not running. ${installed ? 'The background service is set up but stopped: see “openkumi logs”.' : RUNTIME ? 'Start it with “openkumi start”, or keep it running with “openkumi service install”.' : 'Start it with “npm run server”.'}`)
    else {
      console.log(`  OpenKumi ${state.about.version} is running on port ${state.about.port}${installed ? ', as a background service' : ''}.`)
      console.log(`  Data:      ${state.home}`)
      console.log(`  Network:   ${state.settings.lan || state.about.lanForced ? 'other computers on your network can reach it' : 'only this computer can reach it (“openkumi lan on” lets others)'}`)
      const connected = state.providers.filter((p) => p.connected && p.enabled !== false)
      console.log(`  Bots run on: ${connected.map((p) => p.name).join(', ') || 'nothing yet. Install and sign in to Claude Code, Codex or Grok, or start Ollama or LM Studio.'}`)
      if (!chromeFound()) console.log('  Browser:   Google Chrome was not found. The bots need it to browse.')
      const { update: u } = state
      if (u.state === 'ready') console.log(`  Update:    ${u.latest} is in place and starts once no bot is working${u.working ? ` (${bots(u.working)} now)` : ''}.`)
      else if (u.latest && newer(u.latest, state.about.version)) console.log(`  Update:    ${u.latest} is out. ${u.how === 'installed' ? 'Get it with “openkumi update”.' : WHY_NOT[u.how]}`)
      else if (u.state === 'failed') console.log(`  Update:    ${u.error}`)
    }
    console.log()
  } else if (command === 'pair') {
    const said = (await ask<{ code: string }>('POST', '/api/pairing')) ?? notRunning()
    const state = (await ask<AppState>('GET', '/api/state'))!
    const open = state.settings.lan || state.about.lanForced
    const addresses = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `${i!.address}:${PORT}`)
    console.log(`\n  Pairing code:  ${said.code}`)
    console.log(`  Address:       ${addresses.join('  or  ') || '(this computer is not on a network)'}`)
    console.log('\n  In the OpenKumi app on the other computer: Settings > Environments > Add environment.')
    console.log('  The code works once, for the next 10 minutes.')
    if (!open) console.log('\n  Other computers cannot reach this one yet. Let them with: openkumi lan on')
    console.log()
  } else if (command === 'lan') {
    const on = rest[0] === 'on' ? true : rest[0] === 'off' ? false : stop('Say which: “openkumi lan on” or “openkumi lan off”.')
    // A running server takes the change at once. With none running, it is written where the next start reads it.
    if (!(await ask('PATCH', '/api/settings', { lan: on }))) (await import('./settings.ts')).updateSettings({ lan: on })
    console.log(on ? '\n  Other computers on your network can now reach OpenKumi here. Each still needs a code: openkumi pair\n' : '\n  Only this computer can reach OpenKumi here now.\n')
  } else if (command === 'update') {
    const running = await ask<ServerUpdate>('GET', '/api/update')
    if (flag('--check')) {
      const info = await update(false)
      if (info.state === 'failed') stop(info.error)
      console.log(info.latest && newer(info.latest, VERSION) ? `\n  OpenKumi ${info.latest} is out. This is ${VERSION}. Get it with “openkumi update”.\n` : `\n  OpenKumi ${VERSION} is the newest version.\n`)
    } else if (running) {
      // The server that runs does it itself, so that it is the one that decides when to start again.
      let info = (await ask<ServerUpdate>('POST', '/api/update', { now: flag('--now') }))!
      while (info.state === 'checking' || info.state === 'downloading') {
        await sleep(1000)
        info = (await ask<ServerUpdate>('GET', '/api/update')) ?? { ...info, state: 'ready', working: 0 }
      }
      if (info.state === 'failed') stop(info.error)
      if (info.state !== 'ready') console.log(`\n  OpenKumi ${VERSION} is the newest version.\n`)
      else if (info.working && !flag('--now')) console.log(`\n  OpenKumi ${info.latest} is in place. ${bots(info.working)} working: it starts once they are done.\n  To start it now and stop them: openkumi update --now\n`)
      else console.log(`\n  OpenKumi ${info.latest} is starting in place of ${VERSION}.\n`)
    } else {
      if (!RUNTIME) stop(WHY_NOT.source)
      console.log('\n  Looking for a newer version…')
      const info = await update(true)
      if (info.state === 'failed') stop(info.error)
      console.log(info.state === 'ready' ? `  OpenKumi ${info.latest} is in place. It is what “openkumi start” starts from now on.\n` : `  OpenKumi ${VERSION} is the newest version.\n`)
    }
  } else if (command === 'service') {
    const [what] = rest
    try {
      if (what === 'install') {
        // A server started by hand would hold the port the service wants.
        const { running } = service.serviceStatus()
        if (!running && (await ask('GET', '/api/update'))) stop('OpenKumi is already running here, started by hand. Stop it (Ctrl-C in its terminal) and run this again.')
        const notes = service.installService()
        console.log('\n  OpenKumi now runs in the background, and starts by itself after a restart.')
        for (const note of notes) console.log(`  ${note}`)
        console.log(`  What it prints: openkumi logs\n`)
      } else if (what === 'remove' || what === 'uninstall') {
        console.log(service.removeService() ? '\n  The background service is stopped and removed. Your bots and data are untouched.\n' : '\n  There was no background service.\n')
      } else if (what === 'status') {
        const { installed, running } = service.serviceStatus()
        console.log(`\n  The background service is ${!installed ? 'not set up' : running ? 'set up and running' : 'set up, but not running'}.\n`)
      } else stop('Say which: “openkumi service install”, “openkumi service remove” or “openkumi service status”.')
    } catch (e) {
      stop((e as Error).message)
    }
  } else if (command === 'logs') {
    if (!fs.existsSync(service.LOG)) stop(`Nothing has been written to ${service.LOG} yet. A server started with “openkumi start” prints in its own terminal.`)
    const lines = fs.readFileSync(service.LOG, 'utf8').trimEnd().split('\n')
    console.log(lines.slice(-80).join('\n'))
    console.log(`\n  (${service.LOG})`)
  } else if (command === 'uninstall') {
    if (!RUNTIME) stop('This OpenKumi runs from the repository: there is nothing installed to remove.')
    service.removeService()
    // The command people type, put beside their other programs by the installer.
    const shim = path.join(process.env.OPENKUMI_BIN || path.join(os.homedir(), '.local', 'bin'), 'openkumi')
    try {
      if (fs.readFileSync(shim, 'utf8').includes(RUNTIME)) fs.rmSync(shim)
    } catch {
      // Not there, or not ours.
    }
    fs.rmSync(RUNTIME, { recursive: true, force: true })
    console.log(`\n  OpenKumi is removed from this computer. Your bots and their data are still in ${HOME_LABEL}; delete that folder to remove them too.\n`)
  } else {
    console.error(`\n  “${command}” is not something openkumi does.`)
    console.error(HELP)
    process.exit(1)
  }

  /** Whether Chrome is where it usually is. The bots drive it, and say so themselves if it is missing; this only saves finding out late. */
  function chromeFound() {
    if (process.platform === 'darwin') return ['/Applications', path.join(os.homedir(), 'Applications')].some((dir) => fs.existsSync(path.join(dir, 'Google Chrome.app')))
    if (process.platform === 'win32') return true
    try {
      execFileSync('sh', ['-c', 'command -v google-chrome || command -v google-chrome-stable'], { stdio: 'ignore' })
      return true
    } catch {
      return fs.existsSync('/opt/google/chrome/chrome')
    }
  }
  // Nothing is left to do; a connection that is still open would only keep the terminal waiting.
  process.exit(0)
}
