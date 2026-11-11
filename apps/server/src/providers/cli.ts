// Helpers for providers that drive an agent program installed on this computer.
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { settings } from '../settings.ts'

/** Where the program is: an override variable, then the path from Settings, then the PATH and the usual install folders. */
export function findBinary(name: string, override: string, configured = ''): string | null {
  const given = process.env[override] || configured.replace(/^~(?=\/)/, os.homedir())
  if (given) return fs.existsSync(given) ? given : null
  const dirs = [
    ...(process.env.PATH ?? '').split(path.delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), `.${name}`, 'bin'),
    path.join(os.homedir(), `.${name}`, 'local'),
  ]
  for (const dir of dirs) {
    const candidate = dir && path.join(dir, name)
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  return null
}

/**
 * The environment for a program Open Bot starts. Variables that mark this process as running
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
    execFile(bin, args, { env: cleanEnv(), timeout: 20_000 }, (error, stdout, stderr) => {
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

export interface Exit {
  code: number | null
  /** The end of what the program wrote to its error output, for error messages. */
  stderr: string
}

/**
 * Starts a program, feeds it `input`, and yields each line it prints. `exit` is filled in when it
 * ends. The program is stopped when the signal fires or the caller stops reading.
 */
export async function* lines(
  bin: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; input: string; signal: AbortSignal },
  exit: Exit,
): AsyncGenerator<string> {
  const proc = spawn(bin, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] })
  const ended = new Promise<number | null>((resolve) => {
    proc.on('close', (code) => resolve(code))
    proc.on('error', (e) => {
      exit.stderr += String(e.message)
      resolve(-1)
    })
  })
  const stop = () => proc.kill('SIGTERM')
  opts.signal.addEventListener('abort', stop, { once: true })
  proc.stderr.on('data', (d) => (exit.stderr = (exit.stderr + String(d)).slice(-4000)))
  proc.stdin.on('error', () => {})
  proc.stdin.end(opts.input)
  try {
    for await (const line of readline.createInterface({ input: proc.stdout })) {
      // Shows everything an engine prints, for working out why a turn went wrong.
      if (process.env.OPENBOT_DEBUG || settings().debugEngines) console.error(`[${path.basename(bin)}] ${line.slice(0, 1500)}`)
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
