import { useEffect, useState, useSyncExternalStore } from 'react'
import { useSaveState } from '../db/saveStatus'
import { IconAlert, IconCheck, IconCloudOff } from './Icons'

export function SaveIndicator() {
  const state = useSaveState()
  // Show "Saved" briefly after each successful write, then fade back to nothing.
  const [hiddenAt, setHiddenAt] = useState(0)
  const savedAt = state.kind === 'saved' ? state.at : 0
  useEffect(() => {
    if (!savedAt) return
    const t = setTimeout(() => setHiddenAt(savedAt), 2500)
    return () => clearTimeout(t)
  }, [savedAt])
  const fresh = savedAt > hiddenAt

  let content: React.ReactNode = null
  if (state.kind === 'saving') content = <span className="text-slate-600">Saving…</span>
  else if (state.kind === 'saved' && fresh)
    content = (
      <span className="inline-flex items-center gap-1 text-accent-700">
        <IconCheck width={16} height={16} /> Saved
      </span>
    )
  else if (state.kind === 'error')
    content = (
      <span className="inline-flex items-center gap-1 font-medium text-red-700">
        <IconAlert width={16} height={16} /> Not saved
      </span>
    )
  return (
    <div className="min-w-16 text-right text-xs" aria-live="polite">
      {content}
    </div>
  )
}

/** Global banner for write failures, with a recovery suggestion. */
export function SaveErrorBanner() {
  const state = useSaveState()
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)
  if (state.kind !== 'error' || dismissedFor === state.message) return null
  return (
    <div className="no-print border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900" role="alert">
      <div className="mx-auto flex max-w-5xl items-start gap-2">
        <IconAlert width={18} height={18} className="mt-0.5 shrink-0" />
        <p className="flex-1">
          <strong>Your last change was not saved.</strong> {state.message}
        </p>
        <button type="button" className="underline" onClick={() => setDismissedFor(state.message)}>
          Dismiss
        </button>
      </div>
    </div>
  )
}

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

export function OnlineIndicator() {
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine)
  if (online) return null
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700"
      title="You're offline. Everything still works and is saved on this device."
    >
      <IconCloudOff width={14} height={14} /> Offline
    </span>
  )
}
