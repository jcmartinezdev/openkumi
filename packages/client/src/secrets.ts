// A bot's secrets as its owner meets them in the apps: the list in the bot's settings, and the
// card a bot's ask_secret call is in the conversation. The words are the same in every app.
import { useEffect, useState } from 'react'
import type { Secret, Secrets, VaultKeeper } from '@openkumi/shared'
import { moment } from './automations'
import { parse } from './steps'
import { api, useStore } from './store'

const path = (botId: string, name = '') => `/api/bots/${encodeURIComponent(botId)}/secrets${name ? `/${encodeURIComponent(name)}` : ''}`

/** A bot's secrets, fetched again whenever one is added, replaced or removed. Null until they have come. */
export function useSecrets(botId: string): { data: Secrets | null; error: string } {
  const version = useStore((s) => s.secretsVersion[botId] ?? 0)
  const connected = useStore((s) => s.connected)
  const [fetched, setFetched] = useState<(Secrets & { botId: string }) | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!connected) return
    let current = true
    api<Secrets>('GET', path(botId)).then(
      (r) => current && (setError(''), setFetched({ botId, ...r })),
      (e: Error) => current && setError(e.message),
    )
    return () => {
      current = false
    }
  }, [botId, version, connected])
  return { data: fetched?.botId === botId ? fetched : null, error }
}

/** What stands in for a name where a new secret is being added: no secret can be called this (a name begins with a letter or a digit). */
export const NEW_SECRET = '_new'

/** Adds a secret. A name that is taken is refused: adding never writes over what is kept. */
export const addSecret = (botId: string, secret: { name: string; value: string; sites: string; what?: string }) => api<Secret>('POST', path(botId), secret)
/** Changes a secret that is there: what it is, where it may go, or (with `value`) the value itself. */
export const saveSecret = (botId: string, name: string, patch: { value?: string; sites?: string; what?: string }) => api<Secret>('PUT', path(botId, name), patch)
export const removeSecret = (botId: string, name: string) => api('DELETE', path(botId, name))
/** The value itself. Only the computer that runs OpenKumi is given it. */
export const showSecret = async (botId: string, name: string) => (await api<{ value: string }>('GET', `${path(botId, name)}/value`)).value

/** The owner's answer to a bot that asked for a secret: the value, or no. */
export const answerSecret = (callId: string, value: string) => api('POST', `/api/secret-requests/${encodeURIComponent(callId)}`, { value })
export const declineSecret = (callId: string) => api('POST', `/api/secret-requests/${encodeURIComponent(callId)}`, { declined: true })

/** Where the key that a person's secrets are encrypted with is kept, in words. */
export const KEPT: Record<VaultKeeper, string> = {
  keychain: 'the keychain of the Mac that runs OpenKumi',
  keyring: 'the keyring of the computer that runs OpenKumi',
  windows: 'a file that Windows opens only for your account on the computer that runs OpenKumi',
  file: 'a file only your account can read on the computer that runs OpenKumi, outside the folder with your data',
}

/** How a bot's secrets are kept, said once above the list. */
export const howKept = (kept: VaultKeeper | null) =>
  `A secret is kept encrypted, and the bot uses it by name without ever seeing it. It is sent only to the sites it is for.${kept ? ` The key that opens them is in ${KEPT[kept]}.` : ''}`

/** When a secret was last used, and who put it there, in a line. */
export function secretStanding(secret: Secret, botName: string): string {
  const by = secret.by === 'bot' ? `Kept by ${botName}` : 'Added by you'
  return `${by} · ${secret.usedAt ? `last used ${moment(secret.usedAt)}` : 'not used yet'}`
}

/**
 * What a bot asked for with ask_secret, and what became of it. The card is drawn from the call
 * itself, which is what the server keeps the value under: `waiting` while the bot waits for it,
 * `saved` and `declined` once the owner answered, `unanswered` when the wait ended without one,
 * and `failed` when the bot asked in a way that could not be shown.
 */
export interface SecretAsk {
  callId: string
  name: string
  site: string
  what: string
  /** Where the owner makes or finds it, when the bot knew. */
  where: string | null
  /** The bot has one of this name, which what is typed takes the place of. */
  replaces: boolean
  state: 'waiting' | 'saved' | 'declined' | 'unanswered' | 'failed'
}

export function secretAsk(call: { arguments: string; call_id: string }, output: string | undefined, running: boolean): SecretAsk {
  const a = parse(call.arguments)
  const where = typeof a.where === 'string' && /^https?:\/\//i.test(a.where) ? a.where : null
  const state =
    output === undefined ? (running ? 'waiting' : 'unanswered')
    : output.startsWith('Saved') ? 'saved'
    : output.startsWith('The user said no') ? 'declined'
    : output.startsWith('Error:') ? 'failed'
    : 'unanswered'
  return { callId: call.call_id, name: String(a.name ?? ''), site: String(a.site ?? ''), what: String(a.what ?? '') || 'A secret', where, replaces: a.replace === true, state }
}
