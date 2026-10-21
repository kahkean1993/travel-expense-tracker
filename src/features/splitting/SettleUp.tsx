import { useState } from 'react'
import { href, paths } from '../../app/router'
import type { TripData } from '../../db/hooks'
import { settlementsRepo, tripsRepo } from '../../db/repositories'
import { Button, Card, ConfirmDialog, FieldError, Money, Notice, SectionTitle, Sheet, TextInput } from '../../components/ui'
import { IconArrowRight, IconCheck, IconChevronRight } from '../../components/Icons'
import { Avatar } from '../../components/visuals'
import { useBusy } from '../../components/useBusy'
import { formatDate } from '../../lib/dates'
import { localDateString } from '../../lib/export/csv'
import { convertMinorUnits, currencyFractionDigits, formatMoney, minorToInputString, parseAmountToMinor, parseExchangeRate } from '../../lib/money/money'
import { fetchLiveRate } from '../../lib/rates'
import { CurrencySelect } from '../../components/CurrencySelect'
import type { Settlement } from '../../types/domain'
import type { Transfer } from './allocate'
import { settlementFor } from './settlement'
import { summaryText } from './summaryText'
import { summaryImage } from './summaryImage'

/** Who pays whom, with a "Mark paid" button on each transfer and a way into each person's statement. */
export function SettleUpCard({ data, myTravellerId }: { data: TripData; myTravellerId?: string | undefined }) {
  const { trip, expenses, settlements } = data
  const cur = trip.baseCurrency
  const { names, balances, transfers } = settlementFor(data)
  const [paying, setPaying] = useState<Transfer | null>(null)
  const [shared, setShared] = useState<string | null>(null)
  const settled = transfers.length === 0
  const hasActivity = expenses.length > 0 || settlements.length > 0
  const biggest = Math.max(1, ...balances.flatMap((b) => [b.paid, b.share]))

  async function share() {
    const text = summaryText(data)
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `${trip.name} – settle up`, text })
        return
      }
      await navigator.clipboard.writeText(text)
      setShared('Summary copied. Paste it into your group chat.')
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setShared('Could not share. Select and copy the amounts instead.')
    }
  }

  async function saveImage() {
    const blob = await summaryImage(data)
    if (!blob) return setShared('Could not create the image.')
    const file = new File([blob], `${trip.name.replace(/[^\w-]+/g, '-')}-settle-up.png`, { type: 'image/png' })
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `${trip.name} – settle up` })
        return
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
    const url = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    setShared('Image saved.')
  }

  if (!hasActivity) return null

  return (
    <Card>
      <SectionTitle
        action={
          <span className="-mr-2 flex">
            <button type="button" onClick={() => void share()} aria-label="Share summary as text" className="press min-h-9 rounded-lg px-2.5 text-sm font-medium text-accent-700 hover:bg-accent-50">
              Share
            </button>
            <button type="button" onClick={() => void saveImage()} aria-label="Save summary as an image" className="press min-h-9 rounded-lg px-2.5 text-sm font-medium text-accent-700 hover:bg-accent-50">
              Image
            </button>
          </span>
        }
      >
        Settle up
      </SectionTitle>
      <div role="status" className="sr-only">{shared}</div>
      {shared ? <p className="mb-3 text-xs text-slate-600">{shared}</p> : null}

      {settled ? (
        <div className="animate-pop rounded-xl bg-accent-50 px-3.5 py-3 text-sm text-accent-800">
          <p className="flex items-center gap-2 font-semibold">
            <IconCheck width={18} height={18} /> All settled
          </p>
          <p className="mt-0.5 text-accent-800">Everyone has paid what they owe. Nothing left to transfer.</p>
          {trip.status === 'active' ? <CompleteTrip tripId={trip.id} /> : null}
        </div>
      ) : (
        <ul className="space-y-2">
          {transfers.map((t) => (
            <li key={`${t.fromTravellerId}:${t.toTravellerId}`} className="animate-enter flex items-center gap-2 rounded-xl bg-slate-50 py-2.5 pl-3 pr-2">
              <Avatar name={names.get(t.fromTravellerId) ?? '?'} />
              <span className="min-w-0 flex-1 text-sm leading-tight">
                <span className="font-semibold text-slate-900">{names.get(t.fromTravellerId)}</span>
                <span className="mx-1.5 inline-flex translate-y-0.5 text-slate-500">
                  <IconArrowRight width={15} height={15} />
                  <span className="sr-only"> pays </span>
                </span>
                <span className="font-semibold text-slate-900">{names.get(t.toTravellerId)}</span>
                <Money minor={t.amount} currency={cur} className="block text-base font-semibold text-slate-900" />
              </span>
              <Button
                className="shrink-0"
                aria-label={`Mark paid: ${names.get(t.fromTravellerId)} pays ${names.get(t.toTravellerId)}`}
                onClick={() => setPaying(t)}
              >
                Mark paid
              </Button>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-5 mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Each person</h3>
      <ul className="divide-y divide-slate-100">
        {balances.map((b) => {
          const you = b.travellerId === myTravellerId
          return (
            <li key={b.travellerId}>
              <a
                href={href(paths.person(trip.id, b.travellerId))}
                className="press -mx-2 flex items-center gap-3 rounded-xl px-2 py-3 hover:bg-slate-50"
                aria-label={`${names.get(b.travellerId)}${you ? ' (you)' : ''}: ${b.net > 0 ? 'gets back' : b.net < 0 ? 'owes' : 'settled'} ${b.net === 0 ? '' : formatMoney(Math.abs(b.net), cur)}. See why`}
              >
                <Avatar name={names.get(b.travellerId) ?? '?'} />
                <div className="min-w-0 flex-1" aria-hidden="true">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {names.get(b.travellerId)}
                    {you ? <span className="text-slate-500"> (you)</span> : null}
                  </p>
                  <Bars paid={b.paid} share={b.share} biggest={biggest} />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1" aria-hidden="true">
                  <Money minor={Math.abs(b.net)} currency={cur} className="text-sm font-semibold text-slate-900" />
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      b.net > 0 ? 'bg-emerald-100 text-emerald-800' : b.net < 0 ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {b.net > 0 ? 'gets back' : b.net < 0 ? 'owes' : 'settled'}
                  </span>
                </div>
                <IconChevronRight width={16} height={16} className="shrink-0 text-slate-400" aria-hidden="true" />
              </a>
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-xs text-slate-500">Bars compare what each person paid with their share of the costs. Tap a person to see why.</p>

      <MarkPaidSheet data={data} transfer={paying} onClose={() => setPaying(null)} />
    </Card>
  )
}

/** Paid (solid) against share (outline) on one scale. */
function Bars({ paid, share, biggest }: { paid: number; share: number; biggest: number }) {
  return (
    <div className="mt-1.5 space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full origin-left animate-grow-x rounded-full bg-accent-600" style={{ width: `${(paid / biggest) * 100}%` }} />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full origin-left animate-grow-x rounded-full bg-amber-400" style={{ width: `${(share / biggest) * 100}%` }} />
      </div>
      <p className="sr-only">Paid {paid}, share {share}</p>
    </div>
  )
}

function CompleteTrip({ tripId }: { tripId: string }) {
  const [busy, run] = useBusy()
  return (
    <Button className="mt-3" variant="primary" disabled={busy} onClick={() => void run(() => tripsRepo.setStatus(tripId, 'completed'))}>
      Mark trip as completed
    </Button>
  )
}

function MarkPaidSheet({ data, transfer, onClose }: { data: TripData; transfer: Transfer | null; onClose: () => void }) {
  return (
    <Sheet open={transfer !== null} title="Mark as paid" onClose={onClose}>
      {transfer ? <MarkPaidForm key={`${transfer.fromTravellerId}:${transfer.toTravellerId}:${transfer.amount}`} data={data} transfer={transfer} onDone={onClose} /> : null}
    </Sheet>
  )
}

function MarkPaidForm({ data, transfer, onDone }: { data: TripData; transfer: Transfer; onDone: () => void }) {
  const cur = data.trip.baseCurrency
  const { names } = settlementFor(data)
  const [currency, setCurrency] = useState(cur)
  const [rate, setRate] = useState('1')
  const [amount, setAmount] = useState(minorToInputString(transfer.amount, cur))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [rateNote, setRateNote] = useState<string | null>(null)
  const [busy, run] = useBusy()
  const foreign = currency !== cur

  /** What the amount typed means in the trip currency (null while it can't be worked out). */
  function worked(): { base: number; original: number } | { error: string } {
    const typed = parseAmountToMinor(amount, currency)
    if (!typed.ok) return { error: typed.error }
    if (!foreign) return { base: typed.value, original: typed.value }
    const parsedRate = parseExchangeRate(rate)
    if (!parsedRate.ok) return { error: parsedRate.error }
    try {
      const converted = convertMinorUnits(typed.value, currency, cur, parsedRate.value)
      // One unit of rounding in the foreign currency is not worth leaving a sliver owed.
      const tolerance = Math.max(1, convertMinorUnits(1, currency, cur, parsedRate.value) + 1)
      const base = Math.abs(converted - transfer.amount) <= tolerance ? transfer.amount : converted
      return { base, original: typed.value }
    } catch {
      return { error: 'That amount is too large to convert.' }
    }
  }

  const result = worked()
  const base = 'base' in result ? result.base : null

  function changeCurrency(code: string) {
    setCurrency(code)
    setRateNote(null)
    setError(null)
    if (code === cur) {
      setRate('1')
      setAmount(minorToInputString(transfer.amount, cur))
    } else {
      setRate('')
      setAmount('')
    }
  }

  async function lookUp() {
    const found = await fetchLiveRate(currency, cur)
    if (!found.ok) return setRateNote(found.error)
    setRate(found.value.rate)
    setRateNote(`Rate from ${found.value.date || 'today'} (market rate).`)
    // Suggest paying the full amount in this currency; only a suggestion, the saved conversion is exact.
    const owedMajor = transfer.amount / 10 ** currencyFractionDigits(cur)
    const suggestion = owedMajor / Number(found.value.rate)
    setAmount(suggestion.toFixed(currencyFractionDigits(currency)))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if ('error' in result) return setError(result.error)
    if (result.base > transfer.amount) return setError(`That is more than the ${formatMoney(transfer.amount, cur)} owed.`)
    if (result.base <= 0) return setError('Amount must be greater than zero.')
    const parsedRate = parseExchangeRate(rate)
    const foreignRate = parsedRate.ok ? parsedRate.value : '1'
    setError(null)
    void run(async () => {
      try {
        await settlementsRepo.add(data.trip.id, {
          fromTravellerId: transfer.fromTravellerId,
          toTravellerId: transfer.toTravellerId,
          amountMinorUnits: result.base,
          paidOn: localDateString(),
          note,
          ...(foreign ? { originalAmountMinorUnits: result.original, originalCurrency: currency, exchangeRate: foreignRate } : {}),
        })
        onDone()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not save the payment.')
      }
    })
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-sm text-slate-600">
        <span className="font-semibold text-slate-900">{names.get(transfer.fromTravellerId)}</span> paid{' '}
        <span className="font-semibold text-slate-900">{names.get(transfer.toTravellerId)}</span>. Owed: {formatMoney(transfer.amount, cur)}. Change the amount if it was only part of it.
      </p>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
          Amount paid ({currency})
          <TextInput inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={error ? true : undefined} />
        </label>
        <div className="w-28">
          <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="paid-currency">Paid in</label>
          <CurrencySelect id="paid-currency" value={currency} onChange={changeCurrency} extra={[...new Set([cur, ...data.expenses.map((e) => e.originalCurrency)])]} />
        </div>
      </div>
      {foreign ? (
        <div className="rounded-xl bg-slate-50 p-3">
          <label htmlFor="paid-rate" className="text-sm font-medium text-slate-700">Exchange rate (1 {currency} = {cur})</label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <TextInput id="paid-rate" className="w-36" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 0.0312" />
            <Button className="min-h-9 px-3" onClick={() => void lookUp()}>Use today's rate</Button>
          </div>
          {rateNote ? <p role="status" className="mt-1.5 text-xs text-slate-600">{rateNote}</p> : null}
          {base !== null ? <p className="mt-2 text-sm text-slate-700">Counts as <span className="font-semibold">{formatMoney(base, cur)}</span> towards what is owed.</p> : null}
        </div>
      ) : null}
      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
        Note (optional)
        <TextInput value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. bank transfer" />
      </label>
      {error ? <FieldError>{error}</FieldError> : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onDone} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>Save payment</Button>
      </div>
    </form>
  )
}

/** Payments already recorded for the trip, each with an undo. */
export function PaymentHistory({ data }: { data: TripData }) {
  const { trip, settlements } = data
  const { names } = settlementFor(data)
  const [undo, setUndo] = useState<Settlement | null>(null)
  const [busy, run] = useBusy()
  if (settlements.length === 0) return null
  const sorted = [...settlements].sort((a, b) => b.paidOn.localeCompare(a.paidOn) || b.createdAt.localeCompare(a.createdAt))
  return (
    <Card>
      <SectionTitle>Payments</SectionTitle>
      <ul className="divide-y divide-slate-100">
        {sorted.map((p) => (
          <li key={p.id} className="flex items-center gap-3 py-3">
            <span className="min-w-0 flex-1 text-sm">
              <span className="font-medium text-slate-900">{names.get(p.fromTravellerId)}</span> paid{' '}
              <span className="font-medium text-slate-900">{names.get(p.toTravellerId)}</span>
              <span className="block text-xs text-slate-500">
                {formatDate(p.paidOn)}
                {p.originalCurrency && p.originalAmountMinorUnits ? ` · paid ${formatMoney(p.originalAmountMinorUnits, p.originalCurrency)} at ${p.exchangeRate}` : ''}
                {p.note ? ` · ${p.note}` : ''}
              </span>
            </span>
            <Money minor={p.amountMinorUnits} currency={trip.baseCurrency} className="text-sm font-semibold text-slate-900" />
            <Button variant="ghost" className="text-slate-600" aria-label={`Undo payment of ${formatMoney(p.amountMinorUnits, trip.baseCurrency)}`} onClick={() => setUndo(p)}>
              Undo
            </Button>
          </li>
        ))}
      </ul>
      <UndoDialog
        payment={undo}
        busy={busy}
        data={data}
        onCancel={() => setUndo(null)}
        onConfirm={() => undo && void run(async () => { await settlementsRepo.remove(undo.id); setUndo(null) })}
      />
    </Card>
  )
}

function UndoDialog({ payment, busy, data, onCancel, onConfirm }: { payment: Settlement | null; busy: boolean; data: TripData; onCancel: () => void; onConfirm: () => void }) {
  const { names } = settlementFor(data)
  return (
    <ConfirmDialog open={payment !== null} title="Undo this payment?" confirmLabel="Undo payment" busy={busy} onCancel={onCancel} onConfirm={onConfirm}>
      {payment ? (
        <>
          {names.get(payment.fromTravellerId)} → {names.get(payment.toTravellerId)}, {formatMoney(payment.amountMinorUnits, data.trip.baseCurrency)} goes back to owed.
        </>
      ) : null}
    </ConfirmDialog>
  )
}

/** A nudge on Home once the trip has ended but money is still owed. */
export function SettleReminder({ data, today }: { data: TripData; today: string }) {
  const { trip } = data
  if (trip.status !== 'active' || today <= trip.endDate) return null
  const { transfers } = settlementFor(data)
  if (transfers.length === 0) return null
  const days = Math.round((Date.parse(today) - Date.parse(trip.endDate)) / 86_400_000)
  return (
    <Notice tone="warning">
      The trip ended {days === 1 ? 'yesterday' : `${days} days ago`}, and {transfers.length} payment{transfers.length === 1 ? ' is' : 's are'} still owed. Settle up below.
    </Notice>
  )
}
