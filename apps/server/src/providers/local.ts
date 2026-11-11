// Models that run on this computer, through Ollama or LM Studio. Nothing leaves the machine and
// nothing is paid for. Both programs speak the same API as OpenAI, so this is Open Bot's own loop
// pointed at them; what it adds is finding them, with no address to type and no key.
import type { ProviderInfo } from '@openbot/shared'
import { settings } from '../settings.ts'
import { type Config, chat, modelsAt } from './openai-compat.ts'
import type { ModelRequest, Provider } from './types.ts'

/** Where each program listens when it is left as it comes. */
const USUAL = [
  { name: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1' },
  { name: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1' },
]
const base = { id: 'local', name: 'Local models', kind: 'local' as const }
let info: ProviderInfo = { ...base, connected: false, detail: 'Checking…' }
let found: { config: Config; models: string[] } | null = null

/** Looks for a local model server: the address from Settings if there is one, else the usual places. */
async function refresh() {
  const custom = settings().localUrl
  const places = custom ? [{ name: new URL(custom).host, baseUrl: custom }] : USUAL
  found = null
  for (const place of places) {
    const models = await modelsAt({ baseUrl: place.baseUrl, apiKey: '' }, 1500)
    if (!models) continue
    found = { config: { baseUrl: place.baseUrl, apiKey: '' }, models }
    info = models.length
      ? { ...base, connected: true, detail: `${place.name} · ${models.length} ${models.length === 1 ? 'model' : 'models'}`, baseUrl: place.baseUrl }
      : { ...base, connected: false, detail: `${place.name} is running, with no models`, hint: place.name === 'Ollama' ? 'Download one in a terminal, for example “ollama pull qwen3”.' : 'Download a model in that program first.', baseUrl: place.baseUrl }
    return
  }
  info = custom
    ? { ...base, connected: false, detail: 'Not answering', hint: `Nothing answers at ${custom}. Start the program, or correct the address.` }
    : { ...base, connected: false, detail: 'Not running', hint: 'Install Ollama (ollama.com) or LM Studio on this computer and start it. It is found by itself.' }
}

export const localModels: Provider = {
  id: base.id,
  info: () => info,
  async models() {
    // Models come and go as they are downloaded, so the list is read again when it is asked for.
    await refresh()
    return found?.models ?? []
  },
  stream(req: ModelRequest) {
    if (!found) throw new Error('No local model server is running on this computer. Start Ollama or LM Studio.')
    return chat(found.config, req)
  },
  refresh,
}
