// Codex as an engine. OpenKumi starts the user's own installed `codex` program for each turn, as
// its app server; it is signed in with the user's own ChatGPT account, runs the model-and-tools
// loop itself, and reaches the bot's tools over MCP. Its command and file tools are switched off
// and its sandbox is read-only, so the bot can do exactly what it could do on OpenKumi's own loop.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ModelInfo, ProviderInfo } from '@openkumi/shared'
import type { Shown } from '../attachments.ts'
import { type Exit, type Pipe, capture, cleanEnv, findBinary, lastError, lines, versionOf } from './cli.ts'
import { settings } from '../settings.ts'
import { type ModelEvent, type Provider, type TurnRequest, efforts } from './types.ts'

const bin = () => findBinary('codex', 'OPENKUMI_CODEX_BIN', settings().codexPath)
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
  const version = await versionOf(program)
  const { code, stdout, stderr } = await capture(program, ['login', 'status'])
  const said = (stdout + stderr).trim().split('\n')[0] ?? ''
  if (code !== 0 || /not logged in/i.test(said)) {
    info = { ...base, connected: false, detail: 'Installed, not signed in', hint: 'Run “codex login” in a terminal on this computer.', path: program, version }
    return
  }
  info = { ...base, connected: true, detail: said.replace(/^Logged in using /i, 'Signed in with ') || 'Signed in', path: program, version }
}

/** Everything in Codex that runs commands, touches files, drives apps or starts its own agents. */
const SWITCHED_OFF = [
  'shell_tool', 'unified_exec', 'view_image', 'multi_agent', 'plugins', 'apps', 'browser_use', 'computer_use',
  'image_generation', 'hooks', 'skill_search', 'sleep_tool', 'goals', 'tool_suggest', 'workspace_dependencies',
]

// Config values are TOML; a JSON string is also a valid TOML string.
const toml = (value: string) => JSON.stringify(value)

const codexHome = () => process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')

/**
 * The servers the user set up for their own Codex, by name. The app server reads the user's
 * config file, where `codex exec` could be told to leave it out, so each is switched off by name:
 * a bot gets OpenKumi's tools and nothing else.
 */
function ownServers(): string[] {
  let config: string
  try {
    config = fs.readFileSync(path.join(codexHome(), 'config.toml'), 'utf8')
  } catch {
    return []
  }
  const names = [...config.matchAll(/^[ \t]*\[mcp_servers\.(?:"((?:[^"\\]|\\.)+)"|'([^']+)'|([A-Za-z0-9_-]+))[ \t]*\]/gm)].map((m) => m[1] ?? m[2] ?? m[3])
  // A setting is named by a path whose parts are divided by dots, so a name with one in it cannot be reached.
  const dotted = names.find((name) => name.includes('.'))
  if (dotted) throw new Error(`Codex has a server named "${dotted}" set up, which OpenKumi cannot keep from a bot. Give it a name without a dot in ${path.join(codexHome(), 'config.toml')}.`)
  return [...new Set(names)].filter((name) => name !== 'openkumi')
}

const EXTENSIONS: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }

const GONE = 'Codex stopped.'

/** How long Codex is given to wind a turn down when it is asked to stop, before its program is ended. */
const WIND_DOWN = 1500

/**
 * One turn, through Codex's app server (`codex app-server`): the program its own apps talk to, in
 * JSON-RPC over its input and output, a message a line. Unlike `codex exec` it sends a reply as it
 * is written, and takes one more message while a turn is running (turn/steer). One is started for
 * each turn and ended with it.
 */
