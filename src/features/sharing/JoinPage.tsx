import { useEffect, useState } from 'react'
import { navigate, paths } from '../../app/router'
import { Button, Card, ChipGroup, EmptyState, Field, FieldError, LinkButton, Loading, PageHeader, TextInput } from '../../components/ui'
import { useBusy } from '../../components/useBusy'
import {
  cloudConfigured,
  rememberPendingInvite,
  requestSync,
  signInWithoutEmail,
  syncEngine,
  useAuth,
} from '../../sync/cloud'
import type { InvitePreview } from '../../sync/remote'
import { describeError } from './errors'
import { SignInForm } from './SignInForm'
import { Avatar } from '../../components/visuals'
import { tripCover } from '../../components/look'

const NEW_NAME = '__new__'

/** Opened from an invite link: #/join/<token>. Tap the link, pick your name, join. */
export function JoinPage({ token }: { token: string }) {
  const auth = useAuth()
  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Coming back from an email sign-in: this is the page we were heading to.
  useEffect(() => {
    if (auth.status === 'signedIn') rememberPendingInvite(null)
  }, [auth.status])

  useEffect(() => {
    if (!cloudConfigured || !syncEngine) return
    let cancelled = false
    syncEngine.remote.previewInvite(token).then(
      (p) => {
        if (!cancelled) setPreview(p)
      },
      (e: unknown) => {
        if (cancelled) return
        setLoadError(describeError(e))
        setPreview(null)
      },
    )
    return () => {
      cancelled = true
    }
  }, [token])

  if (!cloudConfigured) {
    return (
      <EmptyState title="Shared trips are not available" action={<LinkButton to={paths.trips()}>Go to trips</LinkButton>}>
        This copy of the app isn't connected to a sharing server.
      </EmptyState>
    )
  }
  if (preview === undefined) return <Loading label="Opening invite…" />
  if (!preview) {
    return (
      <EmptyState title="This invite can't be used" action={<LinkButton to={paths.trips()}>Go to trips</LinkButton>}>
        {loadError ?? 'The link has expired or was switched off. Ask whoever shared the trip for a new link.'}
      </EmptyState>
    )
  }
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Join a shared trip" />
      <JoinCard key={token} token={token} preview={preview} signedIn={auth.status === 'signedIn'} authLoading={auth.status === 'loading'} />
    </div>
  )
}

function JoinCard({
  token,
  preview,
  signedIn,
  authLoading,
}: {
  token: string
  preview: InvitePreview
  signedIn: boolean
  authLoading: boolean
}) {
  const choices = preview.travellers.filter((t) => !t.isOwner)
  const [choice, setChoice] = useState(choices.length === 0 ? NEW_NAME : '')
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [emailMode, setEmailMode] = useState(false)
  const [busy, run] = useBusy()

  const needsName = choice === NEW_NAME
  const canJoin = preview.alreadyMember || (needsName ? newName.trim().length > 0 : choice !== '')

  function join() {
    setError(null)
    void run(async () => {
      try {
        // Friends need no email: this phone gets its own account behind the scenes.
        if (!signedIn) await signInWithoutEmail()
        const pick = preview.alreadyMember ? {} : needsName ? { newName: newName.trim() } : { travellerId: choice }
        const tripId = await syncEngine!.joinWithInvite(token, pick)
        requestSync(0)
        navigate(paths.dashboard(tripId), { replace: true })
      } catch (e) {
        setError(describeError(e))
      }
    })
  }

  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <div className={`relative overflow-hidden bg-linear-to-br ${tripCover(preview.tripId)} p-5 text-white`}>
        <span aria-hidden="true" className="pointer-events-none absolute -top-10 -right-8 size-36 rounded-full bg-white/10" />
        <p className="relative text-sm text-white/85">You're invited to</p>
        <p className="relative mt-1 text-2xl font-semibold break-words">{preview.tripName}</p>
        <p className="relative mt-1 text-sm text-white/85">
          {preview.memberCount} {preview.memberCount === 1 ? 'person is' : 'people are'} on this trip. You'll add expenses together.
        </p>
      </div>
      <div className="space-y-4 p-5">

      {preview.alreadyMember ? (
        <p className="text-sm text-slate-700">You're already on this trip.</p>
      ) : (
        <>
          {choices.length > 0 ? (
            <ChipGroup
              label="Who are you?"
              options={[
                ...choices.map((t) => ({ value: t.id, label: t.name, leading: <Avatar name={t.name} size="sm" /> })),
                { value: NEW_NAME, label: "I'm not on the list" },
              ]}
              value={choice}
              onChange={setChoice}
            />
          ) : null}
          {needsName ? (
            <Field label="Your name" htmlFor="join-name">
              <TextInput
                id="join-name"
                value={newName}
                maxLength={40}
                autoFocus={choices.length > 0}
                placeholder="e.g. Alex"
                onChange={(e) => setNewName(e.target.value)}
              />
            </Field>
          ) : null}
          {choices.some((t) => t.claimed) ? (
            <p className="text-xs text-slate-500">Joined before on another phone? Pick the same name to continue on this one.</p>
          ) : null}
        </>
      )}

      <Button variant="primary" className="w-full" disabled={busy || authLoading || !canJoin} onClick={join}>
        {busy ? 'Joining…' : preview.alreadyMember ? 'Open trip' : 'Join trip'}
      </Button>
      {error ? <FieldError>{error}</FieldError> : null}

      {!signedIn && !authLoading ? (
        <div className="border-t border-slate-200 pt-3 text-sm">
          {emailMode ? (
            <SignInForm
              onEmailSent={() => rememberPendingInvite(token)}
              intro="Prefer to use your email? Sign in and you'll come back here. This lets you use the same account on other phones."
            />
          ) : (
            <button type="button" className="text-slate-600 underline" onClick={() => setEmailMode(true)}>
              I'd rather sign in with my email
            </button>
          )}
        </div>
      ) : null}
      </div>
    </Card>
  )
}
