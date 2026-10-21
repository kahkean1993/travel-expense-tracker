import { useEffect, useState, type FormEvent } from 'react'
import { Button, FieldError, Notice, TextInput } from '../../components/ui'
import { useBusy } from '../../components/useBusy'
import { sendSignInEmail, verifySignInCode } from '../../sync/cloud'

const RESEND_SECONDS = 60

/** Email sign-in: sends a link, and also accepts the 6-digit code from the same email. */
export function SignInForm({ intro }: { intro?: React.ReactNode }) {
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState(0)
  const [busy, run] = useBusy()

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  function send(e?: FormEvent) {
    e?.preventDefault()
    const address = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setError('Enter a valid email address.')
    setError(null)
    void run(async () => {
      try {
        await sendSignInEmail(address)
        setSentTo(address)
        setWait(RESEND_SECONDS)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not send the email.')
      }
    })
  }

  function verify(e: FormEvent) {
    e.preventDefault()
    if (!/^\d{6,10}$/.test(code.trim())) return setError('Enter the code from the email.')
    setError(null)
    void run(async () => {
      try {
        await verifySignInCode(sentTo!, code.trim())
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not sign in.')
      }
    })
  }

  if (sentTo) {
    return (
      <div className="space-y-3">
        <Notice tone="success">
          We emailed a sign-in link to <strong>{sentTo}</strong>. Open it on this device to sign in. It can take a minute to
          arrive; check spam too.
        </Notice>
        <form onSubmit={verify} className="space-y-2" noValidate>
          <label htmlFor="otp" className="text-sm font-medium text-slate-700">
            Or enter the code from the email
          </label>
          <div className="flex gap-2">
            <TextInput
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              aria-invalid={!!error}
            />
            <Button type="submit" variant="primary" disabled={busy}>
              Sign in
            </Button>
          </div>
        </form>
        {error ? <FieldError>{error}</FieldError> : null}
        <div className="flex flex-wrap gap-3 text-sm">
          <button type="button" className="text-accent-700 underline disabled:text-slate-400 disabled:no-underline" disabled={wait > 0 || busy} onClick={() => send()}>
            {wait > 0 ? `Resend in ${wait}s` : 'Resend email'}
          </button>
          <button
            type="button"
            className="text-slate-600 underline"
            onClick={() => {
              setSentTo(null)
              setCode('')
              setError(null)
            }}
          >
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={send} className="space-y-2" noValidate>
      {intro ? <div className="text-sm text-slate-600">{intro}</div> : null}
      <label htmlFor="signin-email" className="text-sm font-medium text-slate-700">
        Email
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          id="signin-email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={!!error}
        />
        <Button type="submit" variant="primary" disabled={busy} className="shrink-0">
          {busy ? 'Sending…' : 'Email me a sign-in link'}
        </Button>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
      <p className="text-xs text-slate-500">No password needed. Your email is only used to sign in and to show trip members who joined.</p>
    </form>
  )
}
