// Where the window keeps its copies of what environments on other computers sent it (see
// packages/client/src/copies.ts): one IndexedDB store of text under keys, in the app's own data
// folder. If it cannot be opened, nothing is kept and the app works as it would without it.
import type { Shelf } from '@openkumi/client/copies'

const NAME = 'openkumi-copies'
const STORE = 'copies'

let opening: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return opening
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error)
  })
const result = <T,>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
/** The keys that begin with `prefix`. */
const starting = (prefix: string) => IDBKeyRange.bound(prefix, `${prefix}￿`)

export const shelf: Shelf = {
  async get(keys) {
    const store = (await open()).transaction(STORE).objectStore(STORE)
    return Promise.all(keys.map(async (key) => ((await result(store.get(key))) as string | undefined) ?? null))
  },
  async set(entries) {
    const tx = (await open()).transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const [key, value] of entries) value === null ? store.delete(key) : store.put(value, key)
    await done(tx)
  },
  async clear(prefix) {
    const tx = (await open()).transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(starting(prefix))
    await done(tx)
  },
  async keys(prefix) {
    const store = (await open()).transaction(STORE).objectStore(STORE)
    return (await result(store.getAllKeys(starting(prefix)))) as string[]
  },
}
