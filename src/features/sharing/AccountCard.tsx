import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema'
import { Button, Card, ConfirmDialog, FieldError, Notice, SectionTitle } from '../../components/ui'
import { useBusy } from '../../components/useBusy'
import { cloudConfigured, signOut, syncEngine, useAuth, useSyncStatus } from '../../sync/cloud'
import { SignInForm } from './SignInForm'

/** Settings: sign-in and sync status for shared trips. */
export function AccountCard() {
  const auth = useAuth()
  const status = useSyncStatus()
  const pending = useLiveQuery(() => db.outbox.count()) ?? 0
  const failed = useLiveQuery(() => db.outbox.filter((e) => !!e.error).toArray()) ?? []
  const cloudTrips = useLiveQuery(() => db.trips.filter((t) => t.syncMode === 'cloud').count()) ?? 0
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, run] = useBusy()

  if (!cloudConfigured) return null

  return (
    <Card>
      <SectionTitle>Account & shared trips</SectionTitle>
      {auth.status === 'loading' ? (
        <p className="text-sm text-slate-600">Checking sign-in…</p>
      ) : auth.status !== 'signedIn' ? (
        <>
          <SignInForm intro="Sign in to share trips with travel companions and see the same expenses on all your devices. Trips you don't share stay on this device only." />
          {auth.status === 'signedOut' && auth.error ? (
            <div className="mt-3">
              <FieldError>{auth.error}</FieldError>
            </div>
          ) : null}
        </>
      ) : (
        <div className="space-y-3 text-sm">
          {auth.anonymous ? (
            <p>
              You joined shared trips <strong>without an email</strong>. This phone is your account: if you clear browser data or
              switch phones, open the invite link again and pick your name.
            </p>
          ) : (
            <p>
              Signed in as <strong>{auth.email}</strong>
            </p>
          )}
          <p className="text-slate-700" aria-live="polite">
            {status.phase === 'syncing'
              ? 'Syncing…'
              : status.phase === 'offline'
                ? status.message
                : status.lastSyncedAt
                  ? `Last synced ${new Date(status.lastSyncedAt).toLocaleTimeString()}.`
                  : 'Not synced yet.'}
            {pending - failed.length > 0 ? ` ${pending - failed.length} change(s) waiting to upload.` : ''}
          </p>
          {status.phase === 'error' && status.message ? <Notice tone="danger">{status.message}</Notice> : null}
          {failed.length ? (
            <div className="space-y-2 rounded-lg border border-red-200 p-3">
              <p className="font-medium text-red-900">The server didn't accept {failed.length} change{failed.length === 1 ? '' : 's'}:</p>
              <ul className="list-disc pl-5 text-slate-700">
                {failed.slice(0, 5).map((f) => (
                  <li key={f.key}>{f.error}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void run(() => syncEngine!.retryFailed())}>
                  Try again
                </Button>
                <Button variant="danger" disabled={busy} onClick={() => void run(() => syncEngine!.discardFailed())}>
                  Discard and use the shared version
                </Button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || status.phase === 'syncing'} onClick={() => void run(() => syncEngine!.sync())}>
              Sync now
            </Button>
            <Button onClick={() => setConfirmSignOut(true)}>Sign out</Button>
          </div>
          {error ? <FieldError>{error}</FieldError> : null}
        </div>
      )}

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out?"
        confirmLabel="Sign out"
        busy={busy}
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() =>
          void run(async () => {
            try {
              await signOut()
              setConfirmSignOut(false)
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Sign-out failed.')
              setConfirmSignOut(false)
            }
          })
        }
      >
        <p>
          {cloudTrips} shared trip{cloudTrips === 1 ? '' : 's'} will be removed from this device.{' '}
          {auth.status === 'signedIn' && auth.anonymous
            ? 'You joined without an email, so to get back in you will need the invite link again.'
            : 'They stay online, and come back when you sign in again.'}{' '}
          Trips that aren't shared stay on this device.
        </p>
        {pending ? (
          <div className="mt-2">
            <Notice tone="warning">
              {pending} change{pending === 1 ? ' has' : 's have'} not been uploaded and will be lost. Go online and sync first
              if you want to keep {pending === 1 ? 'it' : 'them'}.
            </Notice>
          </div>
        ) : null}
      </ConfirmDialog>
    </Card>
  )
}
