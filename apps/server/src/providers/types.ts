import type { Attachment, Effort, ItemData, ModelInfo, ProviderInfo } from '@openkumi/shared'
import type { Shown } from '../attachments.ts'

export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ModelRequest {
  model: string
  instructions: string
  /** The conversation so far, already ordered so every function_call is followed by its output. */
  items: ItemData[]
  tools: ToolSpec[]
  effort: Effort
  webSearch: boolean
  sessionId: string
  signal: AbortSignal
  /** The files of a message that the model can be shown, read from the bot's workspace. Missing when nothing is to be shown. */
  show?(attachments: Attachment[]): Shown[]
}

/**
 * One turn for an engine: a program such as Claude Code or Codex that keeps the conversation and
 * runs the model-and-tools loop itself. OpenKumi gives it the bot's instructions, what was said
 * since it last ran, and an address where it finds the bot's tools.
 */
export interface TurnRequest {
  /** "default" leaves the choice to the engine. */
  model: string
  instructions: string
  /** What the user (or a subagent's report) said since the engine last ran. */
  input: string
  /** Files that came with it, for the engine to show its model: only kinds it said it takes (`sees`). */
  files: Shown[]
  /** The engine's own conversation to continue, or null to start a new one. */
  session: string | null
  /** The bot's workspace, used as the working folder. */
  cwd: string
  /** OpenKumi's tools for this turn, served as an MCP server at this address. Empty for a turn with no tools. */
  toolsUrl: string
  effort: Effort
  webSearch: boolean
  signal: AbortSignal
}

export type ModelEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'reasoning_delta'; delta: string }
  /** A finished output item, to be stored in the thread. */
  | { type: 'item'; item: ItemData }
  /** Engines only: the id of the engine's conversation, to continue it on the next turn. */
  | { type: 'session'; id: string }

/** What a provider's models can be shown with a message, besides text. Files of other kinds are only named. */
export interface Sees {
  pictures?: boolean
  pdfs?: boolean
}

/** A provider either answers one model request at a time (`stream`) or runs whole turns itself (`turn`). */
export interface Provider {
  id: string
  info(): ProviderInfo
  /** The models it offers, its default first. */
  models(): Promise<ModelInfo[]>
  /** What it can show its models of the files the user attaches. */
  sees?: Sees
  stream?(req: ModelRequest): AsyncGenerator<ModelEvent>
  turn?(req: TurnRequest): AsyncGenerator<ModelEvent>
  /** Looks again at whether the provider is usable (for ones that depend on a program being installed). */
  refresh?(): Promise<void>
}

/** Parses a fetch Response body as server-sent events, yielding each JSON `data:` payload. */
export async function* sse(res: Response): AsyncGenerator<any> {
  const decoder = new TextDecoder()
  let buf = ''
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n')
    let end: number
    while ((end = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, end)
      buf = buf.slice(end + 2)
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
      if (!data || data === '[DONE]') continue
      try {
        yield JSON.parse(data)
      } catch {
        // Ignore keep-alives and malformed frames.
      }
    }
  }
}

export async function errorText(res: Response): Promise<string> {
  const body = await res.text().catch(() => '')
  try {
    const j = JSON.parse(body)
    const msg = j.detail ?? j.error?.message ?? j.message ?? j.error
    if (msg) return typeof msg === 'string' ? msg : JSON.stringify(msg)
  } catch {
    // Not JSON; fall through to the raw body.
  }
  return body.slice(0, 500) || res.statusText
}

const LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
/** The reasoning levels among these names that OpenKumi knows, lightest first. */
export function efforts(names: unknown[]): NonNullable<ModelInfo['efforts']> {
  return LEVELS.filter((level) => names.includes(level))
}

/** A model that is known by its id alone. */
export const plainModel = (id: string): ModelInfo => ({ id, name: id })
