// The models each provider offers, as the environment reports them: their names, what they are
// for and the reasoning levels they take. Asked for once per provider and kept, so the model
// pickers open with what is already known and fill in the rest. Shared by the desktop app's model
// picker and the phone's model sheet, so both offer the same choices by the same rules.
import { useEffect, useSyncExternalStore } from 'react'
import type { Bot, Effort, ModelInfo, ProviderInfo } from '@openkumi/shared'
import { api, onEnvironmentChange } from './store'

const known = new Map<string, ModelInfo[]>()
const asking = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()
let version = 0
const changed = () => (version++, listeners.forEach((fn) => fn()))
// Another environment has providers of the same names, with models of its own.
onEnvironmentChange(() => (known.clear(), asking.clear(), changed()))

/** Asks a provider for its models, unless that is already under way. `again` asks even if they are known. */
export function loadModels(provider: string, again = false): Promise<void> {
  if (known.has(provider) && !again) return Promise.resolve()
  let request = asking.get(provider)
  if (!request) {
    // An environment that has not been updated yet names its models by id alone.
    request = api<(ModelInfo | string)[]>('GET', `/api/providers/${provider}/models`)
      .then((list) => void known.set(provider, list.map((m) => (typeof m === 'string' ? { id: m, name: m === 'default' ? 'Default' : m } : m))), () => void (known.has(provider) || known.set(provider, [])))
      .finally(() => (asking.delete(provider), changed()))
    asking.set(provider, request)
  }
  return request
}

const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn))

/** The models of each of these providers, its default first. A provider that has not answered yet is missing. */
export function useModelLists(providers: string[]): Map<string, ModelInfo[]> {
  useSyncExternalStore(subscribe, () => version)
  const wanted = providers.join()
  useEffect(() => {
    for (const provider of wanted ? wanted.split(',') : []) void loadModels(provider)
  }, [wanted])
  return known
}

/** The models a provider offers, its default first. Empty until they have been fetched, or when it is not connected. */
export function useModels(provider: string, connected: boolean | undefined): ModelInfo[] {
  return useModelLists(connected ? [provider] : []).get(provider) ?? []
}

export const EFFORT_LABEL: Record<Exclude<Effort, ''>, string> = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' }
/** The reasoning levels to offer for a model: its own when the provider says, else the three most models take. */
export const effortsOf = (model: ModelInfo | undefined): Exclude<Effort, ''>[] => model?.efforts ?? ['low', 'medium', 'high']

/** One model a bot can be put on, as a picker offers it. */
export interface Choice {
  provider: ProviderInfo
  info: ModelInfo
  /** What is stored for the bot: empty for the provider's own default, so the bot follows it if it changes. */
  model: string
  isDefault: boolean
  /** "<provider>:<model>", as favorites are kept. */
  key: string
}

/** A provider's models as choices. Its first model is its default. */
export function choicesOf(provider: ProviderInfo, models: ModelInfo[], bot: Bot): Choice[] {
  // A model the bot was given that the provider no longer lists is still its model, and is shown.
  const lost = bot.provider === provider.id && bot.model && !models.some((m) => m.id === bot.model) ? [{ id: bot.model, name: bot.model }] : []
  return [...models, ...lost].map((info, i) => ({ provider, info, model: i === 0 ? '' : info.id, isDefault: i === 0, key: `${provider.id}:${i === 0 ? '' : info.id}` }))
}

/** What to save to put a bot on this model. A reasoning level the new model does not take is not carried over to it. */
export function switchTo(bot: Bot, choice: Choice): Partial<Bot> {
  const keeps = !bot.effort || effortsOf(choice.info).includes(bot.effort)
  return { provider: choice.provider.id, model: choice.model, ...(keeps ? {} : { effort: '' }) }
}
