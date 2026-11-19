import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Bot, CallsInfo, ModelInfo, ProviderInfo } from '@openkumi/shared'
import { HOME, emit } from '../config.ts'
import { SUMMARISE } from '../history.ts'
import { CHOOSE_LOOK } from '../look.ts'
import { onSettingsChange, settings } from '../settings.ts'
import { claudeCode } from './claude-code.ts'
import { codex } from './codex.ts'
import { grok } from './grok.ts'
import { localModels } from './local.ts'
import { openaiCompat } from './openai-compat.ts'
import type { ModelEvent, ModelRequest, Provider } from './types.ts'

/**
 * Scripted offline provider for tests and UI development (enabled with OPENKUMI_MOCK=1).
 * "!tool <name> <json>" calls a tool, "!steps <n>" calls one n times in a row, "!slow" takes a few
 * seconds, "!say <text>" replies with exactly that text, "!system", "!tools" and "!sent" report what
 * the model was sent, "!seen" how many pictures of the conversation it was shown, "!bounce a b" starts
 * two bots writing back and forth, anything else is
 * echoed, with the files that came with it and how many of them it was shown. A command in a
 * message from another bot, or in what the user asked on a call, is carried out like one from the user.
 * Asked to go over a call that ended, it finds something to do when the user said "remember" on it. Asked for a summary, it gives the start of everything the user said in what it
 * was to summarise; asked for a look, always the same one.
 */
