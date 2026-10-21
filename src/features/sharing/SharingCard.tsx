import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema'
import type { TripData } from '../../db/hooks'
import { travellersRepo } from '../../db/repositories'
import { navigate, paths } from '../../app/router'
import { Button, Card, ConfirmDialog, FieldError, Notice, SectionTitle } from '../../components/ui'
import { inputClass } from '../../components/styles'
import { useBusy } from '../../components/useBusy'
import { cloudConfigured, inviteUrl, syncEngine, useAuth } from '../../sync/cloud'
import { describeError } from './errors'
import { SignInForm } from './SignInForm'

/** Sharing controls for a trip, shown on the Travellers & Split page. */
export function SharingCard({ data }: { data: TripData }) {
  const auth = useAuth()
  if (!cloudConfigured || !syncEngine) return null
  if (data.trip.syncMode === 'cloud' && auth.status === 'signedIn') return <SharedTrip data={data} userId={auth.userId} />
  return (
    <Card>
      <SectionTitle>Share this trip</SectionTitle>
      {data.trip.isSample ? (
        <p className="text-sm text-slate-600">Sample trips can't be shared. Create your own trip to share it.</p>
      ) : auth.status === 'signedIn' ? (
        <ShareLocalTrip data={data} userId={auth.userId} />
      ) : auth.status === 'loading' ? (
        <p className="text-sm text-slate-600">Checking sign-in…</p>
      ) : (
        <SignInForm intro="Sign in with your email to share this trip, so your companions can see it and add expenses from their phones." />
      )}
    </Card>
  )
}

function defaultMe(data: TripData, userId: string) {
  return (
    data.travellers.find((t) => t.userId === userId) ??
    data.travellers.find((t) => t.displayName.trim().toLowerCase() === 'me') ??
    data.travellers[0]
  )?.id
}

function ShareLocalTrip({ data, userId }: { data: TripData; userId: string }) {
  const [me, setMe] = useState(() => defaultMe(data, userId) ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, run] = useBusy()
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-600">
        This trip is only on this device. Sharing uploads it to your account; then you can send an invite link so 3–4
        companions can see it and add expenses. Everyone's changes sync automatically.
      </p>
      <label className="flex flex-col gap-1 font-medium text-slate-700">
        Which traveller are you?
        <select className={inputClass} value={me} onChange={(e) => setMe(e.target.value)}>
          {data.travellers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.displayName}
            </option>
          ))}
        </select>
      </label>
      <Button
        variant="primary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            try {
              setError(null)
              await syncEngine!.shareTrip(data.trip.id, me || undefined)
            } catch (e) {
              setError(describeError(e))
            }
          })
        }
      >
        {busy ? 'Sharing…' : 'Share trip'}
      </Button>
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  )
}

