import { useState } from 'react'
import { href, paths } from '../../app/router'
import { TripGuard } from '../../components/TripGuard'
import type { TripData } from '../../db/hooks'
import { Card, EmptyState, LinkButton, Money, Notice, PageHeader, SectionTitle } from '../../components/ui'
import { inputClass } from '../../components/styles'
import { formatDate, formatDateRange } from '../../lib/dates'
import { IconPlus } from '../../components/Icons'
import { localDateString } from '../../lib/export/csv'
import { EMPTY_FILTER, filterExpenses, recentExpenses, summariseTrip, totalsByCategory, totalsByDay, type TotalRow } from './stats'
import { ExpenseRow } from '../expenses/ExpenseRow'

export function DashboardPage({ tripId }: { tripId: string }) {
  return <TripGuard tripId={tripId}>{(data) => <Dashboard data={data} />}</TripGuard>
}

function Dashboard({ data }: { data: TripData }) {
  const { trip, expenses, categories, travellers } = data
  const today = localDateString()
  const summary = summariseTrip(trip, expenses, today)
  const cur = trip.baseCurrency
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const filtered = filterExpenses(expenses, { ...EMPTY_FILTER, from, to, categoryId })
  const byCategory = totalsByCategory(filtered, categories)
  const byDay = totalsByDay(filtered)
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const travellerName = new Map(travellers.map((t) => [t.id, t.displayName]))
  const filtering = Boolean(from || to || categoryId)

  const header = (
    <PageHeader
      title={trip.name}
      subtitle={
        <>
          {[trip.destination, formatDateRange(trip.startDate, trip.endDate)].filter(Boolean).join(' · ')}
          {trip.status === 'completed' ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs">Completed</span> : null}
        </>
      }
      actions={<LinkButton to={paths.tripEdit(trip.id)}>Edit trip</LinkButton>}
    />
  )

  return (
    <div className="space-y-4">
      {header}

      {summary.budgetLevel === 'over' ? (
        <Notice tone="danger">
          <strong>Over budget.</strong> You have spent {summary.percentUsed}% of your budget (
          <Money minor={-summary.remaining} currency={cur} /> over).
        </Notice>
      ) : summary.budgetLevel === 'warning' ? (
        <Notice tone="warning">
          <strong>Heads up:</strong> {summary.percentUsed}% of the budget is used.
        </Notice>
      ) : null}

      <Card>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Spent" value={<Money minor={summary.spent} currency={cur} />} strong />
          <Stat
            label={summary.remaining < 0 ? 'Over budget' : 'Remaining'}
            value={summary.budget > 0 ? <Money minor={Math.abs(summary.remaining)} currency={cur} /> : '—'}
          />
          <Stat label="Budget" value={summary.budget > 0 ? <Money minor={summary.budget} currency={cur} /> : 'Not set'} />
          <Stat label="Expenses" value={String(summary.count)} />
        </div>
        {summary.percentUsed !== null ? (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-slate-600">
              <span>{summary.percentUsed}% used</span>
              {summary.daysElapsed && summary.averagePerDay !== null ? (
                <span>
                  Avg <Money minor={summary.averagePerDay} currency={cur} /> / day over {summary.daysElapsed} day
                  {summary.daysElapsed === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-label="Budget used"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.min(100, summary.percentUsed)}
            >
              <div
                className={`h-full rounded-full ${
                  summary.budgetLevel === 'over' ? 'bg-red-600' : summary.budgetLevel === 'warning' ? 'bg-amber-500' : 'bg-accent-700'
                }`}
                style={{ width: `${Math.min(100, summary.percentUsed)}%` }}
              />
            </div>
          </div>
        ) : summary.averagePerDay !== null && summary.daysElapsed ? (
          <p className="mt-3 text-xs text-slate-600">
            Avg <Money minor={summary.averagePerDay} currency={cur} /> / day over {summary.daysElapsed} day
            {summary.daysElapsed === 1 ? '' : 's'}.{' '}
            <a className="text-accent-700 underline" href={href(paths.tripEdit(trip.id))}>
              Set a budget
            </a>{' '}
            to track what's left.
          </p>
        ) : null}
      </Card>

      {expenses.length === 0 ? (
        <EmptyState
          title="No expenses recorded"
          action={
            <LinkButton to={paths.expenseNew(trip.id)} variant="primary">
              <IconPlus width={18} height={18} /> Add the first expense
            </LinkButton>
          }
        >
          Spending by category and by day will appear here once you add expenses.
        </EmptyState>
      ) : (
        <>
          <details className="no-print rounded-xl border border-slate-200 bg-white p-4" open={filtering || undefined}>
            <summary className="cursor-pointer text-sm font-medium text-slate-700">
              Breakdown filters{filtering ? ' (active)' : ''}
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                From
                <input type="date" className={inputClass} value={from} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                To
                <input type="date" className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-sm text-slate-700">
                Category
                <select className={inputClass} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">All categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {filtering ? (
              <button
                type="button"
                className="mt-2 text-sm text-accent-700 underline"
                onClick={() => {
                  setFrom('')
                  setTo('')
                  setCategoryId('')
                }}
              >
                Clear filters
              </button>
            ) : null}
          </details>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle>Spending by category</SectionTitle>
              <BarList rows={byCategory} currency={cur} empty="No expenses match these filters." />
            </Card>
            <Card>
              <SectionTitle>Daily spending</SectionTitle>
              <BarList
                rows={byDay.map((r) => ({ ...r, label: formatDate(r.key, { weekday: 'short', day: 'numeric', month: 'short' }) }))}
                currency={cur}
                empty="No expenses match these filters."
              />
            </Card>
          </div>

          <Card>
            <SectionTitle action={<a className="text-sm text-accent-700 underline" href={href(paths.expenses(trip.id))}>View all</a>}>
              Recent transactions
            </SectionTitle>
            <ul className="-mx-4 -mb-4 divide-y divide-slate-200 border-t border-slate-200">
              {recentExpenses(expenses).map((e) => (
                <ExpenseRow
                  key={e.id}
                  expense={e}
                  categoryName={catName.get(e.categoryId) ?? 'Unknown'}
                  payerName={travellerName.get(e.payerTravellerId) ?? e.payerNameSnapshot}
                />
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={`mt-0.5 truncate ${strong ? 'text-2xl font-semibold' : 'text-lg font-medium'} text-slate-900`}>{value}</p>
    </div>
  )
}

/** Simple horizontal bars; amounts are always shown as text too. */
function BarList({ rows, currency, empty }: { rows: TotalRow[]; currency: string; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-slate-600">{empty}</p>
  const max = Math.max(...rows.map((r) => r.amount), 1)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex justify-between gap-2 text-sm">
            <span className="truncate text-slate-800">
              {r.label} <span className="text-slate-500">· {r.count}</span>
            </span>
            <span className="shrink-0 text-slate-900">
              <Money minor={r.amount} currency={currency} />
              <span className="ml-1.5 inline-block w-10 text-right text-xs text-slate-500">
                {total ? Math.round((r.amount / total) * 100) : 0}%
              </span>
            </span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-slate-100" aria-hidden="true">
            <div className="h-full rounded-full bg-accent-600" style={{ width: `${(r.amount / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
