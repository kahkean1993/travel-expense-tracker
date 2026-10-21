import { useState, type FormEvent } from 'react'
import { TripGuard } from '../../components/TripGuard'
import type { TripData } from '../../db/hooks'
import { travellersRepo } from '../../db/repositories'
import { Button, Card, ConfirmDialog, FieldError, Notice, PageHeader, SectionTitle, TextInput } from '../../components/ui'
import { IconPlus } from '../../components/Icons'
import { Avatar } from '../../components/visuals'
import { useBusy } from '../../components/useBusy'
import type { Traveller } from '../../types/domain'
import { PaymentHistory, SettleUpCard } from './SettleUp'
import { useMyTravellerId } from './useMyTraveller'
import { SharingCard } from '../sharing/SharingCard'
import { useAuth } from '../../sync/cloud'

export function TravellersPage({ tripId }: { tripId: string }) {
  return <TripGuard tripId={tripId}>{(data) => <Travellers data={data} />}</TripGuard>
}

function Travellers({ data }: { data: TripData }) {
  const { trip, travellers } = data
  const auth = useAuth()
  const myUserId = auth.status === 'signedIn' ? auth.userId : null
  const myTravellerId = useMyTravellerId(travellers)
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

  return (
    <div className="space-y-4">
      <PageHeader title="Travellers & split" subtitle={trip.name} />

      {/* Not shared yet: offering to share is the main thing to do here. */}
      {shared ? null : <SharingCard data={data} />}

      {travellers.length > 1 ? <SettleUpCard data={data} myTravellerId={myTravellerId} /> : null}
      <PaymentHistory data={data} />

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
