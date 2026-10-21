import { useState, type FormEvent } from 'react'
import { TripGuard } from '../../components/TripGuard'
import type { TripData } from '../../db/hooks'
import { travellersRepo } from '../../db/repositories'
import { Button, Card, ConfirmDialog, FieldError, Money, Notice, PageHeader, SectionTitle, TextInput } from '../../components/ui'
import { IconArrowRight, IconPlus } from '../../components/Icons'
import { useBusy } from '../../components/useBusy'
import type { Traveller } from '../../types/domain'
import { settlementFor } from './settlement'

export function TravellersPage({ tripId }: { tripId: string }) {
  return <TripGuard tripId={tripId}>{(data) => <Travellers data={data} />}</TripGuard>
}

function Travellers({ data }: { data: TripData }) {
  const { trip, travellers } = data
  const cur = trip.baseCurrency
  const { names, balances, transfers } = settlementFor(data)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, run] = useBusy()

  function add(e: FormEvent) {
    e.preventDefault()
    const n = newName.trim()
    if (!n) return setError('Enter a name.')
    if (travellers.some((t) => t.displayName.toLowerCase() === n.toLowerCase())) return setError(`"${n}" is already on this trip.`)
    setError(null)
    void run(async () => {
      await travellersRepo.add(trip.id, n)
      setNewName('')
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Travellers & split" subtitle={trip.name} />

      <Card>
        <SectionTitle>Travellers</SectionTitle>
        <ul className="divide-y divide-slate-100">
          {travellers.map((t) => (
            <TravellerRow key={t.id} traveller={t} others={travellers.filter((o) => o.id !== t.id)} canRemove={travellers.length > 1} />
          ))}
        </ul>
        <form onSubmit={add} className="mt-3 flex gap-2" noValidate>
          <TextInput
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Add a person"
            aria-label="New traveller name"
            maxLength={40}
          />
          <Button type="submit" disabled={busy}>
            <IconPlus width={18} height={18} /> Add
          </Button>
        </form>
        {error ? <div className="mt-2"><FieldError>{error}</FieldError></div> : null}
      </Card>

      <Card>
        <SectionTitle>Balances ({cur})</SectionTitle>
        <p className="mb-3 text-sm text-slate-600">
          Balance = amount paid − share of expenses. A positive balance means the person should receive money; a negative
          balance means they owe.
        </p>
        <ul className="divide-y divide-slate-100">
          {balances.map((b) => (
            <li key={b.travellerId} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{names.get(b.travellerId)}</p>
                <p className="text-xs text-slate-600">
                  Paid <Money minor={b.paid} currency={cur} /> · Share <Money minor={b.share} currency={cur} />
                </p>
              </div>
              <div className="shrink-0 text-right">
                <Money minor={Math.abs(b.net)} currency={cur} className="font-semibold text-slate-900" />
                <p className="text-xs text-slate-600">{b.net > 0 ? 'gets back' : b.net < 0 ? 'owes' : 'settled'}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <SectionTitle>Suggested settlement</SectionTitle>
        {transfers.length === 0 ? (
          <p className="text-sm text-slate-600">Everyone is settled up. Nothing to transfer.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {transfers.map((t, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
                  <strong className="font-medium">{names.get(t.fromTravellerId)}</strong>
                  <span className="inline-flex items-center gap-1 text-slate-600">
                    pays <IconArrowRight width={16} height={16} />
                  </span>
                  <strong className="font-medium">{names.get(t.toTravellerId)}</strong>
                  <Money minor={t.amount} currency={cur} className="ml-auto font-semibold" />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">
              These are calculated suggestions using the fewest practical transfers. They are not recorded as payments.
            </p>
          </>
        )}
      </Card>
    </div>
  )
}

function TravellerRow({ traveller, others, canRemove }: { traveller: Traveller; others: Traveller[]; canRemove: boolean }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(traveller.displayName)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [blocked, setBlocked] = useState<number | null>(null)
  const [busy, run] = useBusy()

  function save(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (!n) return setError('Name cannot be empty.')
    if (others.some((o) => o.displayName.toLowerCase() === n.toLowerCase())) return setError('Another traveller has this name.')
    void run(async () => {
      await travellersRepo.rename(traveller.id, n)
      setEditing(false)
      setError(null)
    })
  }

  async function askRemove() {
    const used = await travellersRepo.usageCount(traveller.id)
    if (used > 0) setBlocked(used)
    else setConfirm(true)
  }

  return (
    <li className="py-2">
      {editing ? (
        <form onSubmit={save} className="flex flex-wrap gap-2" noValidate>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} aria-label="Traveller name" autoFocus maxLength={40} />
          <Button type="submit" variant="primary" disabled={busy}>Save</Button>
          <Button onClick={() => { setEditing(false); setName(traveller.displayName); setError(null) }}>Cancel</Button>
          {error ? <div className="w-full"><FieldError>{error}</FieldError></div> : null}
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <span className="flex-1 truncate">{traveller.displayName}</span>
          <Button variant="ghost" onClick={() => setEditing(true)}>Rename</Button>
          {canRemove ? <Button variant="ghost" className="text-red-700 hover:bg-red-50" onClick={() => void askRemove()}>Remove</Button> : null}
        </div>
      )}
      {blocked !== null ? (
        <div className="mt-2">
          <Notice tone="warning" action={<button type="button" className="underline" onClick={() => setBlocked(null)}>OK</button>}>
            {traveller.displayName} is part of {blocked} saved expense{blocked === 1 ? '' : 's'}, so they can't be removed
            without changing past splits. Edit or delete those expenses first, or rename instead.
          </Notice>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm}
        title={`Remove ${traveller.displayName}?`}
        confirmLabel="Remove"
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void run(async () => { await travellersRepo.remove(traveller.id); setConfirm(false) })}
      >
        They are not part of any expense, so no balances change.
      </ConfirmDialog>
    </li>
  )
}
