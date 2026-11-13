// Models kept at hand in the model sheet, as "<provider>:<model>" (the same keys as the computer's
// favorites, which stay on the computer). Kept on this phone, next to the paired server.
import { useSyncExternalStore } from 'react'
import * as SecureStore from 'expo-secure-store'

const SAVED = 'openkumi.favoriteModels'
let favorites: string[] = []
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => (listeners.add(fn), () => void listeners.delete(fn))
const set = (next: string[]) => ((favorites = next), listeners.forEach((fn) => fn()))

SecureStore.getItemAsync(SAVED)
  .then((saved) => {
    const list: unknown = JSON.parse(saved ?? '[]')
    if (Array.isArray(list)) set(list.filter((key) => typeof key === 'string'))
  })
  .catch(() => {
    // Nothing saved, or it cannot be read: there are no favorites yet.
  })

export const useFavorites = () => useSyncExternalStore(subscribe, () => favorites)

export function toggleFavorite(key: string) {
  set(favorites.includes(key) ? favorites.filter((k) => k !== key) : [...favorites, key])
  void SecureStore.setItemAsync(SAVED, JSON.stringify(favorites)).catch(() => {})
}
