import { useState } from 'react'
import { navigate, paths } from '../../app/router'
import { TripGuard } from '../../components/TripGuard'
import { expensesRepo } from '../../db/repositories'
import { Card, ConfirmDialog, EmptyState, LinkButton, Button, Money, PageHeader } from '../../components/ui'
import { formatDate } from '../../lib/dates'
import { useBusy } from '../../components/useBusy'
import { describeRate, formatMoney } from '../../lib/money/money'
import { PAYMENT_METHOD_LABELS } from '../../types/domain'
import { SPLIT_MODE_LABELS } from './labels'

export function ExpenseDetailPage({ tripId, expenseId }: { tripId: string; expenseId: string }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, run] = useBusy()
  return (
    <TripGuard tripId={tripId}>
      {({ trip, expenses, shares, categories, travellers }) => {
        const expense = expenses.find((e) => e.id === expenseId)
        if (!expense)
          return (
            <EmptyState title="Expense not found" action={<LinkButton to={paths.expenses(tripId)}>Back to expenses</LinkButton>}>
              It may have been deleted.
            </EmptyState>
          )
        const names = new Map(travellers.map((t) => [t.id, t.displayName]))
        const own = shares.filter((s) => s.expenseId === expense.id)
        const foreign = expense.originalCurrency !== expense.baseCurrency
        const rows: [string, React.ReactNode][] = [
          ['Date', formatDate(expense.date, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })],
          ['Category', categories.find((c) => c.id === expense.categoryId)?.name ?? 'Unknown'],
          ['Paid by', names.get(expense.payerTravellerId) ?? expense.payerNameSnapshot],
          [
            'Payment method',
            PAYMENT_METHOD_LABELS[expense.paymentMethod] + (expense.paymentAccountNote ? ` · ${expense.paymentAccountNote}` : ''),
          ],
        ]
        if (foreign) {
          rows.unshift(
            ['Original amount', <span className="tabular">{formatMoney(expense.originalAmountMinorUnits, expense.originalCurrency)}</span>],
            ['Exchange rate', <span className="tabular">{describeRate(expense.originalCurrency, expense.baseCurrency, expense.exchangeRate)}</span>],
          )
        }
        return (
          <div className="mx-auto max-w-xl">
            <PageHeader title={expense.description} subtitle={trip.name} back={paths.expenses(trip.id)} />
            <Card className="space-y-4">
              <div>
                <p className="text-sm text-slate-600">Amount in {expense.baseCurrency}</p>
                <Money minor={expense.baseAmountMinorUnits} currency={expense.baseCurrency} className="text-3xl font-semibold" />
              </div>
              <dl className="divide-y divide-slate-100 text-sm">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 py-2">
                    <dt className="text-slate-600">{k}</dt>
                    <dd className="text-right text-slate-900">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>

            <Card className="mt-4">
              <h2 className="mb-2 text-base font-semibold">Split · {SPLIT_MODE_LABELS[expense.splitMode]}</h2>
              <ul className="divide-y divide-slate-100 text-sm">
                {own.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2 py-2">
                    <span>
                      {names.get(s.travellerId) ?? s.travellerNameSnapshot}
                      {s.weight ? <span className="text-slate-500"> · {s.weight} share{s.weight === 1 ? '' : 's'}</span> : null}
                    </span>
                    <Money minor={s.allocatedBaseAmountMinorUnits} currency={expense.baseCurrency} />
                  </li>
                ))}
              </ul>
            </Card>

            {expense.notes ? (
              <Card className="mt-4">
                <h2 className="mb-1 text-base font-semibold">Notes</h2>
                <p className="text-sm whitespace-pre-wrap text-slate-700">{expense.notes}</p>
              </Card>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <LinkButton to={paths.expenseEdit(trip.id, expense.id)} variant="primary">
                Edit
              </LinkButton>
              <LinkButton to={paths.expenseDuplicate(trip.id, expense.id)}>Duplicate</LinkButton>
              <Button variant="danger" onClick={() => setConfirm(true)}>
                Delete
              </Button>
            </div>

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
