// The models each provider offers, as the environment reports them: their names, what they are
// for and the reasoning levels they take. Asked for once per provider and kept, so the model
// picker opens with what is already known and fills in the rest.
import { useEffect, useSyncExternalStore } from 'react'
import type { Effort, ModelInfo } from '@openbot/shared'
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
