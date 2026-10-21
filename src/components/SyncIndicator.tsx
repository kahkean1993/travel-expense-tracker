import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/schema'
import { href, paths } from '../app/router'
import { useAuth, useSyncStatus } from '../sync/cloud'
import { IconAlert, IconCloudOff } from './Icons'

/** Compact shared-trip sync state for the top bar. Hidden when there's nothing to say. */
export function SyncIndicator() {
  const auth = useAuth()
  const status = useSyncStatus()
  const pending = useLiveQuery(() => db.outbox.count()) ?? 0
  if (auth.status !== 'signedIn') return null

  if (status.phase === 'error') {
    return (
      <a href={href(paths.settings())} className="inline-flex items-center gap-1 text-xs font-medium text-red-700" title={status.message ?? ''}>
        <IconAlert width={14} height={14} /> Sync problem
      </a>
    )
  }
  if (status.phase === 'offline' && pending) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-600" title={status.message ?? ''}>
        <IconCloudOff width={14} height={14} /> {pending} to upload
      </span>
    )
  }
  if (status.phase === 'syncing') return <span className="text-xs text-slate-600">Syncing…</span>
  return null
}
