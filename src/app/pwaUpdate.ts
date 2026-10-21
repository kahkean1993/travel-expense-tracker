/**
 * Service worker registration. A new deployment is announced with a banner
 * instead of reloading automatically, so a half-entered expense is never lost.
 */
import { useSyncExternalStore } from 'react'
import { registerSW } from 'virtual:pwa-register'

let applyUpdate: (() => void) | null = null
const listeners = new Set<() => void>()

export function startServiceWorker() {
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      applyUpdate = () => void update(true)
      listeners.forEach((l) => l())
    },
  })
}

export function useAppUpdate(): (() => void) | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => applyUpdate,
  )
}
