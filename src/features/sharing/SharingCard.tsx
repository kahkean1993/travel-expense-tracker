import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema'
import type { TripData } from '../../db/hooks'
import { travellersRepo } from '../../db/repositories'
import { navigate, paths } from '../../app/router'
import { Button, Card, ChipGroup, ConfirmDialog, Field, FieldError, Notice, SectionTitle, TextInput } from '../../components/ui'
import { inputClass } from '../../components/styles'
import { useBusy } from '../../components/useBusy'
import {
  cloudConfigured,
  inviteUrl,
  rememberPendingShare,
  requestSync,
  syncEngine,
  useAuth,
} from '../../sync/cloud'
import type { Invite } from '../../sync/remote'
import { describeError } from './errors'
import { Avatar } from '../../components/visuals'
import { SignInForm } from './SignInForm'

const isPlaceholderName = (name: string) => /^me$/i.test(name.trim())

/** Sharing controls for a trip, shown at the top of the Travellers & Split page. */
export function SharingCard({ data }: { data: TripData }) {
  const auth = useAuth()
  if (!cloudConfigured || !syncEngine) return null
  const { trip } = data

  if (trip.syncMode === 'cloud') {
    return auth.status === 'signedIn' ? <SharedTrip data={data} userId={auth.userId} anonymous={auth.anonymous} /> : null
  }
  // People who joined without an email can't create or share trips of their own.
  if (auth.status === 'signedIn' && auth.anonymous) return null

  return (
    <Card>
      <SectionTitle>Share with friends</SectionTitle>
      {trip.isSample ? (
        <p className="text-sm text-slate-600">Sample trips can't be shared. Create your own trip to share it.</p>
      ) : auth.status === 'signedIn' ? (
        <ShareLocalTrip data={data} userId={auth.userId} />
      ) : auth.status === 'loading' ? (
        <p className="text-sm text-slate-600">Checking sign-in…</p>
      ) : (
        <SignInForm
          onEmailSent={() => rememberPendingShare(trip.id)}
          intro={
            <>
              Share this trip so friends can add expenses from their own phones. <strong>You</strong> sign in once with your
              email; your friends won't need an email at all.
            </>
          }
        />
      )}
    </Card>
  )
}

/** Best guess of which traveller is the signed-in person. */
function guessMe(data: TripData, userId: string) {
  return (
    data.travellers.find((t) => t.userId === userId) ??
    data.travellers.find((t) => isPlaceholderName(t.displayName)) ??
    data.travellers[0]
  )
}

function ShareLocalTrip({ data, userId }: { data: TripData; userId: string }) {
  const { trip, travellers } = data
  const [meId, setMeId] = useState(() => guessMe(data, userId)?.id ?? '')
  const [ownName, setOwnName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, run] = useBusy()
  const me = travellers.find((t) => t.id === meId)
  const needsName = !!me && isPlaceholderName(me.displayName)

  // We're back from the sign-in email (if there was one); nothing left to continue.
  useEffect(() => rememberPendingShare(null), [])

  function share() {
    if (!me) return setError('Choose which traveller you are.')
    const name = ownName.trim()
    if (needsName && !name) return setError('Type your name. Your friends will see it next to your expenses.')
    if (needsName && travellers.some((t) => t.id !== me.id && t.displayName.toLowerCase() === name.toLowerCase())) {
      return setError(`"${name}" is already on this trip. Use a different name.`)
    }
    setError(null)
    void run(async () => {
      try {
        if (needsName) await travellersRepo.rename(me.id, name)
        await syncEngine!.shareTrip(trip.id, me.id)
      } catch (e) {
        setError(describeError(e))
      }
    })
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-slate-600">
        Your friends open a link, pick their name and they're in. No email or password for them. Everyone then sees and adds
        to the same expenses.
      </p>
      {travellers.length > 1 ? (
        <ChipGroup
          label="Which one is you?"
          options={travellers.map((t) => ({ value: t.id, label: t.displayName }))}
          value={meId}
          onChange={setMeId}
        />
      ) : null}
      {needsName ? (
        <Field label="Your name (friends will see it)" htmlFor="own-name">
          <TextInput id="own-name" value={ownName} maxLength={40} placeholder="e.g. Kean" onChange={(e) => setOwnName(e.target.value)} />
        </Field>
      ) : null}
      <Button variant="primary" disabled={busy} onClick={share}>
        {busy ? 'Sharing…' : 'Share with friends'}
      </Button>
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  )
}

