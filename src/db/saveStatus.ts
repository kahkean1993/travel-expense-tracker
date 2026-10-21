/**
 * Tracks whether writes to IndexedDB are in progress, succeeded or failed,
 * so the UI can show "Saving…" / "Saved" / an error only after the real
 * outcome is known.
 */
import { useSyncExternalStore } from 'react'

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string }

let state: SaveState = { kind: 'idle' }
let pending = 0
const listeners = new Set<() => void>()
const savedListeners = new Set<() => void>()

/** Runs `listener` after every successful local write (used to schedule sync). */
export function onLocalSave(listener: () => void) {
  savedListeners.add(listener)
  return () => {
    savedListeners.delete(listener)
  }
}

function set(next: SaveState) {
  state = next
  listeners.forEach((l) => l())
}

export function describeStorageError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  if (name === 'QuotaExceededError' || (error as { inner?: { name?: string } })?.inner?.name === 'QuotaExceededError') {
    return 'Your browser storage is full. Download a backup, then free up space or delete old trips.'
  }
  if (error instanceof Error && error.message) return error.message
  return 'Could not save to this browser. Try again, and download a backup to be safe.'
}

/** Wraps a write so the save indicator reflects its real outcome. */
export async function trackSave<T>(write: () => Promise<T>): Promise<T> {
  pending++
  set({ kind: 'saving' })
  try {
    const result = await write()
    pending--
    if (pending === 0) set({ kind: 'saved', at: Date.now() })
    savedListeners.forEach((l) => l())
    return result
  } catch (error) {
    pending--
    set({ kind: 'error', message: describeStorageError(error) })
    throw error
  }
}

export function useSaveState(): SaveState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}