const mock: Provider = {
  id: 'mock',
  info: () => ({ id: 'mock', name: 'Mock (offline testing)', kind: 'apikey', connected: true, detail: 'Scripted replies' }),
  sees: { pictures: true },
  models: async () => [{ id: 'mock-1', name: 'Mock 1', description: 'Scripted replies.' }],
  async *stream(req: ModelRequest): AsyncGenerator<ModelEvent> {
    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ms)
        req.signal.addEventListener('abort', () => (clearTimeout(t), reject(req.signal.reason)), { once: true })
      })
    const last = req.items.at(-1)
    const asked = req.items.findLastIndex((i) => i.type === 'message' && i.role === 'user')
    const steps = /^!steps (\d+)$/.exec((req.items[asked] as { text?: string } | undefined)?.text ?? '')
    let reply: string
    if (steps && req.items.slice(asked).filter((i) => i.type === 'function_call').length < Number(steps[1])) {
      await sleep(20)
      yield { type: 'item', item: { type: 'function_call', name: 'list_files', arguments: '{}', call_id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` } }
      return
    } else if (steps) {
      reply = `Done in ${steps[1]} steps.`
    } else if (last?.type === 'function_call_output') {
      reply = `Tool result: ${last.output.slice(0, 600)}`
    } else {
      const ask = req.items.findLast((i) => i.type === 'message' && i.role === 'user')
      const raw = ask?.type === 'message' ? ask.text : ''
      // A message from another bot is read for the command in it, so that a test can have the bot that gets it do something.
      const inner = (/^<bot_message[^>]*>\n([\s\S]*)\n<\/bot_message>$/.exec(raw) ?? /^<call_request>\n[\s\S]*?The user asks, on the call:\n([\s\S]*)\n<\/call_request>$/.exec(raw))?.[1]
      const text = inner?.startsWith('!') ? inner : raw
      const files = ask?.type === 'message' && ask.role === 'user' ? (ask.attachments ?? []) : []
      const attached = files.length ? ` [${files.map((a) => a.path).join(', ')}; ${req.show?.(files).length ?? 0} shown]` : ''
      const call = text.match(/^!tool ([\w-]+)\s*([\s\S]*)$/)
      if (call) {
        yield { type: 'item', item: { type: 'function_call', name: call[1], arguments: call[2] || '{}', call_id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` } }
        return
      }
      // "!bounce a b" writes to bot a, asking it to write to bot b in the same way, and so on, back and forth.
      const bounce = text.match(/^!bounce ([\w-]+) ([\w-]+)$/)
      if (bounce) {
        const args = JSON.stringify({ bot_id: bounce[1], message: `!bounce ${bounce[2]} ${bounce[1]}`, reply_wanted: true })
        yield { type: 'item', item: { type: 'function_call', name: 'message_bot', arguments: args, call_id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` } }
        return
      }
            // "!system" shows the instructions the model was given; "!tools" the tools it was offered.
      if (text === '!system' || text === '!tools') {
        yield { type: 'item', item: { type: 'message', role: 'assistant', text: text === '!system' ? req.instructions : req.tools.map((t) => t.name).join(' ') } }
        return
      }
      if (text === '!seen') {
        const seen = req.items.reduce((n, i) => n + (i.type === 'message' && i.role === 'user' && i.attachments ? (req.show?.(i.attachments).length ?? 0) : 0), 0)
        yield { type: 'item', item: { type: 'message', role: 'assistant', text: `Shown ${seen}` } }
        return
      }
      if (text === '!sent') {
        const lines = req.items.map((i) => (i.type === 'message' ? `${i.role}: ${i.text.replace(/\s+/g, ' ').slice(0, 160)}` : i.type))
        yield { type: 'item', item: { type: 'message', role: 'assistant', text: lines.join('\n') } }
        return
      }
      // Going over what was said on a call that ended (calls.ts): it does what the user asked it to remember, and nothing else.
      if (text.startsWith('A voice call between you and the user has just ended.')) {
        const kept = /^User: .*remember (.*)$/im.exec(text)?.[1]
        yield { type: 'item', item: { type: 'message', role: 'assistant', text: kept ? `Noted after the call: ${kept}` : 'Nothing to do.' } }
        return
      }
      if (text.startsWith('!slow')) await sleep(4000)
      const said = () => text.split('\n').filter((line) => /^(User|Summary): /.test(line)).map((line) => line.replace(/^Summary: /, '').slice(0, 40))
      // Asked to choose a bot's look, it dresses every bot for travel.
      const look = '{"creature":"cat","color":"sky","hat":"cap","extra":"none","clothes":"orange","emoji":"✈️"}'
      reply = req.instructions === SUMMARISE ? `Summary: ${said().join(' / ').slice(0, 400)}` : req.instructions === CHOOSE_LOOK ? look : text.startsWith('!say ') || text.startsWith('!drip ') ? text.slice(text.indexOf(' ') + 1) : `Echo: ${text}${attached}`
    }
    // "!drip" writes its reply slowly, a word at a time, for a test to stop it part-way.
    const pause = /^!drip /.test((req.items[asked] as { text?: string } | undefined)?.text ?? '') ? 150 : 5
    for (const word of reply.split(/(?<=\s)/)) {
      await sleep(pause)
      yield { type: 'text_delta', delta: word }
    }
    yield { type: 'item', item: { type: 'message', role: 'assistant', text: reply } }
  },
}

// The order is the order of preference when a new bot is given "the first one connected".
const providers: Provider[] = [codex, claudeCode, grok, localModels, openaiCompat, ...(process.env.OPENKUMI_MOCK ? [mock] : [])]

export function getProvider(id: string): Provider {
  const p = providers.find((p) => p.id === id)
  if (!p) throw new Error(`Unknown provider "${id}"`)
  return p
}

/**
 * Asks a provider's model one thing, with no tools and nothing kept, and gives back its answer:
 * for small jobs such as choosing a bot's look. Engines run in an empty folder kept for this, out
 * of every bot's way. An empty `model` is the provider's default.
 */
export async function askOnce(provider: Provider, ask: { model: string; instructions: string; text: string; signal: AbortSignal }): Promise<string> {
  const model = ask.model || (await provider.models())[0]?.id || 'default'
  const cwd = path.join(HOME, 'asks', 'workspace')
  fs.mkdirSync(cwd, { recursive: true })
  const events = provider.stream
    ? provider.stream({ model, instructions: ask.instructions, items: [{ type: 'message', role: 'user', source: 'user', text: ask.text }], tools: [], effort: '', webSearch: false, sessionId: `ask:${crypto.randomUUID()}`, signal: ask.signal })
    : provider.turn!({ model, instructions: ask.instructions, input: ask.text, files: [], session: null, cwd, toolsUrl: '', effort: '', webSearch: false, signal: ask.signal })
  let said = ''
  let streamed = ''
  for await (const ev of events) {
    if (ev.type === 'text_delta') streamed += ev.delta
    else if (ev.type === 'item' && ev.item.type === 'message' && ev.item.role === 'assistant') said += ev.item.text
  }
  return (said || streamed).trim()
}

/** What each provider's models are called, as last heard: what a bot is told is put together without waiting for a list. */
const named = new Map<string, { at: number; models: ModelInfo[] }>()

/** Learns what a provider's models are called. It is waited for the first time only; after that the list is asked for again now and then, behind what goes on. */
export async function learnModels(provider: Provider) {
  const have = named.get(provider.id)
  const ask = () => provider.models().then((models) => void named.set(provider.id, { at: Date.now(), models }), () => {})
  if (!have) await ask()
  else if (Date.now() - have.at > 10 * 60_000) {
    have.at = Date.now()
    void ask()
  }
}

/**
 * What the model a bot runs on is called, for people ("Claude Opus 5.5"), as far as it is known:
 * the one chosen for it (or for the thread, with `chosen`), or its provider's usual one. Empty
 * when the provider gives it no name of its own.
 */
export function modelName(bot: Pick<Bot, 'provider' | 'model'>, chosen = ''): string {
  const models = named.get(bot.provider)?.models ?? []
  const id = chosen || bot.model
  const name = (id ? models.find((m) => m.id === id) : models[0])?.name ?? id
  return /^default$/i.test(name) ? '' : name
}

export function providerInfos(): ProviderInfo[] {
  const off = settings().disabledProviders
  return providers.map((p) => ({ ...p.info(), enabled: !off.includes(p.id) }))
}

/**
 * Whether bots can be called. The voice on a call is a speech model of the owner's ChatGPT plan,
 * which only Codex reaches, and only when it is signed in with ChatGPT: a call needs it whatever
 * the bot itself runs on.
 */
export function callsInfo(): CallsInfo {
  const info = codex.info()
  const no = (reason: string): CallsInfo => ({ available: false, reason })
  if (settings().disabledProviders.includes(codex.id)) return no('Calls use your ChatGPT plan through Codex, which is switched off in Settings, under Providers.')
  if (!info.path) return no(info.detail === 'Checking…' ? 'Checking whether Codex is installed…' : 'Calls use your ChatGPT plan through Codex. Install the Codex CLI on the computer running OpenKumi, then run “codex login” there.')
  if (!info.connected) return no('Calls use your ChatGPT plan through Codex, which is not signed in. Run “codex login” on the computer running OpenKumi.')
  if (!/chatgpt/i.test(info.detail)) return no('Calls need Codex to be signed in with a ChatGPT plan, not an API key. Run “codex login” on the computer running OpenKumi and choose ChatGPT.')
  return { available: true, reason: '' }
}

export function announceProviders() {
  emit({ type: 'providers', providers: providerInfos(), calls: callsInfo() })
}

/** Looks again at the providers that depend on a program installed on this computer, and tells the UI. */
export async function refreshProviders() {
  await Promise.all(providers.map((p) => p.refresh?.()))
  announceProviders()
}

onSettingsChange((now, before) => {
  // A new program path has to be looked at; switching a provider on or off only has to be announced.
  if (now.claudePath !== before.claudePath || now.codexPath !== before.codexPath || now.grokPath !== before.grokPath || now.localUrl !== before.localUrl) void refreshProviders()
  else if (now.disabledProviders.join() !== before.disabledProviders.join()) announceProviders()
})
