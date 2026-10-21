import { useEffect, useState } from 'react'
import { navigate, paths } from '../../app/router'
import { Button, Card, EmptyState, FieldError, LinkButton, Loading, PageHeader } from '../../components/ui'
import { useBusy } from '../../components/useBusy'
import { cloudConfigured, rememberPendingInvite, syncEngine, useAuth } from '../../sync/cloud'
import type { InvitePreview } from '../../sync/remote'
import { SignInForm } from './SignInForm'
import { describeError } from './errors'

/** Opened from an invite link: #/join/<token>. */
export function JoinPage({ token }: { token: string }) {
  const auth = useAuth()

  useEffect(() => {
    // The sign-in email returns to the home page; remember where we were.
    if (auth.status === 'signedOut') rememberPendingInvite(token)
  }, [auth.status, token])

  if (!cloudConfigured) {
    return (
      <EmptyState title="Shared trips are not available" action={<LinkButton to={paths.trips()}>Go to trips</LinkButton>}>
        This copy of the app isn't connected to a sharing server.
      </EmptyState>
    )
  }
  if (auth.status === 'loading') return <Loading />
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Join a shared trip" />
      {auth.status === 'signedIn' ? (
        <JoinWithAccount key={token} token={token} />
      ) : (
        <Card>
          <SignInForm intro="You've been invited to a shared trip. Sign in with your email to join; you'll come back here afterwards." />
          {auth.status === 'signedOut' && auth.error ? (
            <div className="mt-3">
              <FieldError>{auth.error}</FieldError>
            </div>
          ) : null}
        </Card>
      )}
    </div>
  )
}

function JoinWithAccount({ token }: { token: string }) {
  const [preview, setPreview] = useState<InvitePreview | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [busy, run] = useBusy()

  useEffect(() => {
    // We're here now; stop redirecting to this invite after sign-in.
    rememberPendingInvite(null)
    let cancelled = false
    syncEngine!.remote.previewInvite(token).then(
      (p) => {
        if (!cancelled) setPreview(p)
      },
      (e: unknown) => {
        if (!cancelled) {
          setPreview(null)
          setError(describeError(e))
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [token])

  function join() {
    void run(async () => {
      try {
        setError(null)
        const tripId = await syncEngine!.joinWithInvite(token)
        navigate(paths.travellers(tripId), { replace: true })
      } catch (e) {
        setError(describeError(e))
      }
    })
  }

  if (preview === undefined) return <Loading label="Checking invite…" />
  if (!preview) {
    return (
      <EmptyState
        title="This invite can't be used"
        action={
          <LinkButton to={paths.trips()}>Go to trips</LinkButton>
        }
      >
        {error ?? 'The link is invalid, has expired, or was revoked. Ask the trip owner for a new invite link.'}
      </EmptyState>
    )
  }
  return (
    <Card className="space-y-3">
      <p className="text-sm text-slate-600">You're invited to</p>
      <p className="text-xl font-semibold">{preview.tripName}</p>
      <p className="text-sm text-slate-600">
        {preview.memberCount} {preview.memberCount === 1 ? 'person is' : 'people are'} on this trip. Members can see and edit
        all of its expenses.
      </p>
      <Button variant="primary" disabled={busy} onClick={join}>
        {busy ? 'Joining…' : preview.alreadyMember ? 'Open trip' : 'Join trip'}
      </Button>
      {error ? <FieldError>{error}</FieldError> : null}
    </Card>
  )
}
