// Claude Code as an engine. Open Bot starts the user's own installed `claude` program for each
// turn; it is signed in with the user's own account, runs the model-and-tools loop itself, and
// reaches the bot's tools over MCP. All of its built-in tools are switched off, so the bot can do
// exactly what it could do on Open Bot's own loop and nothing more.
import { spawn } from 'node:child_process'
import os from 'node:os'
import readline from 'node:readline'
import type { ModelInfo, ProviderInfo } from '@openbot/shared'
import { type Exit, capture, cleanEnv, findBinary, lastError, lines, versionOf } from './cli.ts'
import { settings } from '../settings.ts'
import { type ModelEvent, type Provider, type TurnRequest, efforts } from './types.ts'

const bin = () => findBinary('claude', 'OPENBOT_CLAUDE_BIN', settings().claudePath)
const base = { id: 'claude-code', name: 'Claude Code', kind: 'cli' as const }
let info: ProviderInfo = { ...base, connected: false, detail: 'Checking…' }

/** What is offered when the program cannot be asked: the names that always point at the current model of each kind. */
const USUAL: ModelInfo[] = [
  { id: 'default', name: 'Default' },
  { id: 'opus', name: 'Claude Opus' },
  { id: 'sonnet', name: 'Claude Sonnet' },
  { id: 'haiku', name: 'Claude Haiku' },
]
let models = USUAL
let askedAt = 0
/** The question to the program that is under way, if one is. */
let asking: Promise<void> | null = null

/** One model as Claude Code describes it to its own apps. */
interface Offered {
  value: string
  resolvedModel?: string
  displayName?: string
  description?: string
  supportedEffortLevels?: string[]
}

/**
 * Asks the program which models it offers, the way its own apps do: it is started as for a
 * conversation and sent a question about itself in place of a message. Nothing goes to a model.
 */
function askModels(program: string): Promise<ModelInfo[] | null> {
  return new Promise((resolve) => {
    const proc = spawn(program, ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--setting-sources', ''], {
      cwd: os.tmpdir(),
      env: cleanEnv({ DISABLE_AUTOUPDATER: '1' }),
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    let answered = false
    const answer = (found: ModelInfo[] | null) => {
      if (answered) return
      answered = true
      clearTimeout(late)
      proc.kill('SIGTERM')
      resolve(found)
    }
    const late = setTimeout(() => answer(null), 20_000)
    proc.on('error', () => answer(null))
    proc.on('close', () => answer(null))
    proc.stdin.on('error', () => {})
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      try {
        const event = JSON.parse(line)
        if (event.type === 'control_response') answer(named(event.response?.response?.models))
      } catch {
        // Not a line of its protocol.
      }
    })
    proc.stdin.write(JSON.stringify({ type: 'control_request', request_id: 'models', request: { subtype: 'initialize' } }) + '\n')
  })
}

/** Turns the program's own list into Open Bot's: one entry per model, the default first, earlier models marked. */
function named(offered: unknown): ModelInfo[] | null {
  if (!Array.isArray(offered) || !offered.length) return null
  const list = offered as Offered[]
  const one = (m: Offered, id = m.value): ModelInfo => {
    const levels = efforts(m.supportedEffortLevels ?? [])
    return { id, name: `Claude ${m.displayName ?? m.value}`, ...(m.description ? { description: m.description } : {}), efforts: levels }
  }
  // "default" is a role, not a model: it is shown as the model it stands for.
  const usual = list.find((m) => m.value === 'default')
  const stands = usual && list.find((m) => m !== usual && m.resolvedModel === usual.resolvedModel)
  const out: ModelInfo[] = [usual ? (stands ? one(stands, 'default') : { ...one(usual), name: 'Default' }) : { id: 'default', name: 'Default' }]
  const seen = new Set([usual?.resolvedModel])
  /** Opus, Sonnet, Haiku…: a second model of a kind is an earlier one. */
  const kinds = new Set([stands?.displayName?.split(' ')[0]])
  for (const m of list) {
    if (m === usual || seen.has(m.resolvedModel ?? m.value)) continue
    seen.add(m.resolvedModel ?? m.value)
    const kind = (m.displayName ?? m.value).split(' ')[0]
    out.push({ ...one(m), ...(kinds.has(kind) ? { older: true } : {}) })
    kinds.add(kind)
  }
  return out
}

