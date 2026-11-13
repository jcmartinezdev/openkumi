// Where the phone keeps its copy of what the paired computer sent it (see
// packages/client/src/copies.ts): one SQLite table of text under keys, in the app's own storage,
// which only the app can read. If it cannot be opened, nothing is kept and the app works without it.
import * as SQLite from 'expo-sqlite'
import type { Shelf } from '@openkumi/client/copies'

let opening: Promise<SQLite.SQLiteDatabase> | null = null
function open(): Promise<SQLite.SQLiteDatabase> {
  opening ??= SQLite.openDatabaseAsync('openkumi-copies.db').then(async (db) => {
    await db.execAsync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS copies (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;')
    return db
  })
  return opening
}

/** The keys that begin with `prefix` sort from it up to it followed by the last character there is. */
const range = (prefix: string) => [prefix, `${prefix}￿`] as const

export const shelf: Shelf = {
  async get(keys) {
    const db = await open()
    return Promise.all(keys.map(async (key) => (await db.getFirstAsync<{ value: string }>('SELECT value FROM copies WHERE key = ?', key))?.value ?? null))
  },
  async set(entries) {
    const db = await open()
    await db.withExclusiveTransactionAsync(async (tx) => {
      for (const [key, value] of entries) {
        if (value === null) await tx.runAsync('DELETE FROM copies WHERE key = ?', key)
        else await tx.runAsync('INSERT OR REPLACE INTO copies (key, value) VALUES (?, ?)', key, value)
      }
    })
  },
  async clear(prefix) {
    await (await open()).runAsync('DELETE FROM copies WHERE key >= ? AND key < ?', ...range(prefix))
  },
  async keys(prefix) {
    const rows = await (await open()).getAllAsync<{ key: string }>('SELECT key FROM copies WHERE key >= ? AND key < ?', ...range(prefix))
    return rows.map((r) => r.key)
  },
}
