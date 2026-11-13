// Any server that speaks the OpenAI Chat Completions API: api.openai.com with a key, OpenRouter,
// Ollama, LM Studio, vLLM, ...
import crypto from 'node:crypto'
import type { ItemData } from '@openkumi/shared'
import { readSecrets } from '../config.ts'
import { type ModelEvent, type ModelRequest, type Provider, errorText, plainModel, sse } from './types.ts'

export interface Config {
  baseUrl: string
  apiKey: string
}

function config(): Config | null {
  const c = readSecrets().compat as Config | undefined
  return c?.baseUrl ? { baseUrl: c.baseUrl.replace(/\/+$/, ''), apiKey: c.apiKey ?? '' } : null
}

function authHeaders(c: Config): Record<string, string> {
  return c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}
}

function toMessages(instructions: string, items: ItemData[]) {
  const messages: any[] = [{ role: 'system', content: instructions }]
  for (const it of items) {
    if (it.type === 'message') {
      messages.push({ role: it.role, content: it.text })
    } else if (it.type === 'function_call') {
      const call = { id: it.call_id, type: 'function', function: { name: it.name, arguments: it.arguments } }
      const last = messages.at(-1)
      // Attach to the assistant message that introduced it, unless tool results already followed.
      if (last?.role === 'assistant' && !last.closed) (last.tool_calls ??= []).push(call)
      else messages.push({ role: 'assistant', content: null, tool_calls: [call] })
    } else if (it.type === 'function_call_output') {
      const last = messages.at(-1)
      if (last?.role === 'assistant') last.closed = true
      messages.push({ role: 'tool', tool_call_id: it.call_id, content: it.output })
    }
  }
  return messages.map(({ closed, ...m }) => m)
}

/** The models a server offers, or null when it does not answer. */
export async function modelsAt(c: Config, timeoutMs = 4000): Promise<string[] | null> {
  try {
    const res = await fetch(`${c.baseUrl}/models`, { headers: authHeaders(c), signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return null
    const list: any[] = (await res.json()).data ?? []
    return list.map((m) => m.id as string)
  } catch {
    return null
  }
}

/** One conversation step against a server that speaks the Chat Completions API. */
export async function* chat(c: Config, req: ModelRequest): AsyncGenerator<ModelEvent> {
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { ...authHeaders(c), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        messages: toMessages(req.instructions, req.items),
        tools: req.tools.length ? req.tools.map((t) => ({ type: 'function', function: t })) : undefined,
        reasoning_effort: req.effort || undefined,
        stream: true,
      }),
      signal: req.signal,
    })
    if (!res.ok) throw new Error(`Request failed (${res.status}): ${await errorText(res)}`)

    let text = ''
    let reasoning = ''
    const calls: { id: string; name: string; arguments: string }[] = []
    for await (const ev of sse(res)) {
      if (ev.error) throw new Error(ev.error.message ?? JSON.stringify(ev.error))
      const delta = ev.choices?.[0]?.delta
      if (!delta) continue
      const thought = delta.reasoning_content ?? delta.reasoning
      if (typeof thought === 'string' && thought) {
        reasoning += thought
        yield { type: 'reasoning_delta', delta: thought }
      }
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content
        yield { type: 'text_delta', delta: delta.content }
      }
      for (const tc of delta.tool_calls ?? []) {
        const call = (calls[tc.index ?? 0] ??= { id: '', name: '', arguments: '' })
        if (tc.id) call.id = tc.id
        if (tc.function?.name) call.name += tc.function.name
        if (tc.function?.arguments) call.arguments += tc.function.arguments
      }
    }
    if (reasoning) yield { type: 'item', item: { type: 'reasoning', summary: reasoning } }
    if (text) yield { type: 'item', item: { type: 'message', role: 'assistant', text } }
    for (const call of calls.filter(Boolean)) {
      yield {
        type: 'item',
        item: {
          type: 'function_call',
          name: call.name,
          arguments: call.arguments || '{}',
          call_id: call.id || `call_${crypto.randomBytes(8).toString('hex')}`,
        },
      }
    }
}

export const openaiCompat: Provider = {
  id: 'openai-compatible',

  info() {
    const c = config()
    return {
      id: 'openai-compatible',
      name: 'OpenAI-compatible API',
      kind: 'apikey',
      connected: !!c,
      detail: c ? c.baseUrl : 'Not configured',
      baseUrl: c?.baseUrl ?? '',
    }
  },

  async models() {
    const c = config()
    return ((c && (await modelsAt(c))) || []).map(plainModel)
  },

  stream(req: ModelRequest) {
    const c = config()
    if (!c) throw new Error('The OpenAI-compatible provider is not configured. Open Settings to add a base URL.')
    return chat(c, req)
  },
}