function SharedTrip({ data, userId }: { data: TripData; userId: string }) {
  const { trip, travellers } = data
  const members = useLiveQuery(() => db.members.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const pending = useLiveQuery(() => db.outbox.where('tripId').equals(trip.id).count(), [trip.id]) ?? 0
  const isOwner = trip.ownerId === userId
  const [invite, setInvite] = useState<{ url: string; expiresAt: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'leave' } | { kind: 'remove'; userId: string; label: string } | null>(null)
  const [busy, run] = useBusy()
  const meTraveller = travellers.find((t) => t.userId === userId)

  const act = (fn: () => Promise<void>) =>
    void run(async () => {
      try {
        setError(null)
        await fn()
      } catch (e) {
        setError(describeError(e))
      }
    })

  return (
    <Card>
      <SectionTitle>Shared trip</SectionTitle>
      <div className="space-y-4 text-sm">
        <p className="text-slate-600">
          {members.length} {members.length === 1 ? 'person has' : 'people have'} access. Changes sync between everyone's
          devices{pending ? ` · ${pending} change${pending === 1 ? '' : 's'} waiting to upload` : ''}.
        </p>

        <label className="flex flex-col gap-1 font-medium text-slate-700">
          You are
          <select
            className={inputClass}
            value={meTraveller?.id ?? ''}
            onChange={(e) => act(() => travellersRepo.linkUser(e.target.value, userId))}
          >
            {meTraveller ? null : <option value="">Choose your name…</option>}
            {travellers.map((t) => (
              <option key={t.id} value={t.id} disabled={!!t.userId && t.userId !== userId}>
                {t.displayName}
                {t.userId && t.userId !== userId ? ' (linked to another member)' : ''}
              </option>
            ))}
          </select>
          <span className="text-xs font-normal text-slate-500">Used as the default payer when you add expenses.</span>
        </label>

        <div>
          <h3 className="mb-1 font-medium text-slate-700">Members</h3>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {members.map((m) => (
              <li key={m.userId} className="flex min-h-11 items-center gap-2 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate">
                  {m.email ?? 'Member'}
                  {m.userId === userId ? <span className="text-slate-500"> (you)</span> : null}
                </span>
                {m.role === 'owner' ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">Owner</span> : null}
                {isOwner && m.userId !== userId ? (
                  <Button
                    variant="ghost"
                    className="text-red-700 hover:bg-red-50"
                    onClick={() => setConfirm({ kind: 'remove', userId: m.userId, label: m.email ?? 'this member' })}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2">
          <h3 className="font-medium text-slate-700">Invite companions</h3>
          {invite ? (
            <>
              <div className="flex gap-2">
                <input className={`${inputClass} text-sm`} readOnly value={invite.url} aria-label="Invite link" onFocus={(e) => e.target.select()} />
                <Button
                  onClick={() =>
                    void navigator.clipboard?.writeText(invite.url).then(
                      () => setCopied(true),
                      () => setError('Copy failed. Select the link and copy it manually.'),
                    )
                  }
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {typeof navigator.share === 'function' ? (
                <Button
                  onClick={() =>
                    void navigator.share({ title: trip.name, text: `Join "${trip.name}" in Travel Expense Tracker`, url: invite.url }).catch(() => {})
                  }
                >
                  Share via…
                </Button>
              ) : null}
              <p className="text-xs text-slate-500">
                Anyone with this link can join the trip until {new Date(invite.expiresAt).toLocaleDateString()}. Send it only to
                your travel companions.
              </p>
            </>
          ) : (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  const created = await syncEngine!.createInvite(trip.id)
                  setInvite({ url: inviteUrl(created.token), expiresAt: created.expiresAt })
                  setCopied(false)
                })
              }
            >
              Create invite link
            </Button>
          )}
        </div>

        {error ? <FieldError>{error}</FieldError> : null}

        {isOwner ? (
          <p className="text-xs text-slate-500">You own this trip. Deleting it from “Edit trip” deletes it for every member.</p>
        ) : (
          <Button variant="danger" onClick={() => setConfirm({ kind: 'leave' })}>
            Leave trip
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirm?.kind === 'leave'}
        title="Leave this trip?"
        confirmLabel="Leave trip"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          act(async () => {
            await syncEngine!.leaveTrip(trip.id)
            setConfirm(null)
            navigate(paths.trips(), { replace: true })
          })
        }
      >
        The trip is removed from this device and you lose access. Expenses stay with the other members. You can rejoin
        with a new invite link.
        {pending ? (
          <Notice tone="warning">
            {pending} change{pending === 1 ? ' has' : 's have'} not uploaded yet and will be lost.
          </Notice>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        title="Remove member?"
        confirmLabel="Remove"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          act(async () => {
            if (confirm?.kind === 'remove') await syncEngine!.removeMember(trip.id, confirm.userId)
            setConfirm(null)
          })
        }
      >
        {confirm?.kind === 'remove' ? confirm.label : ''} will lose access to this trip. Expenses they added stay. Old invite
        links still work until they expire, so only share new ones with people you trust.
      </ConfirmDialog>
    </Card>
  )
}
