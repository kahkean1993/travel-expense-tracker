import { useState } from 'react'
import { Button, FieldError, Money, Sheet, TextInput } from '../../components/ui'
import { IconPlus, IconX } from '../../components/Icons'
import { Avatar } from '../../components/visuals'
import { formatMoney, parseAmountToMinor } from '../../lib/money/money'
import type { ID, Traveller } from '../../types/domain'
import { parsePercentToBps, splitItemised } from '../splitting/itemised'

interface Row {
  key: number
  amount: string
  sharerIds: ID[]
}

export interface ItemisedApply {
  total: number
  perPerson: Map<ID, number>
}

/** A small calculator: add the items on a bill, tick who had each one, get what everyone owes. */
export function ItemisedSheet({
  open,
  travellers,
  currency,
  onClose,
  onApply,
}: {
  open: boolean
  travellers: Traveller[]
  currency: string
  onClose: () => void
  onApply: (result: ItemisedApply) => void
}) {
  return (
    <Sheet open={open} title="Split by item" onClose={onClose}>
      {open ? <Calculator travellers={travellers} currency={currency} onClose={onClose} onApply={onApply} /> : null}
    </Sheet>
  )
}

function Calculator({ travellers, currency, onClose, onApply }: { travellers: Traveller[]; currency: string; onClose: () => void; onApply: (r: ItemisedApply) => void }) {
  const everyone = travellers.map((t) => t.id)
  const [rows, setRows] = useState<Row[]>([{ key: 1, amount: '', sharerIds: everyone }])
  const [extra, setExtra] = useState('')
  const [error, setError] = useState<string | null>(null)
  const nextKey = rows.reduce((m, r) => Math.max(m, r.key), 0) + 1
  const names = new Map(travellers.map((t) => [t.id, t.displayName]))

  const items = rows.flatMap((r) => {
    const parsed = parseAmountToMinor(r.amount, currency)
    return parsed.ok ? [{ amount: parsed.value, sharerIds: everyone.filter((id) => r.sharerIds.includes(id)) }] : []
  })
  const bps = parsePercentToBps(extra)
  const result = splitItemised(items, bps ?? 0)

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const toggle = (row: Row, id: ID) =>
    update(row.key, { sharerIds: row.sharerIds.includes(id) ? row.sharerIds.filter((x) => x !== id) : [...row.sharerIds, id] })

  function apply() {
    if (bps === null) return setError('Service charge / tax must be a percentage like 10 or 6.5.')
    if (rows.some((r) => r.amount.trim() !== '' && !parseAmountToMinor(r.amount, currency).ok)) return setError('Check the item amounts.')
    if (rows.some((r) => r.amount.trim() !== '' && r.sharerIds.length === 0)) return setError('Every item needs at least one person.')
    if (result.total <= 0) return setError('Add at least one item with an amount.')
    onApply({ total: result.total, perPerson: result.perPerson })
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">Amounts are in {currency}. Each item is shared equally by the people ticked.</p>
      <ul className="space-y-3">
        {rows.map((r, i) => (
          <li key={r.key} className="rounded-xl bg-slate-50 p-3">
            <div className="flex items-center gap-2">
              <TextInput
                inputMode="decimal"
                placeholder={`Item ${i + 1} amount`}
                aria-label={`Item ${i + 1} amount`}
                value={r.amount}
                onChange={(e) => update(r.key, { amount: e.target.value })}
              />
              {rows.length > 1 ? (
                <button type="button" aria-label={`Remove item ${i + 1}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="press inline-flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100">
                  <IconX width={18} height={18} />
                </button>
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label={`Who had item ${i + 1}`}>
              {travellers.map((t) => {
                const on = r.sharerIds.includes(t.id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(r, t.id)}
                    className={`press inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm ${on ? 'border-accent-700 bg-accent-700 font-semibold text-white' : 'border-slate-300 bg-surface text-slate-700'}`}
                  >
                    {t.displayName}
                  </button>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
      <Button onClick={() => setRows((rs) => [...rs, { key: nextKey, amount: '', sharerIds: everyone }])}>
        <IconPlus width={18} height={18} /> Add item
      </Button>

      <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
        Service charge / tax (%), optional
        <span className="max-w-40"><TextInput inputMode="decimal" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. 10" /></span>
      </label>

      <div className="rounded-xl border border-slate-200 p-3" aria-live="polite">
        <p className="mb-2 text-sm font-semibold text-slate-900">Each person pays</p>
        {result.perPerson.size === 0 ? (
          <p className="text-sm text-slate-500">Add items to see the split.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {[...result.perPerson].map(([id, amount]) => (
              <li key={id} className="flex items-center gap-2">
                <Avatar name={names.get(id) ?? '?'} size="sm" />
                <span className="min-w-0 flex-1 truncate">{names.get(id)}</span>
                <Money minor={amount} currency={currency} className="font-semibold" />
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-sm text-slate-700">
          <span>Bill total{result.extra > 0 ? ` (incl. ${formatMoney(result.extra, currency)} extra)` : ''}</span>
          <Money minor={result.total} currency={currency} className="font-semibold text-slate-900" />
        </p>
      </div>
      {error ? <FieldError>{error}</FieldError> : null}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={apply}>Use this split</Button>
      </div>
    </div>
  )
}
