// `openkumi start`: the servers of the people here, run in this terminal. Each person's server
// is a process of its own (index.ts, started with `--for <name>`), so that one of them falling
// over does not take the others with it. What each prints is shown under its person's name when
// there are several. A server that stops to update (update.ts) is started again here, in the
// version that is current then; one that stops for any other reason is left stopped, and says
// so. Ctrl-C stops them all.
//
// A background service (service.ts) and the desktop app each run one server per person
// themselves, and do not come through here.
import { type ChildProcess, spawn } from 'node:child_process'
import path from 'node:path'
import { homeOf, openElsewhere } from './config.ts'
import { RESTART, RUNTIME } from './update.ts'

/** The program a server is started with: the version that is current now, when OpenKumi was installed on its own; this one, from the repository. */
const program = (): [string, string] => (RUNTIME ? [path.join(RUNTIME, 'current', 'node'), path.join(RUNTIME, 'current', 'server', 'src', 'index.ts')] : [process.execPath, path.join(import.meta.dirname, 'index.ts')])

/** How long a server that was asked to stop is given to wind its bots down and close their browsers, before it is ended anyway. */
const PATIENCE = 20_000

/**
 * Runs a server for each of `names` until all of them have stopped, and resolves with the code to
 * end with: that of the first one that ended badly, or 0. `args` is passed on to each.
 */
export function startServers(names: string[], args: string[]): Promise<number> {
  const running = new Map<string, ChildProcess>()
  const several = names.length > 1
  let stopping = false
  let code = 0
  /** Still going through the names for the first time: none of them being left out means that all are done. */
  let launching = true
  return new Promise((resolve) => {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
    const done = () => {
      if (launching || running.size) return
      for (const signal of signals) process.off(signal, stop)
      resolve(code)
    }
    /** Says something about a person's server, under their name when there are several. */
    const say = (name: string, text: string) => console.error(several ? `${name} | ${text}` : `\n  ${text}\n`)
    /** Shows what a server prints, a line at a time, under its person's name; `end` shows what it left without ending the line. */
    const shown = (name: string, to: NodeJS.WriteStream) => {
      let rest = ''
      return {
        take(chunk: Buffer) {
          const lines = (rest + chunk).split('\n')
          rest = lines.pop()!
          for (const line of lines) to.write(`${name} | ${line}\n`)
        },
        end() {
          if (rest) to.write(`${name} | ${rest}\n`)
          rest = ''
        },
      }
    }
    const start = (name: string) => {
      // Someone whose server already runs here (as a background service, say) is left to that: a second one is never started on their data.
      // (A database that cannot be opened is not taken for one in use: its server is started, and says what is wrong with it.)
      if (openElsewhere(path.join(homeOf(name), 'openkumi.db'), false)) {
        say(name, `${several ? 'Their' : `${name}’s`} server is already running on this computer, and is left as it is.`)
        return done()
      }
      const [node, server] = program()
      // One server is as it always was: its own output, as it prints it.
      const child = spawn(node, [server, '--for', name, ...args], { stdio: several ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
      running.set(name, child)
      const [out, err] = [shown(name, process.stdout), shown(name, process.stderr)]
      child.stdout?.on('data', out.take)
      child.stderr?.on('data', err.take)
      // It could not be started at all: nothing more comes from it.
      child.once('error', (e) => {
        say(name, e.message)
        if (running.get(name) !== child) return
        running.delete(name)
        code ||= 1
        done()
      })
      child.once('close', (ended, signal) => {
        out.end()
        err.end()
        if (running.get(name) !== child) return
        running.delete(name)
        // It stopped to update: the start that follows is the new version.
        if (ended === RESTART && !stopping) return start(name)
        // Ended by itself, with something wrong or by a signal that was not this one's doing.
        if ((ended !== 0 || signal) && !stopping) {
          code ||= ended ?? 1
          // One server says itself why it ends, unless it was ended from outside.
          if (several) say(name, `This server has stopped (${signal ?? ended}). The others go on.`)
          else if (signal) say(name, `The server was ended (${signal}).`)
        }
        done()
      })
    }
    /**
     * Asked to stop, each server winds its bots down and closes its data; this ends when all have.
     * Asked again, or still there after a while (closing a bot's browser can hang), they are ended anyway.
     */
    function stop() {
      const again = stopping
      stopping = true
      for (const child of running.values()) child.kill(again ? 'SIGKILL' : 'SIGTERM')
      if (!again) setTimeout(() => running.forEach((child) => child.kill('SIGKILL')), PATIENCE).unref()
      done()
    }
    // Also when the terminal is closed: the servers stop with it, closing their data, not left behind without it.
    for (const signal of signals) process.on(signal, stop)
    names.forEach(start)
    launching = false
    // Everyone's server was running already, or none could be started.
    done()
  })
}
