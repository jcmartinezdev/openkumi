// Webhooks in words, the same in every app: where one is called, and how it stands.
import type { Hook } from '@openkumi/shared'
import { moment } from './automations'

/** The address an app is given for a webhook: where the internet reaches this computer's webhooks, and the webhook's own end. Empty until that is known. */
export const hookAddress = (base: string, hook: Pick<Hook, 'id'>) => (base ? `${base.replace(/\/+$/, '')}/hooks/${hook.id}` : '')

/** How a webhook stands, in a line. */
export function hookStanding(hook: Hook, app: string): string {
  if (!hook.secret) return `Waiting for the secret ${app} signs its calls with`
  // A call that was refused after the last one that was taken: the secret here is not the one the app signs with.
  if (hook.refusedAt && hook.refusedAt > (hook.lastCallAt ?? 0)) return `A call was refused ${moment(hook.refusedAt)}: it was not signed with this secret`
  if (!hook.lastCallAt) return `Ready. ${app} has not called yet`
  return `${app} last called ${moment(hook.lastCallAt)} · ${hook.calls} ${hook.calls === 1 ? 'call' : 'calls'} so far`
}
