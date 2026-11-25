// The `openkumi` command of a server installed on its own (openkumi.ai/install.sh): everything
// its owner does at that computer without the app. From the repository it is "npm run openkumi --".
// `serve` never gets here when installed: bin/openkumi runs the server itself for that, as a service's one process.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppState, ServerUpdate } from '@openkumi/shared'

// `--for <name>` says whose server a command is about (config.ts reads it), wherever it stands.
const args = process.argv.slice(2)
const named = args.includes('--for')
if (named) args.splice(args.indexOf('--for'), 2)
const [command = 'help', ...rest] = args
const flag = (name: string) => rest.includes(name)

// Said before anything else is loaded: a version being tried out before it replaces another is
// asked only this (update.ts), and must answer without touching the data folder.
if (command === 'version' || command === '--version' || command === '-v') {
  console.log(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')).version)
  process.exit(0)
}

const HELP = `
  openkumi start              run the server here, in this terminal: everyone's, where
                              several people have bots on this computer
  openkumi service install    keep it running in the background, also after a restart
  openkumi service remove     stop that
  openkumi status             whether it runs, which version, and what the bots can run on
  openkumi pair               a code for the OpenKumi app on another computer or phone
  openkumi lan on|off         whether other computers on your network can reach it
  openkumi telemetry on|off   whether it tells OpenKumi's makers how it is used and what goes wrong
                              (never what you or your bots write); without on or off, how that stands
  openkumi update             fetch the newest version and start it once no bot is working
                              --now    do not wait for the bots
                              --check  only say whether there is a newer version
  openkumi logs               the last of what the background service printed
  openkumi uninstall          remove OpenKumi from this computer; your bots and data stay
  openkumi version

  Bots belong to a person, and each person on this computer has a server of their own, apart
  from the others'. You are the first; the commands above are about yours.
  openkumi people             who has bots here, and whether each one's server runs
  openkumi people add <name>  bots of their own for someone else, and a code for their app
  openkumi people remove <name>   stop theirs; what it held is kept
  openkumi people rename <name> <new name>
                              --for <name>  after any command above: it is about that person's
                                            server (openkumi pair --for ana)
`

if (command === 'help' || command === '--help' || command === '-h') {
  console.log(HELP)
  process.exit(0)
}

if (command === 'serve') {
  await import('./index.ts')
} else if (command === 'start') {
  // The server of the person named, or of everyone here: each in a process of its own, started again when it stops to update (start.ts).
  const { PERSON, people } = await import('./config.ts')
  const { startServers } = await import('./start.ts')
  // Ends by itself once they have: whatever they printed last is written out first.
  process.exitCode = await startServers(named ? [PERSON] : people().map((person) => person.name), rest)
} else {
  const { BASE, FIRST, FROM_REPOSITORY, PERSON, PORT, accessToken, people } = await import('./config.ts')
  const { RUNTIME, VERSION, WHY_NOT, newer, update } = await import('./update.ts')
  const service = await import('./service.ts')
  const { homeAddresses } = await import('./network.ts')

  const stop = (message: string): never => {
    console.error(`\n  ${message}\n`)
    process.exit(1)
  }

  /** A command as it is typed for the server this one is about: the first person's needs no name. */
  const typed = (what: string) => `openkumi ${what}${FIRST ? '' : ` --for ${PERSON}`}`
  /** Whose server it is only needs saying where there are several. */
  const several = people().length > 1
  const whose = several ? `${PERSON}’s OpenKumi server` : 'The OpenKumi server'
  /** A folder as its person would type it. */
  const shown = (dir: string) => (dir.startsWith(os.homedir() + path.sep) ? '~' + dir.slice(os.homedir().length) : dir)

  /**
   * Asks the server running on this computer that the command is about, or the one at another
   * port with its own access code. Null when none answers.
   */
  async function ask<T>(method: string, route: string, body?: unknown, at = { port: PORT, code: accessToken() }): Promise<T | null> {
    const res = await fetch(`http://127.0.0.1:${at.port}${route}`, {
      method,
      headers: { Authorization: `Bearer ${at.code}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }).catch(() => null)
    if (!res) return null
    const said = await res.json().catch(() => ({}))
    if (!res.ok) stop(said.error ?? `The server answered ${res.status}.`)
    return said
  }
  const starting = RUNTIME ? `Start it with “${typed('start')}”, or keep it running with “${typed('service install')}”.` : `Start it with “${FIRST ? 'npm run server' : `npm run openkumi -- start --for ${PERSON}`}”.`
  const notRunning = () => stop(`${whose} is not running here (port ${PORT}). ${starting}`)

  /**
   * A pairing code, with the addresses on the home network the server it is for can be reached at.
   * From anywhere else, a device pairs at an https address its owner put in front of it.
   */
  function showCode(code: string, port: number) {
    const addresses = homeAddresses().map((ip) => `${ip}:${port}`)
    console.log(`\n  Pairing code:  ${code}`)
    console.log(`  Address:       ${addresses.join('  or  ') || '(this computer is not on a home network)'}`)
    console.log(`  Away from home, use an https address you put in front of port ${port} instead.`)
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const bots = (n: number) => (n === 1 ? '1 bot is' : `${n} bots are`)

  if (command === 'status') {
    const state = await ask<AppState>('GET', '/api/state')
    const { installed } = service.serviceStatus()
    console.log()
    if (!state) console.log(`  ${several ? `${PERSON}’s server is not running.` : 'Not running.'} ${installed ? `The background service is set up but stopped: see “${typed('logs')}”.` : starting}`)
    else {
      console.log(`  ${several ? `${PERSON}’s OpenKumi` : 'OpenKumi'} ${state.about.version} is running on port ${state.about.port}${installed ? ', as a background service' : ''}.`)
      console.log(`  Data:      ${state.home}`)
      console.log(`  Network:   ${state.settings.lan || state.about.lanForced ? 'other computers on your network can reach it' : `only this computer can reach it (“${typed('lan on')}” lets others)`}`)
      const connected = state.providers.filter((p) => p.connected && p.enabled !== false)
      console.log(`  Bots run on: ${connected.map((p) => p.name).join(', ') || 'nothing yet. Install and sign in to Claude Code, Codex or Grok, or start Ollama or LM Studio.'}`)
      if (!chromeFound()) console.log('  Browser:   Google Chrome was not found. The bots need it to browse.')
      const { update: u } = state
      if (u.state === 'ready') console.log(`  Update:    ${u.staged ?? u.latest} is in place and starts once no bot is working${u.working ? ` (${bots(u.working)} now)` : ''}.`)
      else if (u.latest && newer(u.latest, state.about.version)) console.log(`  Update:    ${u.latest} is out. ${u.how === 'installed' || u.updatable ? 'Get it with “openkumi update”.' : WHY_NOT[u.how]}`)
      else if (u.state === 'failed') console.log(`  Update:    ${u.error}`)
    }
    if (several) console.log(`  People:    ${people().map((p) => p.name).join(', ')} each have a server of their own here (“openkumi people”)`)
    console.log()
  } else if (command === 'pair') {
    const said = (await ask<{ code: string }>('POST', '/api/pairing')) ?? notRunning()
    // Only for the hint below; a server that went away meanwhile still gave its code.
    const state = await ask<AppState>('GET', '/api/state')
    const open = !state || state.settings.lan || state.about.lanForced
    showCode(said.code, PORT)
    console.log('\n  In the OpenKumi app on the other computer: Settings > Environments > Add environment.')
    console.log('  The code works once, for the next 10 minutes.')
    if (!open) console.log(`\n  Other computers cannot reach this one yet. Let them with: ${typed('lan on')}`)
    console.log()
  } else if (command === 'lan') {
    const on = rest[0] === 'on' ? true : rest[0] === 'off' ? false : stop(`Say which: “${typed('lan on')}” or “${typed('lan off')}”.`)
    // A running server takes the change at once. With none running, it is written where the next start reads it.
    if (!(await ask('PATCH', '/api/settings', { lan: on }))) (await import('./settings.ts')).updateSettings({ lan: on })
    const it = several ? `${PERSON}’s OpenKumi` : 'OpenKumi'
    console.log(on ? `\n  Other computers on your network can now reach ${it} here. Each still needs a code: ${typed('pair')}\n` : `\n  Only this computer can reach ${it} here now.\n`)
  } else if (command === 'telemetry') {
    const telemetry = await import('./telemetry.ts')
    const { settings, updateSettings } = await import('./settings.ts')
    const state = await ask<AppState>('GET', '/api/state')
    // The server that runs knows whether it would send anything. With none running, this is asked of the program itself.
    const { can, why } = state?.about.telemetry ?? telemetry.telemetryInfo()
    const READ = 'What is sent, all of it: https://docs.openkumi.ai/telemetry/'
    if (rest[0] === 'on' || rest[0] === 'off') {
      const on = rest[0] === 'on'
      // A running server takes the answer at once. With none running, it is written where the next start reads it.
      if (!state || !(await ask('PATCH', '/api/settings', { telemetry: on }))) updateSettings({ telemetry: on })
      console.log(on ? `\n  Thank you. OpenKumi here now sends how it is used and what goes wrong, and nothing you or your bots write.\n  ${READ}${can ? '' : `\n  For now it sends nothing all the same: ${why}`}\n` : '\n  OpenKumi here sends nothing about how it is used, and its id is thrown away.\n')
    } else if (rest.length) {
      stop('Say which: “openkumi telemetry on” or “openkumi telemetry off”. Without either, it says how things stand.')
    } else {
      const answer = state ? state.settings.telemetry : settings().telemetry
      const said = answer === true ? 'On: it sends how it is used and what goes wrong, and nothing you or your bots write.' : answer === false ? 'Off: it sends nothing.' : 'Not answered yet, so nothing is sent. Answer in the app, or with “openkumi telemetry on” or “openkumi telemetry off”.'
      console.log(`\n  ${said}${can || answer === false ? '' : `\n  Whatever the answer, it sends nothing: ${why}`}\n  ${READ}\n`)
    }
  } else if (command === 'update') {
    const running = await ask<ServerUpdate>('GET', '/api/update')
    if (flag('--check')) {
      const info = await update(false)
      // Also with an earlier version in place: a look that failed has nothing to say about what is newest.
      if (info.state === 'failed' || info.error) stop(info.error)
      console.log(info.latest && newer(info.latest, VERSION) ? `\n  OpenKumi ${info.latest} is out. This is ${VERSION}. Get it with “openkumi update”.\n` : `\n  OpenKumi ${VERSION} is the newest version.\n`)
    } else if (running) {
      // The server that runs does it itself, so that it is the one that decides when to start again.
      // No answer means it went away in the middle. It may have started the new version already,
      // or it may not have got that far: which of the two is not known here, so neither is claimed.
      const gone = () => stop(`The server stopped answering while it was updating. See where it stands with “${typed('status')}”.`)
      let info = (await ask<ServerUpdate>('POST', '/api/update', { now: flag('--now') })) ?? gone()
      while (info.state === 'checking' || info.state === 'downloading') {
        await sleep(1000)
        info = (await ask<ServerUpdate>('GET', '/api/update')) ?? gone()
      }
      if (info.state === 'failed') stop(info.error)
      // An earlier version is in place, but the one asked for now could not be fetched: that is not a success.
      if (info.error) stop(`${info.error}\n  OpenKumi ${info.staged} from before is still in place, and starts once no bot is working.`)
      if (info.state !== 'ready') console.log(`\n  OpenKumi ${VERSION} is the newest version.\n`)
      else if (info.working && !flag('--now')) console.log(`\n  OpenKumi ${info.staged ?? info.latest} is in place. ${bots(info.working)} working: it starts once they are done.\n  To start it now and stop them: ${typed('update --now')}\n`)
      else console.log(`\n  OpenKumi ${info.staged ?? info.latest} is starting in place of ${VERSION}.\n`)
    } else {
      if (!RUNTIME) stop(WHY_NOT.source)
      console.log('\n  Looking for a newer version…')
      const info = await update(true)
      if (info.state === 'failed') stop(info.error)
      if (info.error) stop(`${info.error}\n  OpenKumi ${info.staged} from before is still in place: it is what “openkumi start” starts.`)
      console.log(info.state === 'ready' ? `  OpenKumi ${info.staged ?? info.latest} is in place. It is what “openkumi start” starts from now on.\n` : `  OpenKumi ${VERSION} is the newest version.\n`)
    }
  } else if (command === 'service') {
    const [what] = rest
    if (FROM_REPOSITORY) stop('Run from the repository, OpenKumi has no background service. The one on this computer is the installed OpenKumi’s: “openkumi service …” looks after it. Start this one with “npm run server”.')
    try {
      if (what === 'install') {
        // A server started by hand would hold the port the service wants.
        const { running } = service.serviceStatus()
        if (!running && (await ask('GET', '/api/update'))) stop(`${whose} is already running here, started by hand. Stop it (Ctrl-C in the terminal it runs in, which stops every server started there) and run this again.`)
        const notes = service.installService()
        console.log(`\n  ${whose} now runs in the background, and starts by itself after a restart.`)
        for (const note of notes) console.log(`  ${note}`)
        console.log(`  What it prints: ${typed('logs')}\n`)
      } else if (what === 'remove' || what === 'uninstall') {
        console.log(service.removeService() ? '\n  The background service is stopped and removed. Your bots and data are untouched.\n' : '\n  There was no background service.\n')
      } else if (what === 'status') {
        const { installed, running } = service.serviceStatus()
        console.log(`\n  The background service is ${!installed ? 'not set up' : running ? 'set up and running' : 'set up, but not running'}.\n`)
      } else stop(`Say which: “${typed('service install')}”, “${typed('service remove')}” or “${typed('service status')}”.`)
    } catch (e) {
      stop((e as Error).message)
    }
  } else if (command === 'logs') {
    const log = service.logOf()
    if (!fs.existsSync(log)) stop(`Nothing has been written to ${log} yet. A server started with “${typed('start')}” prints in its own terminal.`)
    const lines = fs.readFileSync(log, 'utf8').trimEnd().split('\n')
    console.log(lines.slice(-80).join('\n'))
    console.log(`\n  (${log})`)
  } else if (command === 'uninstall') {
    if (!RUNTIME) stop('This OpenKumi runs from the repository: there is nothing installed to remove.')
    if (named) stop(`“openkumi uninstall” removes OpenKumi from this computer, for everyone on it. To stop only ${PERSON}’s server: openkumi people remove ${PERSON}`)
    // Not while it runs: a service that could not be stopped keeps its program, which the servers of everyone here run.
    try {
      for (const person of people()) service.removeService(person.name)
    } catch (e) {
      stop((e as Error).message)
    }
    // The command people type, put beside their other programs by the installer.
    const shim = path.join(process.env.OPENKUMI_BIN || path.join(os.homedir(), '.local', 'bin'), 'openkumi')
    try {
      if (fs.readFileSync(shim, 'utf8').includes(RUNTIME)) fs.rmSync(shim)
    } catch {
      // Not there, or not ours.
    }
    fs.rmSync(RUNTIME, { recursive: true, force: true })
    console.log(`\n  OpenKumi is removed from this computer. ${several ? 'Everyone’s bots and their data' : 'Your bots and their data'} are still in ${shown(BASE)}; delete that folder to remove them too.\n`)
  } else if (command === 'people') {
    const { addPerson, codeOf, forgetPerson, helloAt, renamePerson } = await import('./people.ts')
    // The desktop app does this for the person at its window: with --json, what was done or why not is all that is printed.
    const json = flag('--json')
    const [what = 'list', given = '', other = ''] = rest.filter((word) => word !== '--json')
    const name = given.toLowerCase()
    const stop = (message: string): never => {
      if (!json) console.error(`\n  ${message}\n`)
      else console.log(JSON.stringify({ error: message.split('\n')[0] }))
      process.exit(1)
    }
    /** Says what was done to a program that asked, and ends. */
    const done = (said: object) => json && (console.log(JSON.stringify(said)), process.exit(0))
    if (named) stop('Who has bots on this computer is not one person’s business: leave out “--for”.')
    const where = (who: string) => shown(path.join(BASE, 'people', who))
    const known = () => people().find((p) => p.name === name) ?? stop(`Nobody called “${name}” has bots on this computer. See who does with “openkumi people”.`)
    /** The port a person's server listens on: the first person's may have been given another than the one written down. */
    const portOf = (person: { name: string; port: number }) => (person.name === people()[0].name ? PORT : person.port)
    try {
      if (what === 'list') {
        const list = people()
        done({ people: list })
        console.log()
        for (const person of list) {
          const running = !!(await helloAt(portOf(person)))
          const { installed } = service.serviceStatus(person.name)
          const start = `${RUNTIME ? 'openkumi' : 'npm run openkumi --'} start${person === list[0] ? '' : ` --for ${person.name}`}`
          const how = running ? (installed ? 'running, as a background service' : 'running') : installed ? `stopped: see “openkumi logs${person === list[0] ? '' : ` --for ${person.name}`}”` : `not running: “${start}”`
          console.log(`  ${person.name.padEnd(Math.max(...list.map((p) => p.name.length)))}   port ${portOf(person)}   ${how}`)
        }
        console.log(`\n  ${list.length > 1 ? `Each has bots of their own, apart from the others’. A command is about ${list[0].name}’s server, or about another’s with “--for <name>” after it.` : `“openkumi people add <name>” gives someone else bots of their own on this computer, apart from ${list[0].name}’s.`}\n`)
      } else if (what === 'add') {
        if (!given) stop('Say who: “openkumi people add <name>”.')
        const person = await addPerson(given)
        // A program that asked starts the server itself, unless it is kept running by a service here.
        if (json && RUNTIME) service.installService(person.name)
        done({ person })
        const at = { port: person.port }
        console.log(`\n  ${person.name} now has a server of their own on this computer, on port ${at.port}.`)
        console.log(`  Its bots, conversations and settings are apart from everyone else’s, in ${where(person.name)}.`)
        console.log('  Its bots run on what this computer is signed in to (Claude Code, Codex, Grok), as everyone’s here do.')
        if (!RUNTIME) {
          console.log(`\n  It starts with everyone’s the next time “npm run server” is run. To start it by itself now:`)
          console.log(`      npm run openkumi -- start --for ${person.name}`)
          console.log(`  Then a code for their app:  npm run openkumi -- pair --for ${person.name}\n`)
        } else {
          let notes: string[] = []
          try {
            notes = service.installService(person.name)
          } catch (e) {
            stop(`${(e as Error).message}\n  Start it by hand with “openkumi start --for ${person.name}”, or try the service again with “openkumi service install --for ${person.name}”.`)
          }
          console.log('  It runs in the background, and starts by itself after a restart.')
          for (const note of notes) console.log(`  ${note}`)
          // Its access code is made when it first listens, which takes a moment.
          let code: string | null = null
          for (let tries = 0; tries < 60 && !code; tries++) {
            await sleep(500)
            if (await helloAt(at.port)) code = codeOf(person.name)
          }
          const said = code ? await ask<{ code: string }>('POST', '/api/pairing', undefined, { ...at, code }) : null
          if (!said) console.log(`\n  It has not answered yet: see “openkumi logs --for ${person.name}”. Once it runs, a code for their app: openkumi pair --for ${person.name}\n`)
          else {
            showCode(said.code, at.port)
            console.log('\n  In the OpenKumi app on their computer: Settings > Environments > Add environment. On their phone, the app asks for both.')
            console.log(`  The code works once, for the next 10 minutes. For another: openkumi pair --for ${person.name}\n`)
          }
        }
      } else if (what === 'remove') {
        if (!given) stop('Say who: “openkumi people remove <name>”.')
        const person = known()
        // Whoever is first is the one a command with no name is about, the one this computer's own app shows, and the one the ports given by hand are for. That does not pass to someone else.
        if (person.name === people()[0].name) stop(`${person.name} is the first person here, whom a command with no name is about, and is not removed. They can be given another name: “openkumi people rename ${person.name} <new name>”. “openkumi uninstall” removes OpenKumi from this computer.`)
        // Not from under a server that nothing here can stop: it would go on with their data, off the list.
        const { installed } = service.serviceStatus(person.name)
        if (!installed && (await helloAt(person.port))) stop(`${person.name}’s server is running, started by hand. Stop it (Ctrl-C in the terminal it runs in, which stops every server started there) and run this again.`)
        // A service is stopped first. One that could not be stopped stays set up, with its person on the list: this throws then.
        if (installed) service.removeService(person.name)
        try {
          forgetPerson(person.name)
        } catch (e) {
          // Something else still has their data open (a server started by hand beside the service): they stay, and so does their service.
          if (installed && RUNTIME) service.installService(person.name)
          throw e
        }
        done({ removed: person.name })
        console.log(`\n  ${person.name}’s server is stopped, and no longer starts by itself.`)
        console.log(`  What it held is still in ${where(person.name)}. Adding ${person.name} again carries on with it; deleting that folder removes it for good.\n`)
      } else if (what === 'rename') {
        if (!given || !other) stop('Say who, and what they are called from now on: “openkumi people rename <name> <new name>”.')
        const person = known()
        const first = person.name === people()[0].name
        const { installed } = service.serviceStatus(person.name)
        // Its folder cannot move while it is open. A service is stopped for it and set up again under the new name; a server that nothing here can stop is left alone, and so is its folder (people.ts looks again once the service has stopped).
        if (!installed && (await helloAt(portOf(person)))) stop(`${person.name}’s server is running, started by hand. Stop it (Ctrl-C in the terminal it runs in, which stops every server started there) and run this again.`)
        if (installed) service.removeService(person.name)
        let now = person.name
        try {
          now = renamePerson(person.name, other).name
        } finally {
          // Also when the new name was refused: the service that was stopped for it runs again.
          if (installed && RUNTIME) service.installService(now)
        }
        done({ renamed: now })
        console.log(`\n  ${person.name} is called ${now} from now on, and their data is in ${where(now)}.`)
        console.log(`  The computers and phones paired with their server stay paired.${first ? '' : ` Commands about it end in “--for ${now}”.`}\n`)
      } else stop('Say which: “openkumi people”, “openkumi people add <name>”, “openkumi people remove <name>” or “openkumi people rename <name> <new name>”.')
    } catch (e) {
      stop((e as Error).message)
    }
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
