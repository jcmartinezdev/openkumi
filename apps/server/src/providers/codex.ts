// Codex as an engine. Open Bot starts the user's own installed `codex` program for each turn; it
// is signed in with the user's own ChatGPT account, runs the model-and-tools loop itself, and
// reaches the bot's tools over MCP. Its command and file tools are switched off and its sandbox
// is read-only, so the bot can do exactly what it could do on Open Bot's own loop.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ProviderInfo } from '@openbot/shared'
import { type Exit, capture, cleanEnv, findBinary, lastError, lines } from './cli.ts'
import { settings } from '../settings.ts'
import type { ModelEvent, Provider, TurnRequest } from './types.ts'

const bin = () => findBinary('codex', 'OPENBOT_CODEX_BIN', settings().codexPath)
const base = { id: 'codex', name: 'Codex', kind: 'cli' as const }
let info: ProviderInfo = { ...base, connected: false, detail: 'Checking…' }

async function refresh() {
  const program = bin()
  if (!program) {
    const missing = settings().codexPath
    info = missing
      ? { ...base, connected: false, detail: 'Not found', hint: `There is no program at ${missing}. Correct the path, or clear it to have Codex looked up.` }
      : { ...base, connected: false, detail: 'Not installed', hint: 'Install the Codex CLI on this computer, then run “codex login” in a terminal.' }
    return
  }
  const { code, stdout, stderr } = await capture(program, ['login', 'status'])
  const said = (stdout + stderr).trim().split('\n')[0] ?? ''
  if (code !== 0 || /not logged in/i.test(said)) {
    info = { ...base, connected: false, detail: 'Installed, not signed in', hint: 'Run “codex login” in a terminal on this computer.', path: program }
    return
  }
  info = { ...base, connected: true, detail: said.replace(/^Logged in using /i, 'Signed in with ') || 'Signed in', path: program }
}

/** Everything in Codex that runs commands, touches files, drives apps or starts its own agents. */
const SWITCHED_OFF = [
  'shell_tool', 'unified_exec', 'view_image', 'multi_agent', 'plugins', 'apps', 'browser_use', 'computer_use',
  'image_generation', 'hooks', 'skill_search', 'sleep_tool', 'goals', 'tool_suggest', 'workspace_dependencies',
]

// Config values are TOML; a JSON string is also a valid TOML string.
const toml = (value: string) => JSON.stringify(value)

async function* turn(req: TurnRequest): AsyncGenerator<ModelEvent> {
  const program = bin()
  if (!program) throw new Error('Codex is not installed on this computer.')
  const instructions =
    `${req.instructions}\n\n` +
    'Your tools come from Open Bot (the "openbot" tools). For subagents use spawn_subagent and wait_subagents from ' +
    'Open Bot, not any collaboration tool of your own. You cannot run commands or read files except through those tools.'
  const args = [
    'exec',
    ...(req.session ? ['resume', req.session] : []),
    '--json',
    '--skip-git-repo-check',
    // Leave out the user's own Codex setup: their MCP servers, plugins and instructions.
    '--ignore-user-config',
    ...SWITCHED_OFF.flatMap((feature) => ['--disable', feature]),
    '-c', 'sandbox_mode="read-only"',
    '-c', 'approval_policy="never"',
    '-c', `developer_instructions=${toml(instructions)}`,
    // Open Bot passes the bot's AGENTS.md itself, fresh on every turn.
    '-c', 'project_doc_max_bytes=0',
    // Codex has its own skills (and finds the user's); the bot's skills are the ones in its instructions.
    '-c', 'skills.include_instructions=false',
    '-c', 'skills.bundled.enabled=false',
    '-c', `mcp_servers.openbot.url=${toml(req.toolsUrl)}`,
    '-c', 'mcp_servers.openbot.tool_timeout_sec=1900',
    // Nobody is there to approve a tool call, and Open Bot's tools are the ones the owner chose.
    '-c', 'mcp_servers.openbot.default_tools_approval_mode="approve"',
    '-c', `web_search=${toml(req.webSearch ? 'live' : 'disabled')}`,
  ]
  if (req.model && req.model !== 'default') args.push('-m', req.model)
  if (req.effort) args.push('-c', `model_reasoning_effort=${toml(req.effort)}`)
  args.push('-') // the message comes on standard input

  const exit: Exit = { code: null, stderr: '' }
  let finished = false
  for await (const line of lines(program, args, { cwd: req.cwd, env: cleanEnv(), input: req.input, signal: req.signal }, exit)) {
    let ev: any
    try {
      ev = JSON.parse(line)
    } catch {
      continue
    }
    if (ev.type === 'thread.started' && ev.thread_id) {
      yield { type: 'session', id: ev.thread_id }
    } else if (ev.type === 'item.completed') {
      const item = ev.item ?? {}
      if (item.type === 'agent_message' && item.text?.trim()) yield { type: 'item', item: { type: 'message', role: 'assistant', text: item.text } }
      else if (item.type === 'reasoning' && item.text?.trim()) yield { type: 'item', item: { type: 'reasoning', summary: item.text } }
      else if (item.type === 'web_search') yield { type: 'item', item: { type: 'web_search_call', action: { query: item.query } } }
      // Calls to Open Bot's own tools are recorded where they are carried out (tool-endpoint.ts).
    } else if (ev.type === 'turn.completed') {
      finished = true
    } else if (ev.type === 'turn.failed' || ev.type === 'error') {
      throw new Error(String(ev.error?.message ?? ev.message ?? 'Codex reported an error').slice(0, 600))
    }
  }
  if (req.signal.aborted) return
  if (!finished) throw new Error(`Codex stopped unexpectedly: ${lastError(exit, `exit code ${exit.code}`)}`)
}

/** The models Codex itself offers, from the list it keeps in its own folder. Empty when it has none yet. */
function listed(): string[] {
  try {
    const file = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'models_cache.json')
    const models: { slug?: string; visibility?: string; priority?: number }[] = JSON.parse(fs.readFileSync(file, 'utf8')).models ?? []
    return models
      .filter((m) => m.slug && m.visibility !== 'hide')
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((m) => m.slug!)
  } catch {
    return []
  }
}

export const codex: Provider = {
  id: base.id,
  info: () => info,
  models: async () => ['default', ...listed()],
  turn,
  refresh,
}