function SharedTrip({ data, userId, anonymous }: { data: TripData; userId: string; anonymous: boolean }) {
  const { trip, travellers } = data
  const members = useLiveQuery(() => db.members.where('tripId').equals(trip.id).toArray(), [trip.id]) ?? []
  const pending = useLiveQuery(() => db.outbox.where('tripId').equals(trip.id).count(), [trip.id]) ?? 0
  const isOwner = trip.ownerId === userId
  const me = travellers.find((t) => t.userId === userId)

  // undefined = still looking, null = no working link yet.
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'leave' } | { kind: 'remove'; userId: string; label: string } | null>(null)
  const [busy, run] = useBusy()

  useEffect(() => {
    let cancelled = false
    Promise.resolve()
      .then(() => syncEngine!.getInvite(trip.id))
      .then(
        (found) => {
          if (!cancelled) setInvite(found)
        },
        () => {
          if (!cancelled) setInvite(null) // offline: the buttons below explain what to do
        },
      )
    return () => {
      cancelled = true
    }
  }, [trip.id])

  const act = (fn: () => Promise<void>) =>
    void run(async () => {
      try {
        setError(null)
        setNote(null)
        await fn()
      } catch (e) {
        setError(describeError(e))
      }
    })

  const url = invite ? inviteUrl(invite.token) : null
  const message = `Join "${trip.name}" on Travel Expense Tracker. Open the link and pick your name:`

  async function sendInvite() {
    if (!url) return
    setError(null)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: trip.name, text: message, url })
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return // closed the share sheet
        // Fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(`${message}\n${url}`)
      setNote('Link copied. Paste it into WhatsApp or a message.')
    } catch {
      setError('Could not copy automatically. Select the link below and copy it.')
    }
  }

  const memberLabel = (m: (typeof members)[number]) =>
    travellers.find((t) => t.userId === m.userId)?.displayName ?? m.email ?? 'Joined (no name picked)'

  return (
    <Card>
      <SectionTitle>Share with friends</SectionTitle>
      <div className="space-y-4 text-sm">
        <div className="space-y-2">
          {invite === undefined ? (
            <p className="text-slate-600">Checking the invite link…</p>
          ) : invite ? (
            <>
              <Button variant="primary" className="w-full sm:w-auto" onClick={() => void sendInvite()}>
                Send invite link
              </Button>
              <input
                className={`${inputClass} text-sm`}
                readOnly
                value={url ?? ''}
                aria-label="Invite link"
                onFocus={(e) => e.target.select()}
              />
              <p className="text-xs text-slate-500">
                One link works for everyone. Friends open it, pick their name and join. It stops working on{' '}
                {new Date(invite.expiresAt).toLocaleDateString()}, so only send it to people you trust.
              </p>
            </>
          ) : (
            <>
              <p className="text-slate-600">The invite link is switched off.</p>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    setInvite(await syncEngine!.getOrCreateInvite(trip.id))
                  })
                }
              >
                Create invite link
              </Button>
            </>
          )}
          {note ? <p className="text-accent-800">{note}</p> : null}
        </div>

        <div>
          <h3 className="mb-1 font-medium text-slate-700">On this trip ({members.length})</h3>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {members.map((m) => (
              <li key={m.userId} className="flex min-h-11 items-center gap-2 px-3 py-1.5">
                <Avatar name={memberLabel(m)} size="sm" />
                <span className="min-w-0 flex-1 truncate">
                  {memberLabel(m)}
                  {m.userId === userId ? <span className="text-slate-500"> (you)</span> : null}
                </span>
                {m.role === 'owner' ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">Owner</span> : null}
                {isOwner && m.userId !== userId ? (
                  <Button
                    variant="ghost"
                    className="text-red-700 hover:bg-red-50"
                    onClick={() => setConfirm({ kind: 'remove', userId: m.userId, label: memberLabel(m) })}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          {pending ? <p className="mt-1 text-xs text-slate-500">{pending} change{pending === 1 ? '' : 's'} waiting to upload.</p> : null}
        </div>

        {error ? <FieldError>{error}</FieldError> : null}

        <details className="rounded-lg border border-slate-200 px-3 py-2">
          <summary className="min-h-9 cursor-pointer py-1 font-medium text-slate-700">More options</summary>
          <div className="space-y-4 pt-2">
            <ChipGroup
              label="You are"
              options={travellers.map((t) => ({ value: t.id, label: t.displayName }))}
              value={me?.id ?? ''}
              onChange={(id) => act(() => travellersRepo.linkUser(id, userId))}
            />
            {invite ? (
              <div>
                <Button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await syncEngine!.switchOffInvites(trip.id)
                      setInvite(null)
                    })
                  }
                >
                  Turn off invite link
                </Button>
                <p className="mt-1 text-xs text-slate-500">People already on the trip stay. Nobody new can join with the old link.</p>
              </div>
            ) : null}
            {isOwner ? (
              <p className="text-xs text-slate-500">You own this trip. Deleting it from “Edit trip” deletes it for everyone.</p>
            ) : (
              <Button variant="danger" onClick={() => setConfirm({ kind: 'leave' })}>
                Leave trip
              </Button>
            )}
          </div>
        </details>
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
        The trip is removed from this phone and you lose access. Expenses stay with the others.{' '}
        {anonymous ? 'To get back in you need the invite link again.' : 'You can rejoin with the invite link.'}
        {pending ? (
          <div className="mt-2">
            <Notice tone="warning">
              {pending} change{pending === 1 ? ' has' : 's have'} not uploaded yet and will be lost.
            </Notice>
          </div>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        title="Remove from this trip?"
        confirmLabel="Remove"
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          act(async () => {
            if (confirm?.kind === 'remove') await syncEngine!.removeMember(trip.id, confirm.userId)
            setConfirm(null)
            setInvite(null)
            requestSync(0)
          })
        }
      >
        {confirm?.kind === 'remove' ? confirm.label : ''} loses access. Expenses they added stay. The invite link is also switched
        off so they can't rejoin with it; create a new one for anyone else you still want to invite.
      </ConfirmDialog>
    </Card>
  )
}
