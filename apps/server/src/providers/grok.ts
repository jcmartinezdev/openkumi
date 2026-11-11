// Grok as an engine. Open Bot starts the user's own installed `grok` program (Grok Build) for each
// turn; it is signed in with the user's own account, runs the model-and-tools loop itself, and
// reaches the bot's tools over MCP. Its own tools for commands and files are switched off, so the
// bot can do exactly what it could do on Open Bot's own loop and nothing more.
import fs from 'node:fs'
import path from 'node:path'
import type { ProviderInfo } from '@openbot/shared'
import { type Exit, capture, cleanEnv, findBinary, lastError, lines } from './cli.ts'
import { settings } from '../settings.ts'
import type { ModelEvent, Provider, TurnRequest } from './types.ts'

const bin = () => findBinary('grok', 'OPENBOT_GROK_BIN', settings().grokPath)
const base = { id: 'grok', name: 'Grok', kind: 'cli' as const }
let info: ProviderInfo = { ...base, connected: false, detail: 'Checking…' }
let models = ['default']

async function refresh() {
  const program = bin()
  if (!program) {
    const missing = settings().grokPath
    info = missing
      ? { ...base, connected: false, detail: 'Not found', hint: `There is no program at ${missing}. Correct the path, or clear it to have Grok looked up.` }
      : { ...base, connected: false, detail: 'Not installed', hint: 'Install Grok Build on this computer, then run “grok login” in a terminal.' }
    return
  }
  // "grok models" says who is signed in, then lists the models: "  * grok-4.7 (default)", "  - grok-4.6".
  const { stdout } = await capture(program, ['models'])
  const listed = [...stdout.matchAll(/^\s*[*-]\s+(\S+)/gm)].map((m) => m[1])
  if (listed.length) models = ['default', ...listed]
  const account = stdout.match(/logged in with ([^.\n]+(?:\.[a-z]+)?)/i)?.[1]
  info = account || process.env.XAI_API_KEY
    ? { ...base, connected: true, detail: account ? `Signed in with ${account}` : 'Using an xAI API key', path: program }
    : { ...base, connected: false, detail: 'Installed, not signed in', hint: 'Run “grok login” in a terminal on this computer.', path: program }
}

// Grok only takes an MCP server from a settings file in the folder it is started in, and only once
// that folder is trusted, which it writes down in the user's own Grok settings. So each bot has a
// few folders of its own for this, kept beside its browser profile where the bot cannot reach,
// and a turn borrows one: there are never more of them than turns of one bot running at once.
const busy = new Set<string>()
function borrowFolder(workspace: string): string {
  const root = path.join(workspace, '..', 'private', 'grok')
  for (let n = 1; ; n++) {
    const folder = path.join(root, `run-${n}`)
    if (busy.has(folder)) continue
    busy.add(folder)
    return folder
  }
}

async function* turn(req: TurnRequest): AsyncGenerator<ModelEvent> {
  const program = bin()
  if (!program) throw new Error('Grok is not installed on this computer.')
  const folder = borrowFolder(req.cwd)
  fs.mkdirSync(path.join(folder, '.grok'), { recursive: true })
  fs.writeFileSync(path.join(folder, '.grok', 'config.toml'), `[mcp_servers.openbot]\nurl = ${JSON.stringify(req.toolsUrl)}\ntool_timeout_sec = 1900\n`, { mode: 0o600 })
  // What was said goes in a file of its own: it can be longer than a command line may be.
  const prompt = path.join(folder, 'prompt.txt')
  fs.writeFileSync(prompt, req.input, { mode: 0o600 })
  const args = [
    '--prompt-file', prompt,
    '--verbatim',
    '--trust',
    '--output-format', 'streaming-messages-json',
    '--include-partial-messages',
    '--system-prompt-override', req.instructions,
    // Of its own tools only web search may stay, and it is switched off again when the bot has none.
    // What is left is the pair of tools through which it reaches MCP servers.
    '--tools', 'web_search',
    ...(req.webSearch ? ['--allow', 'WebSearch'] : ['--disable-web-search']),
    '--no-subagents',
    '--no-plan',
    // Nobody is there to answer a permission prompt: only what is allowed here runs.
    '--permission-mode', 'dontAsk',
    '--allow', 'MCPTool(openbot__*)',
    // Underneath all that, the program itself may not write outside its own folder.
    '--sandbox', 'read-only',
    '--no-auto-update',
  ]
  if (req.session) args.push('--resume', req.session)
  if (req.model && req.model !== 'default') args.push('--model', req.model)
  if (req.effort) args.push('--effort', req.effort)

  // Its own memory of other conversations and its background workflows stay out of a bot's turn.
  const env = cleanEnv({ GROK_MEMORY: '0', GROK_WORKFLOWS: '0' })
  const exit: Exit = { code: null, stderr: '' }
  let finished = false

  try {
    for await (const line of lines(program, args, { cwd: folder, env, input: '', signal: req.signal }, exit)) {
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
      } else if (ev.type === 'assistant' && !ev.parent_tool_use_id) {
        for (const block of ev.message?.content ?? []) {
          if (block.type === 'text' && block.text?.trim()) yield { type: 'item', item: { type: 'message', role: 'assistant', text: block.text } }
          else if (block.type === 'thinking' && block.thinking?.trim()) yield { type: 'item', item: { type: 'reasoning', summary: block.thinking } }
          else if (block.type === 'server_tool_use' && /search/i.test(block.name ?? '')) yield { type: 'item', item: { type: 'web_search_call', action: { query: block.input?.query } } }
          // Calls to Open Bot's own tools are recorded where they are carried out (tool-endpoint.ts).
        }
      } else if (ev.type === 'result') {
        finished = true
        if (ev.is_error) throw new Error(String(ev.result || ev.subtype || 'Grok reported an error').slice(0, 600))
      }
    }
  } finally {
    fs.rmSync(prompt, { force: true })
    // The address in the settings file stopped working with the turn; the folder is free again.
    fs.rmSync(path.join(folder, '.grok', 'config.toml'), { force: true })
    busy.delete(folder)
  }
  if (req.signal.aborted) return
  if (!finished) throw new Error(`Grok stopped unexpectedly: ${lastError(exit, `exit code ${exit.code}`)}`)
}

export const grok: Provider = {
  id: base.id,
  info: () => info,
  models: async () => models,
  turn,
  refresh,
}
