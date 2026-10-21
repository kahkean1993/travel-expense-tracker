import { useState } from 'react'
import { navigate, paths } from '../../app/router'
import { TripGuard } from '../../components/TripGuard'
import { expensesRepo } from '../../db/repositories'
import { Card, ConfirmDialog, EmptyState, LinkButton, Button, Money, PageHeader } from '../../components/ui'
import { IconPencil, IconPlus } from '../../components/Icons'
import { Avatar, CategoryIcon } from '../../components/visuals'
import { useBusy } from '../../components/useBusy'
import { formatDate } from '../../lib/dates'
import { describeRate, formatMoney } from '../../lib/money/money'
import { PAYMENT_METHOD_LABELS, type Traveller } from '../../types/domain'
import { SPLIT_MODE_LABELS } from './labels'
import { TripLockedBanner } from './TripLockedBanner'
import { useWhoIs } from './useWhoIs'

export function ExpenseDetailPage({ tripId, expenseId }: { tripId: string; expenseId: string }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, run] = useBusy()
  return (
    <TripGuard tripId={tripId}>
      {({ trip, expenses, shares, categories, travellers }) => {
        const expense = expenses.find((e) => e.id === expenseId)
        if (!expense)
          return (
            <EmptyState art="expenses" title="Expense not found" action={<LinkButton to={paths.expenses(tripId)}>Back to expenses</LinkButton>}>
              It may have been deleted.
            </EmptyState>
          )
        const names = new Map(travellers.map((t) => [t.id, t.displayName]))
        const own = shares.filter((s) => s.expenseId === expense.id)
        const foreign = expense.originalCurrency !== expense.baseCurrency
        const categoryName = categories.find((c) => c.id === expense.categoryId)?.name ?? 'Unknown'
        const payer = names.get(expense.payerTravellerId) ?? expense.payerNameSnapshot
        return (
          <div className="mx-auto max-w-xl space-y-4">
            <PageHeader title={expense.description} subtitle={trip.name} back={paths.expenses(trip.id)} />

            <Card>
              <div className="flex items-center gap-3">
                <CategoryIcon id={expense.categoryId} name={categoryName} size="lg" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700">{categoryName}</p>
                  <p className="text-sm text-slate-500">{formatDate(expense.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                </div>
              </div>
              <div className="mt-4">
                <p className="text-sm text-slate-500">Amount in {expense.baseCurrency}</p>
                <Money minor={expense.baseAmountMinorUnits} currency={expense.baseCurrency} className="text-4xl font-semibold tracking-tight" />
                {foreign ? (
                  <p className="tabular mt-1 text-sm text-slate-600">
                    {formatMoney(expense.originalAmountMinorUnits, expense.originalCurrency)} at {describeRate(expense.originalCurrency, expense.baseCurrency, expense.exchangeRate)}
                  </p>
                ) : null}
              </div>
              <dl className="mt-4 divide-y divide-slate-100 border-t border-slate-100 text-sm">
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-slate-500">Paid by</dt>
                  <dd className="flex items-center gap-2 font-medium text-slate-900">
                    <Avatar name={payer} size="sm" /> {payer}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="text-slate-500">Payment method</dt>
                  <dd className="text-right font-medium text-slate-900">
                    {PAYMENT_METHOD_LABELS[expense.paymentMethod]}
                    {expense.paymentAccountNote ? <span className="block text-xs font-normal text-slate-500">{expense.paymentAccountNote}</span> : null}
                  </dd>
                </div>
              </dl>
            </Card>

            <AddedBy tripId={trip.id} travellers={travellers} shared={trip.syncMode === 'cloud'} createdBy={expense.createdBy} updatedBy={expense.updatedBy} />

            {trip.status === 'completed' ? (
              <TripLockedBanner tripId={trip.id} />
            ) : (
              <div className="flex flex-wrap gap-2">
                <LinkButton to={paths.expenseEdit(trip.id, expense.id)} variant="primary">
                  <IconPencil width={17} height={17} /> Edit
                </LinkButton>
                <LinkButton to={paths.expenseDuplicate(trip.id, expense.id)}>
                  <IconPlus width={17} height={17} /> Duplicate
                </LinkButton>
                <Button variant="danger" onClick={() => setConfirm(true)}>
                  Delete
                </Button>
              </div>
            )}

            <Card>
              <h2 className="mb-2 text-[15px] font-semibold">Split · {SPLIT_MODE_LABELS[expense.splitMode]}</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {own.map((s) => {
                  const name = names.get(s.travellerId) ?? s.travellerNameSnapshot
                  return (
                    <li key={s.id} className="flex items-center gap-3 py-2.5">
                      <Avatar name={name} size="sm" />
                      <span className="min-w-0 flex-1 truncate">
                        {name}
                        {s.weight ? <span className="text-slate-500"> · {s.weight} share{s.weight === 1 ? '' : 's'}</span> : null}
                      </span>
                      <Money minor={s.allocatedBaseAmountMinorUnits} currency={expense.baseCurrency} className="font-semibold" />
                    </li>
                  )
                })}
              </ul>
            </Card>

            {expense.notes ? (
              <Card>
                <h2 className="mb-1 text-[15px] font-semibold">Notes</h2>
                <p className="text-sm whitespace-pre-wrap text-slate-600">{expense.notes}</p>
              </Card>
            ) : null}

            <ConfirmDialog
              open={confirm}
              title="Delete this expense?"
              confirmLabel="Delete expense"
              busy={busy}
              onCancel={() => setConfirm(false)}
              onConfirm={() =>
                void run(async () => {
                  await expensesRepo.delete(expense.id)
                  setConfirm(false)
                  navigate(paths.expenses(trip.id), { replace: true })
                })
              }
            >
              “{expense.description}” ({formatMoney(expense.baseAmountMinorUnits, expense.baseCurrency)}) and its split will be
              removed. Totals and balances update immediately. This cannot be undone.
            </ConfirmDialog>
          </div>
        )
      }}
    </TripGuard>
  )
}

function AddedBy({
  tripId,
  travellers,
  shared,
  createdBy,
  updatedBy,
}: {
  tripId: string
  travellers: Traveller[]
  shared: boolean
  createdBy: string | undefined
  updatedBy: string | undefined
}) {
  const whoIs = useWhoIs(tripId, travellers)
  if (!shared) return null
  const added = whoIs(createdBy)
  const edited = whoIs(updatedBy)
  if (!added) return null
  return (
    <p className="text-xs text-slate-500">
      Added by {added}
      {edited && updatedBy !== createdBy ? ` · last edited by ${edited}` : ''}
    </p>
  )
}
