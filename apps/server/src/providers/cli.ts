// Helpers for providers that drive an agent program installed on this computer.
import { type ChildProcess, type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { settings } from '../settings.ts'

const WINDOWS = process.platform === 'win32'
/** The endings a program's file can have on Windows, in the order they are tried. */
const ENDINGS = ['.exe', '.cmd', '.bat']

const isFile = (file: string) => {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/**
 * The program at this path. On Windows a program's file has an ending the name it goes by leaves
 * out (claude.exe, codex.cmd), and a file with no ending is not one: npm puts a script for other
 * systems beside its launcher there, under the bare name.
 */
function programAt(file: string): string | null {
  if (!WINDOWS) return fs.existsSync(file) ? file : null
  if (ENDINGS.includes(path.extname(file).toLowerCase())) return isFile(file) ? file : null
  return ENDINGS.map((ending) => file + ending).find(isFile) ?? null
}

/** The folders of the PATH, then the ones programs are usually installed in, which an app opened from the Dock or the Start menu may not have on it. */
function folders(name: string): string[] {
  const home = os.homedir()
  const own = [path.join(home, '.local', 'bin'), path.join(home, `.${name}`, 'bin'), path.join(home, `.${name}`, 'local')]
  // Windows lets a folder on the PATH be written in quotes.
  const onPath = (process.env.PATH ?? '').split(path.delimiter).map((dir) => (WINDOWS ? dir.trim().replace(/^"|"$/g, '') : dir))
  if (!WINDOWS) return [...onPath, '/opt/homebrew/bin', '/usr/local/bin', ...own]
  const { APPDATA, LOCALAPPDATA } = process.env
  // Where npm and WinGet put what they install.
  return [...onPath, ...own, ...(APPDATA ? [path.join(APPDATA, 'npm')] : []), ...(LOCALAPPDATA ? [path.join(LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links')] : [])]
}

/** Where the program is: an override variable, then the path from Settings, then the PATH and the usual install folders. */
export function findBinary(name: string, override: string, configured = ''): string | null {
  const given = process.env[override] || configured.replace(/^~(?=[/\\])/, os.homedir())
  if (given) return programAt(given)
  for (const dir of folders(name)) {
    const found = dir && programAt(path.join(dir, name))
    if (found) return found
  }
  return null
}

/**
 * What is started for a program, with what goes before its own arguments. Everywhere but on
 * Windows that is the program itself. On Windows, a program installed with npm is a launcher
 * script (claude.cmd, codex.cmd), and a script is only ever run by the command prompt, which
 * ends an argument at its first line break and gives `%` and `"` meanings of its own: a bot's
 * instructions would not survive it. So the script is read for what it starts (the program
 * itself, or Node with the program's script) and that is started in its place.
 */
export function launcher(bin: string, read: (file: string) => string = (file) => fs.readFileSync(file, 'utf8'), at = programAt, lookUp = (name: string) => findBinary(name, '')): string[] {
  if (!/\.(cmd|bat)$/i.test(bin)) return [bin]
  const unreadable = () => new Error(`${bin} is a launcher script OpenKumi cannot follow. Give the path of the program it starts in Settings, under Providers.`)
  const dir = path.win32.dirname(bin)
  /** A word of the script with the script's own folder filled in (%~dp0, or the %dp0% npm sets to it). */
  const filled = (word: string) => (/%~dp0|%dp0%/i.test(word) ? path.win32.normalize(word.replace(/%~dp0|%dp0%/gi, dir + '\\')) : word)
  let text: string
  try {
    text = read(bin)
  } catch {
    throw unreadable()
  }
  // The line that passes the arguments on is the one that starts the program: `"<program>" %*`,
  // or `"<node>" "<script>" %*`, at the end of whatever else that line does.
  const line = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => /%\*$/.test(l)).pop()
  const words = [...(line?.split('&').pop()?.replace(/^\s*@/, '').matchAll(/"([^"]*)"|(\S+)/g) ?? [])].map((m) => m[1] ?? m[2]).slice(0, -1)
  if (!words.length) throw unreadable()
  // npm names the program in a variable: the Node beside the script if there is one, or else the one on the PATH.
  const named = words[0] === '%_prog%' ? [...text.matchAll(/SET "_prog=([^"]+)"/gi)].map((m) => m[1]) : [words[0]]
  let program: string | null = null
  for (const name of named.map(filled)) {
    program = /[\\/]/.test(name) ? at(name) : lookUp(name)
    if (program) break
  }
  if (!program || /\.(cmd|bat)$/i.test(program)) throw unreadable()
  return [program, ...words.slice(1).map(filled)]
}

/**
 * The environment for a program OpenKumi starts. Variables that mark this process as running
 * inside another agent session are left out, so the program behaves as if a person had started it.
 */
export function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDE_EFFORT$|CLAUDE_PID$|AI_AGENT$|CODEX_SANDBOX|CODEX_THREAD)/.test(key)) env[key] = value
  }
  return { ...env, ...extra }
}

/** Runs a short command and returns what it printed. Never throws: a missing program is exit code -1. */
export function capture(bin: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let file: string
    let first: string[]
    try {
      ;[file, ...first] = launcher(bin)
    } catch (e) {
      return resolve({ code: -1, stdout: '', stderr: (e as Error).message })
    }
    execFile(file, [...first, ...args], { env: cleanEnv(), timeout: 20_000, windowsHide: true }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as any).code === 'number' ? (error as any).code : -1) : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

/** The version a program says it is ("codex-cli 0.166.0" gives "0.166.0"), or an empty string. */
export async function versionOf(bin: string): Promise<string> {
  const { stdout } = await capture(bin, ['--version'])
  return stdout.match(/\d+\.\d+(?:\.\d+)?[\w.-]*/)?.[0] ?? ''
}

/**
 * Starts a program with its input and output open to the caller. What it writes to its error
 * output is kept for the caller too, unless that is left out.
 */
export function start(bin: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; errors?: 'ignore' }): ChildProcessWithoutNullStreams {
  const [file, ...first] = launcher(bin)
  // On Windows a program started from one without a window of its own would open a console.
  return spawn(file, [...first, ...args], { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', opts.errors ?? 'pipe'], windowsHide: true }) as ChildProcessWithoutNullStreams
}

/**
 * Ends a program. On Windows the programs it started in turn (a launcher's Node starts the real
 * one) are ended with it, which there does not follow by itself.
 */
export function end(proc: ChildProcess) {
  if (WINDOWS && proc.pid) execFile('taskkill', ['/pid', String(proc.pid), '/t', '/f'], { windowsHide: true }, (error) => error && proc.kill())
  else proc.kill('SIGTERM')
}

export interface Exit {
  code: number | null
  /** The end of what the program wrote to its error output, for error messages. */
  stderr: string
}

/** A program's input, for one that is written to again after it has started. */
export interface Pipe {
  /** Writes to it; false when it no longer takes anything. */
  write(text: string): boolean
  end(): void
}

/**
 * Starts a program, feeds it `input`, and yields each line it prints. `exit` is filled in when it
 * ends. The program is stopped when the signal fires or the caller stops reading. With `open`, its
 * input is left open after `input` and handed over, for the caller to write more and to end.
 */
export async function* lines(
  bin: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; input: string; signal: AbortSignal; open?: (pipe: Pipe) => void },
  exit: Exit,
): AsyncGenerator<string> {
  const proc = start(bin, args, { cwd: opts.cwd, env: opts.env })
  const ended = new Promise<number | null>((resolve) => {
    proc.on('close', (code) => resolve(code))
    proc.on('error', (e) => {
      exit.stderr += String(e.message)
      resolve(-1)
    })
  })
  const stop = () => end(proc)
  opts.signal.addEventListener('abort', stop, { once: true })
  proc.stderr.on('data', (d) => (exit.stderr = (exit.stderr + String(d)).slice(-4000)))
  proc.stdin.on('error', () => {})
  if (opts.open) {
    const write = (text: string) => proc.stdin.writable && (proc.stdin.write(text), true)
    if (opts.input) write(opts.input)
    opts.open({ write, end: () => void proc.stdin.end() })
  } else proc.stdin.end(opts.input)
  try {
    for await (const line of readline.createInterface({ input: proc.stdout })) {
      // Shows everything an engine prints, for working out why a turn went wrong.
      if (process.env.OPENKUMI_DEBUG || settings().debugEngines) console.error(`[${path.basename(bin)}] ${line.slice(0, 1500)}`)
      yield line
    }
    exit.code = await ended
  } finally {
    opts.signal.removeEventListener('abort', stop)
    if (proc.exitCode === null && proc.signalCode === null) stop()
  }
}

/** The last meaningful line a program wrote to its error output. */
export function lastError(exit: Exit, fallback: string): string {
  const line = exit.stderr.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)
  return line ? line.replace(/^\S+Z\s+ERROR\s+\S+:\s*/, '').slice(0, 400) : fallback
}
