import { useState, type FormEvent } from 'react'
import { TripGuard } from '../../components/TripGuard'
import type { TripData } from '../../db/hooks'
import { travellersRepo } from '../../db/repositories'
import { Button, Card, ConfirmDialog, FieldError, Money, Notice, PageHeader, SectionTitle, TextInput } from '../../components/ui'
import { IconArrowRight, IconCheck, IconPlus } from '../../components/Icons'
import { Avatar } from '../../components/visuals'
import { useBusy } from '../../components/useBusy'
import type { Traveller } from '../../types/domain'
import { settlementFor } from './settlement'
import { SharingCard } from '../sharing/SharingCard'
import { useAuth } from '../../sync/cloud'

export function TravellersPage({ tripId }: { tripId: string }) {
  return <TripGuard tripId={tripId}>{(data) => <Travellers data={data} />}</TripGuard>
}

function Travellers({ data }: { data: TripData }) {
  const { trip, travellers } = data
  const cur = trip.baseCurrency
  const { names, balances, transfers } = settlementFor(data)
  const auth = useAuth()
  const myUserId = auth.status === 'signedIn' ? auth.userId : null
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

  const shared = trip.syncMode === 'cloud'
  const settled = transfers.length === 0

  return (
    <div className="space-y-4">
      <PageHeader title="Travellers & split" subtitle={trip.name} />

      {/* Not shared yet: offering to share is the main thing to do here. */}
      {shared ? null : <SharingCard data={data} />}

      <Card>
        <SectionTitle>Who pays whom</SectionTitle>
        {settled ? (
          <p className="flex items-center gap-2 rounded-xl bg-accent-50 px-3.5 py-3 text-sm font-medium text-accent-800">
            <IconCheck width={18} height={18} /> Everyone is settled up. Nothing to transfer.
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {transfers.map((t, i) => (
                <li key={i} className="animate-enter flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-3" style={{ animationDelay: `${i * 50}ms` }}>
                  <Avatar name={names.get(t.fromTravellerId) ?? '?'} />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="font-semibold text-slate-900">{names.get(t.fromTravellerId)}</span>
                    <span className="mx-1.5 inline-flex translate-y-0.5 text-slate-500">
                      <IconArrowRight width={15} height={15} />
                      <span className="sr-only"> pays </span>
                    </span>
                    <span className="font-semibold text-slate-900">{names.get(t.toTravellerId)}</span>
                  </span>
                  <Money minor={t.amount} currency={cur} className="text-base font-semibold text-slate-900" />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-500">The fewest transfers that settle everyone. Suggestions only; nothing is recorded as paid.</p>
          </>
        )}
      </Card>

      <Card>
        <SectionTitle>Balances</SectionTitle>
        <ul className="divide-y divide-slate-100">
          {balances.map((b) => (
            <li key={b.travellerId} className="flex items-center gap-3 py-3">
              <Avatar name={names.get(b.travellerId) ?? '?'} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{names.get(b.travellerId)}</p>
                <p className="text-xs text-slate-500">
                  Paid <Money minor={b.paid} currency={cur} hideSymbol /> · Share <Money minor={b.share} currency={cur} hideSymbol />
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Money minor={Math.abs(b.net)} currency={cur} className="font-semibold text-slate-900" />
                <p
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    b.net > 0 ? 'bg-emerald-100 text-emerald-800' : b.net < 0 ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {b.net > 0 ? 'gets back' : b.net < 0 ? 'owes' : 'settled'}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Balance = what someone paid minus their share of the costs.</p>
      </Card>

      <Card>
        <SectionTitle>Travellers</SectionTitle>
        <ul className="divide-y divide-slate-100">
          {travellers.map((t) => (
            <TravellerRow key={t.id} traveller={t} isYou={!!myUserId && t.userId === myUserId} others={travellers.filter((o) => o.id !== t.id)} canRemove={travellers.length > 1} />
          ))}
        </ul>
        <form onSubmit={add} className="mt-3 flex gap-2" noValidate>
          <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Add a person" aria-label="New traveller name" maxLength={40} />
          <Button type="submit" disabled={busy}>
            <IconPlus width={18} height={18} /> Add
          </Button>
        </form>
        {error ? <div className="mt-2"><FieldError>{error}</FieldError></div> : null}
      </Card>

      {shared ? <SharingCard data={data} /> : null}
    </div>
  )
}

function TravellerRow({
  traveller,
  others,
  canRemove,
  isYou,
}: {
  traveller: Traveller
  others: Traveller[]
  canRemove: boolean
  isYou: boolean
}) {
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
        <div className="flex items-center gap-3">
          <Avatar name={traveller.displayName} />
          <span className="flex-1 truncate">
            {traveller.displayName}
            {isYou ? <span className="text-slate-500"> (you)</span> : null}
          </span>
          <Button variant="ghost" className="text-slate-600" onClick={() => setEditing(true)}>Rename</Button>
          {canRemove ? <Button variant="ghost" className="text-slate-600 hover:bg-red-50 hover:text-red-700" onClick={() => void askRemove()}>Remove</Button> : null}
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