async function refresh() {
  const program = bin()
  if (!program) {
    const missing = settings().claudePath
    info = missing
      ? { ...base, connected: false, detail: 'Not found', hint: `There is no program at ${missing}. Correct the path, or clear it to have Claude Code looked up.` }
      : { ...base, connected: false, detail: 'Not installed', hint: 'Install Claude Code on this computer, then run “claude” in a terminal and sign in.' }
    return
  }
  const version = await versionOf(program)
  const { stdout } = await capture(program, ['auth', 'status'])
  let status: Record<string, any> = {}
  try {
    status = JSON.parse(stdout)
  } catch {}
  if (!status.loggedIn) {
    info = { ...base, connected: false, detail: 'Installed, not signed in', hint: 'Run “claude” in a terminal on this computer and sign in.', path: program, version }
    return
  }
  const plan = status.subscriptionType ? `${String(status.subscriptionType).replace(/^./, (c) => c.toUpperCase())} plan` : 'API key'
  // Asking for the models starts the program, so it is not done on every look: the list changes rarely.
  if (Date.now() - askedAt > 10 * 60_000) {
    askedAt = Date.now()
    asking = askModels(program)
      .then((found) => void (models = found ?? models))
      .finally(() => (asking = null))
  }
  info = { ...base, connected: true, detail: [status.email, plan].filter(Boolean).join(' · '), path: program, version }
}

async function* turn(req: TurnRequest): AsyncGenerator<ModelEvent> {
  const program = bin()
  if (!program) throw new Error('Claude Code is not installed on this computer.')
  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--system-prompt', req.instructions,
    // The instructions are rebuilt every turn (the bot edits them), so they must not be frozen at the first one.
    '--system-prompt-snapshot', 'off',
    // No built-in tools: no commands, no files, no fetching. Web search runs on Anthropic's side.
    '--tools', req.webSearch ? 'WebSearch' : '',
    '--mcp-config', JSON.stringify({ mcpServers: { openbot: { type: 'http', url: req.toolsUrl } } }),
    '--strict-mcp-config',
    '--allowedTools', req.webSearch ? 'mcp__openbot,WebSearch' : 'mcp__openbot',
    // Nobody is there to answer a permission prompt; anything not allowed above is refused.
    '--permission-prompts', 'none',
    // Leave out everything from the user's own Claude Code setup: settings, CLAUDE.md, skills, plugins.
    '--restricted',
    '--setting-sources', '',
    '--disable-slash-commands',
  ]
  if (req.session) args.push('--resume', req.session)
  if (req.model && req.model !== 'default') args.push('--model', req.model)
  if (req.effort) args.push('--effort', req.effort)

  // Tool calls such as wait_subagents can take a long time; the tool list is small enough to send whole.
  const env = cleanEnv({ MCP_TOOL_TIMEOUT: '1900000', MCP_TIMEOUT: '30000', ENABLE_TOOL_SEARCH: 'false', DISABLE_AUTOUPDATER: '1' })
  const exit: Exit = { code: null, stderr: '' }
  const emitted = new Set<string>()
  let finished = false

  for await (const line of lines(program, args, { cwd: req.cwd, env, input: req.input, signal: req.signal }, exit)) {
    let ev: any
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) {
      yield { type: 'session', id: ev.session_id }
    } else if (ev.type === 'stream_event' && ev.event?.type === 'content_block_delta' && !ev.parent_tool_use_id) {
      const delta = ev.event.delta
      if (delta?.type === 'text_delta' && delta.text) yield { type: 'text_delta', delta: delta.text }
      else if (delta?.type === 'thinking_delta' && delta.thinking) yield { type: 'reasoning_delta', delta: delta.thinking }
    } else if (ev.type === 'assistant' && !ev.parent_tool_use_id && !ev.error) {
      // Each part of a reply (a thought, some text, a tool call) arrives as its own event.
      if (ev.uuid && emitted.has(ev.uuid)) continue
      emitted.add(ev.uuid)
      for (const block of ev.message?.content ?? []) {
        if (block.type === 'text' && block.text?.trim()) yield { type: 'item', item: { type: 'message', role: 'assistant', text: block.text } }
        else if (block.type === 'thinking' && block.thinking?.trim()) yield { type: 'item', item: { type: 'reasoning', summary: block.thinking } }
        else if (block.type === 'tool_use' && block.name === 'WebSearch') yield { type: 'item', item: { type: 'web_search_call', action: { query: block.input?.query } } }
        // Calls to Open Bot's own tools are recorded where they are carried out (tool-endpoint.ts).
      }
    } else if (ev.type === 'result') {
      finished = true
      if (ev.is_error) throw new Error(String(ev.result || ev.errors?.join?.('; ') || ev.subtype || 'Claude Code reported an error').slice(0, 600))
    }
  }
  if (req.signal.aborted) return
  if (!finished) throw new Error(`Claude Code stopped unexpectedly: ${lastError(exit, `exit code ${exit.code}`)}`)
}

export const claudeCode: Provider = {
  id: base.id,
  info: () => info,
  // Whoever asks while the program is being asked waits for its answer rather than getting the stand-in list.
  models: async () => (await asking, models),
  turn,
  refresh,
}
