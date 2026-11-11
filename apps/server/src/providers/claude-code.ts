// Claude Code as an engine. Open Bot starts the user's own installed `claude` program for each
// turn; it is signed in with the user's own account, runs the model-and-tools loop itself, and
// reaches the bot's tools over MCP. All of its built-in tools are switched off, so the bot can do
// exactly what it could do on Open Bot's own loop and nothing more.
import type { ProviderInfo } from '@openbot/shared'
import { type Exit, capture, cleanEnv, findBinary, lastError, lines } from './cli.ts'
import { settings } from '../settings.ts'
import type { ModelEvent, Provider, TurnRequest } from './types.ts'

const bin = () => findBinary('claude', 'OPENBOT_CLAUDE_BIN', settings().claudePath)
const base = { id: 'claude-code', name: 'Claude Code', kind: 'cli' as const }
let info: ProviderInfo = { ...base, connected: false, detail: 'Checking…' }

async function refresh() {
  const program = bin()
  if (!program) {
    const missing = settings().claudePath
    info = missing
      ? { ...base, connected: false, detail: 'Not found', hint: `There is no program at ${missing}. Correct the path, or clear it to have Claude Code looked up.` }
      : { ...base, connected: false, detail: 'Not installed', hint: 'Install Claude Code on this computer, then run “claude” in a terminal and sign in.' }
    return
  }
  const { stdout } = await capture(program, ['auth', 'status'])
  let status: Record<string, any> = {}
  try {
    status = JSON.parse(stdout)
  } catch {}
  if (!status.loggedIn) {
    info = { ...base, connected: false, detail: 'Installed, not signed in', hint: 'Run “claude” in a terminal on this computer and sign in.', path: program }
    return
  }
  const plan = status.subscriptionType ? `${String(status.subscriptionType).replace(/^./, (c) => c.toUpperCase())} plan` : 'API key'
  info = { ...base, connected: true, detail: [status.email, plan].filter(Boolean).join(' · '), path: program }
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
  // Aliases that always point at the current model of each family.
  models: async () => ['default', 'fable', 'opus', 'sonnet', 'haiku'],
  turn,
  refresh,
}
