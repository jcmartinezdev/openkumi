// Engines such as Claude Code and Codex run the model themselves, so they cannot be handed tools as
// function definitions. Instead, for the length of one turn, the bot's tools are served to the
// engine as a small MCP server at a one-time address. Every call that comes in is carried out and
// recorded exactly as a call from Open Bot's own loop would be.
import crypto from 'node:crypto'
import type http from 'node:http'
import type { Bot, Thread } from '@openbot/shared'
import { PORT } from './config.ts'
import * as db from './db.ts'
import { type Tool, runTool } from './tools.ts'

interface Turn {
  thread: Thread
  bot: Bot
  tools: Tool[]
  signal: AbortSignal
}

const turns = new Map<string, Turn>()

/** Makes the tools available until `close` is called. The address is the only way in. */
export function openToolEndpoint(turn: Turn): { url: string; close: () => void } {
  const token = crypto.randomBytes(24).toString('base64url')
  turns.set(token, turn)
  return { url: `http://127.0.0.1:${PORT}/mcp/${token}`, close: () => turns.delete(token) }
}

async function answer(turn: Turn, method: string, params: any): Promise<unknown> {
  if (method === 'initialize') {
    return {
      // Agreeing to whatever version the client speaks keeps older and newer programs working.
      protocolVersion: params?.protocolVersion ?? '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'open-bot', version: '0.1.0' },
    }
  }
  if (method === 'ping') return {}
  if (method === 'tools/list') {
    return { tools: turn.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters })) }
  }
  if (method === 'tools/call') {
    const call = {
      type: 'function_call' as const,
      name: String(params?.name ?? ''),
      arguments: JSON.stringify(params?.arguments ?? {}),
      call_id: `call_${crypto.randomBytes(9).toString('base64url')}`,
    }
    db.addItem(turn.thread.id, call)
    const output = await runTool(turn.tools, call, turn)
    db.addItem(turn.thread.id, { type: 'function_call_output', call_id: call.call_id, output })
    return { content: [{ type: 'text', text: output }], isError: output.startsWith('Error:') }
  }
  throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 })
}

/** Handles a request to /mcp/<token>: MCP's "streamable HTTP" transport, answering in plain JSON. */
export async function handleToolEndpoint(req: http.IncomingMessage, res: http.ServerResponse, token: string) {
  const send = (status: number, body?: unknown) => {
    res.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json' })
    res.end(body === undefined ? undefined : JSON.stringify(body))
  }
  const turn = turns.get(token)
  if (!turn) return send(404, { error: 'This tool address is no longer in use.' })
  // There is no server-to-client stream to open, and nothing to tear down.
  if (req.method !== 'POST') return send(405, { error: 'Method not allowed' })

  let raw = ''
  for await (const chunk of req) {
    raw += chunk
    if (raw.length > 8_000_000) return send(413, { error: 'Request too large' })
  }
  let body: any
  try {
    body = JSON.parse(raw)
  } catch {
    return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
  }

  const reply = async (msg: any) => {
    // A message without an id is a notification and gets no reply.
    if (msg?.id === undefined || msg?.id === null) return null
    try {
      return { jsonrpc: '2.0', id: msg.id, result: await answer(turn, String(msg.method), msg.params) }
    } catch (e: any) {
      return { jsonrpc: '2.0', id: msg.id, error: { code: typeof e?.code === 'number' ? e.code : -32603, message: String(e?.message ?? e) } }
    }
  }
  const replies = (await Promise.all((Array.isArray(body) ? body : [body]).map(reply))).filter(Boolean)
  if (!replies.length) return send(202)
  send(200, Array.isArray(body) ? replies : replies[0])
}
