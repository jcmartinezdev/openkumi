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
import { RESTART, RUNTIME } from './update.ts'

/** The program a server is started with: the version that is current now, when OpenKumi was installed on its own; this one, from the repository. */
const program = (): [string, string] => (RUNTIME ? [path.join(RUNTIME, 'current', 'node'), path.join(RUNTIME, 'current', 'server', 'src', 'index.ts')] : [process.execPath, path.join(import.meta.dirname, 'index.ts')])

/**
 * Runs a server for each of `names` until all of them have stopped, and resolves with the code to
 * end with: that of the first one that ended badly, or 0. `args` is passed on to each.
 */
export function startServers(names: string[], args: string[]): Promise<number> {
  const running = new Map<string, ChildProcess>()
  let stopping = false
  let code = 0
  return new Promise((resolve) => {
    const done = () => running.size || resolve(code)
    /** Shows what a server prints, a line at a time, under its person's name. */
    const shown = (name: string, to: NodeJS.WriteStream) => {
      let rest = ''
      return (chunk: Buffer) => {
        const lines = (rest + chunk).split('\n')
        rest = lines.pop()!
        for (const line of lines) to.write(`${name} | ${line}\n`)
      }
    }
    const start = (name: string) => {
      const [node, server] = program()
      // One server is as it always was: its own output, as it prints it.
      const child = spawn(node, [server, '--for', name, ...args], { stdio: names.length > 1 ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
      running.set(name, child)
      child.stdout?.on('data', shown(name, process.stdout))
      child.stderr?.on('data', shown(name, process.stderr))
      // It could not be started at all: nothing more comes from it.
      child.once('error', (e) => {
        console.error(`${name} | ${e.message}`)
        if (running.get(name) !== child) return
        running.delete(name)
        code ||= 1
        done()
      })
      child.once('close', (ended, signal) => {
        if (running.get(name) !== child) return
        running.delete(name)
        // It stopped to update: the start that follows is the new version.
        if (ended === RESTART && !stopping) return start(name)
        if (ended && !stopping) {
          code ||= ended
          if (names.length > 1) console.error(`${name} | This server has stopped (${signal ?? ended}). The others go on.`)
        }
        done()
      })
    }
    // Asked to stop, each server winds its bots down and closes its data; this ends when all have.
    const stop = () => {
      stopping = true
      for (const child of running.values()) child.kill('SIGTERM')
      done()
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
    names.forEach(start)
  })
}
