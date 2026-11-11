// The desktop app behind this window (see apps/desktop/src/preload.ts). The app keeps the list of
// environments and runs the one on this computer; this window is told which one to talk to.
import { useSyncExternalStore } from 'react'
import type { DesktopBridge, DesktopState } from '@openbot/shared/desktop'

const bridge = (window as { openbotDesktop?: DesktopBridge }).openbotDesktop

/** False when the interface was opened somewhere other than the desktop app, where it cannot work. */
export const inDesktopApp = !!bridge
export const desktop = bridge as DesktopBridge

let state = (bridge?.initial ?? {}) as DesktopState
const listeners = new Set<(state: DesktopState) => void>()
bridge?.onState((next) => {
  state = next
  listeners.forEach((fn) => fn(next))
})

export const desktopState = () => state

export function onDesktopState(fn: (state: DesktopState) => void) {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

export function useDesktop(): DesktopState {
  return useSyncExternalStore(onDesktopState, desktopState)
}

/** What the app throws arrives wrapped in "Error invoking remote method …: Error: <reason>". */
export const reason = (e: unknown) => String((e as Error)?.message ?? e).replace(/^.*?Error: /, '')