async function* turn(req: TurnRequest): AsyncGenerator<ModelEvent> {
  const program = bin()
  if (!program) throw new Error('Codex is not installed on this computer.')
  const args = [
    'app-server',
    ...SWITCHED_OFF.flatMap((feature) => ['--disable', feature]),
    // The user's own Codex setup is left out as far as it would reach a bot: their servers, and what they have run when a turn ends.
    ...ownServers().flatMap((name) => ['-c', `mcp_servers.${name}.enabled=false`]),
    '-c', 'notify=[]',
    '-c', 'sandbox_mode="read-only"',
    '-c', 'approval_policy="never"',
    '-c', `developer_instructions=${toml(req.instructions)}`,
    // OpenKumi passes the bot's AGENTS.md itself, fresh on every turn.
    '-c', 'project_doc_max_bytes=0',
    // Codex has skills of its own (and finds the user's); the bot's superpowers are the ones in its instructions.
    '-c', 'skills.include_instructions=false',
    '-c', 'skills.bundled.enabled=false',
    ...(req.toolsUrl
      ? [
          '-c', `mcp_servers.openkumi.url=${toml(req.toolsUrl)}`,
          '-c', 'mcp_servers.openkumi.tool_timeout_sec=1900',
          // Nobody is there to approve a tool call, and OpenKumi's tools are the ones the owner chose.
          '-c', 'mcp_servers.openkumi.default_tools_approval_mode="approve"',
        ]
      : []),
    '-c', `web_search=${toml(req.webSearch ? 'live' : 'disabled')}`,
  ]
  if (req.effort) args.push('-c', `model_reasoning_effort=${toml(req.effort)}`)

  // Pictures go in as files. Each is given a name that says what it really is, in a folder that goes with the turn.
  const pictures = fs.mkdtempSync(path.join(os.tmpdir(), 'openkumi-codex-'))
  let copied = 0
  const said = (text: string, files: Shown[]) => [
    { type: 'text', text, text_elements: [] },
    ...files.map((file) => {
      const copy = path.join(pictures, `${++copied}${EXTENSIONS[file.type] ?? path.extname(file.path).toLowerCase()}`)
      fs.copyFileSync(file.path, copy)
      return { type: 'localImage', path: copy }
    }),
  ]

  // The program is ended by this, not by the turn's own signal: asked to stop, Codex is first told to wind the turn down.
  const end = new AbortController()
  const exit: Exit = { code: null, stderr: '' }
  let pipe: Pipe | undefined
  let running = () => {}
  /** Settles once the program has been started, which is when its output is first read. */
  const started = new Promise<void>((resolve) => (running = resolve))
  const output = lines(program, args, { cwd: req.cwd, env: cleanEnv(), input: '', signal: end.signal, open: (opened) => ((pipe = opened), running()) }, exit)
  const write = (message: Record<string, unknown>) => !!pipe?.write(JSON.stringify(message) + '\n')

  /** Requests that have not been answered yet. */
  const asked = new Map<number, { resolve: (result: any) => void; reject: (error: Error) => void }>()
  let requests = 0
  const ask = (method: string, params: Record<string, unknown>) =>
    new Promise<any>((resolve, reject) => {
      const id = ++requests
      asked.set(id, { resolve, reject })
      if (!write({ id, method, params })) reject(new Error('Codex is not running.'))
    })

  let thread = ''
  let turnId = ''
  let finished = false
  let failure: Error | undefined
  let winding: NodeJS.Timeout | undefined
  const stop = () => {
    // Told to stop while its turn runs, Codex ends the turn itself and keeps what it had; failing that, it is ended.
    if (thread && turnId && !finished) void ask('turn/interrupt', { threadId: thread, turnId }).catch(() => {})
    winding = setTimeout(() => end.abort(), thread && turnId ? WIND_DOWN : 0)
  }
  if (req.signal.aborted) stop()
  else req.signal.addEventListener('abort', stop, { once: true })

  // The conversation is opened and the turn begun while the answers are read below.
  const settings = { cwd: req.cwd, approvalPolicy: 'never', sandbox: 'read-only', ...(req.model && req.model !== 'default' ? { model: req.model } : {}) }
  const began = (async () => {
    await started
    await ask('initialize', { clientInfo: { name: 'openkumi', title: 'OpenKumi', version: '0.1.0' }, capabilities: { experimentalApi: false, requestAttestation: false } })
    write({ method: 'initialized', params: {} })
    const opened = req.session ? await ask('thread/resume', { threadId: req.session, excludeTurns: true, ...settings }) : await ask('thread/start', settings)
    thread = String(opened?.thread?.id ?? '')
    if (!thread) throw new Error('Codex did not open a conversation.')
    const begun = await ask('turn/start', { threadId: thread, input: said(req.input, req.files) })
    turnId = String(begun?.turn?.id ?? '')
    // From here on Codex takes one more message into the turn; it says no while it is compacting or reviewing.
    if (req.steering && !req.signal.aborted) {
      req.steering.deliver = (input, files) => (finished ? Promise.resolve(false) : ask('turn/steer', { threadId: thread, expectedTurnId: turnId, input: said(input, files) }).then(() => true, () => false))
    }
  })().catch((e: Error) => {
    failure = e
    end.abort()
  })

  try {
    let announced = false
    for await (const line of output) {
      let message: any
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      const { id, method, params } = message
      // The conversation Codex opened is the one to continue next time.
      if (thread && !announced) {
        announced = true
        yield { type: 'session', id: thread }
      }
      if (id !== undefined && !method) {
        // The answer to one of the requests above.
        const waiting = asked.get(id)
        asked.delete(id)
        if (message.error) waiting?.reject(new Error(String(message.error.message ?? 'Codex refused a request').slice(0, 600)))
        else waiting?.resolve(message.result)
      } else if (id !== undefined) {
        // Codex asks for a go-ahead, or for something of the user. Nobody is there, and a bot's tools are OpenKumi's: the answer is no.
        if (method === 'mcpServer/elicitation/request') write({ id, result: { action: 'decline', content: null, _meta: null } })
        else if (/requestApproval$/.test(method)) write({ id, result: { decision: 'decline' } })
        else write({ id, error: { code: -32601, message: 'Not available here.' } })
      } else if (method === 'item/agentMessage/delta' && params?.delta) {
        yield { type: 'text_delta', delta: params.delta }
      } else if ((method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') && params?.delta) {
        yield { type: 'reasoning_delta', delta: params.delta }
      } else if (method === 'item/completed') {
        const item = params?.item ?? {}
        if (item.type === 'agentMessage' && item.text?.trim()) yield { type: 'item', item: { type: 'message', role: 'assistant', text: item.text } }
        else if (item.type === 'reasoning') {
          const thought = [...(item.summary ?? []), ...(item.summary?.length ? [] : (item.content ?? []))].join('\n\n').trim()
          if (thought) yield { type: 'item', item: { type: 'reasoning', summary: thought } }
        } else if (item.type === 'webSearch') {
          const action = item.action ?? {}
          yield { type: 'item', item: { type: 'web_search_call', action: action.url ? { url: action.url } : { query: action.query ?? action.queries?.[0] ?? item.query } } }
        }
        // Calls to OpenKumi's own tools are recorded where they are carried out (tool-endpoint.ts).
      } else if (method === 'error' && !params?.willRetry) {
        failure = new Error(String(params?.error?.message ?? 'Codex reported an error').slice(0, 600))
      } else if (method === 'turn/completed') {
        finished = true
        if (req.steering) req.steering.deliver = undefined
        const ended = params?.turn ?? {}
        if (ended.status === 'failed') failure = new Error(String(ended.error?.message ?? failure?.message ?? 'Codex reported an error').slice(0, 600))
        else failure = undefined
        // With its input closed the program ends by itself.
        pipe?.end()
        clearTimeout(winding)
        winding = setTimeout(() => end.abort(), WIND_DOWN)
      }
    }
  } finally {
    clearTimeout(winding)
    req.signal.removeEventListener('abort', stop)
    if (req.steering) req.steering.deliver = undefined
    // The program has ended: what it was still asked gets no answer.
    const unanswered = [...asked.values()]
    asked.clear()
    for (const waiting of unanswered) waiting.reject(new Error(GONE))
    end.abort()
    await began
    fs.rmSync(pictures, { recursive: true, force: true })
  }
  if (req.signal.aborted) return
  if (failure && (finished || failure.message !== GONE)) throw failure
  if (!finished) throw new Error(`Codex stopped unexpectedly: ${lastError(exit, `exit code ${exit.code}`)}`)
}

/** The models Codex itself offers, from the list it keeps in its own folder. Empty when it has none yet. */
/** One model as Codex keeps it in its own list of models. */
interface Listed {
  slug?: string
  display_name?: string
  description?: string
  visibility?: string
  priority?: number
  default_reasoning_level?: string
  supported_reasoning_levels?: { effort?: string }[]
}

/** The models Codex offers, as its own list has them: named, described, with the reasoning levels each takes. */
function listed(): ModelInfo[] {
  try {
    const file = path.join(codexHome(), 'models_cache.json')
    const models: Listed[] = JSON.parse(fs.readFileSync(file, 'utf8')).models ?? []
    /** The kinds already listed ("sol", "terra"…): a later model of a kind is an earlier generation of it. */
    const kinds = new Set<string>()
    return models
      .filter((m) => m.slug && m.visibility !== 'hide')
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((m) => {
        const kind = m.slug!.split('-').pop()!
        const older = kinds.has(kind)
        kinds.add(kind)
        const levels = efforts((m.supported_reasoning_levels ?? []).map((l) => l.effort))
        return {
          id: m.slug!,
          name: m.display_name || m.slug!,
          ...(m.description ? { description: m.description } : {}),
          efforts: levels,
          ...(levels.length ? { defaultEffort: efforts([m.default_reasoning_level])[0] } : {}),
          ...(older ? { older } : {}),
        }
      })
  } catch {
    return []
  }
}

export const codex: Provider = {
  id: base.id,
  info: () => info,
  // It reads pictures only: a PDF is refused as "unsupported image data".
  sees: { pictures: true },
  // Left to itself, Codex runs the first model of its list: that one leads here, as the default.
  models: async () => {
    const [usual, ...rest] = listed()
    return usual ? [{ ...usual, id: 'default' }, ...rest] : [{ id: 'default', name: 'Default' }]
  },
  turn,
  refresh,
}
