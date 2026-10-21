import { useCallback, useRef, useState } from 'react'

/**
 * Runs one async action at a time. Extra taps while it is running are
 * ignored, which prevents duplicate submissions. Errors are logged and
 * resolve to undefined (the global save banner already reports write
 * failures); catch inside the action to show an inline message instead.
 */
export function useBusy(): [boolean, <T>(action: () => Promise<T>) => Promise<T | undefined>] {
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(action: () => Promise<T>) => {
    if (running.current) return undefined
    running.current = true
    setBusy(true)
    try {
      return await action()
    } catch (error) {
      console.error(error)
      return undefined
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [])
  return [busy, run]
}
