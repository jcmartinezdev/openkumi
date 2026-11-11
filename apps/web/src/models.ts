import { useEffect, useState } from 'react'
import { api, onEnvironmentChange } from './store'

const cache = new Map<string, string[]>()
// Another environment has providers of the same names, with models of its own.
onEnvironmentChange(() => cache.clear())

/** The models a provider offers, best default first. Empty until they have been fetched, or when it is not connected. */
export function useModels(provider: string, connected: boolean | undefined): string[] {
  const [models, setModels] = useState<string[]>(cache.get(provider) ?? [])
  useEffect(() => {
    setModels(cache.get(provider) ?? [])
    if (!connected) return
    // A slow reply for a provider that has since been left must not replace the current list.
    let current = true
    api<string[]>('GET', `/api/providers/${provider}/models`)
      .then((list) => {
        cache.set(provider, list)
        if (current) setModels(list)
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [provider, connected])
  return models
}
