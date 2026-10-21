import { TripLockedBanner } from './TripLockedBanner'
import { useEffect, useState } from 'react'
import { paths } from '../../app/router'
import { TripGuard } from '../../components/TripGuard'
import type { TripData } from '../../db/hooks'
import { Button, EmptyState, LinkButton, Money, PageHeader } from '../../components/ui'
import { inputClass } from '../../components/styles'
import { IconFilter, IconPlus, IconSearch } from '../../components/Icons'
import { dayLabel } from '../../lib/dates'
import { localDateString } from '../../lib/export/csv'
import { EMPTY_FILTER, filterExpenses, sortExpenses, type ExpenseFilter, type ExpenseSort } from '../dashboard/stats'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '../../types/domain'
import { sumMinor } from '../../lib/money/money'
import { ExpenseRow } from './ExpenseRow'
import { clearJustSaved, peekJustSaved } from './justSaved'

export function ExpensesPage({ tripId }: { tripId: string }) {
  return <TripGuard tripId={tripId}>{(data) => <ExpenseList data={data} />}</TripGuard>
}

const selectClass = 'min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base'

function ExpenseList({ data }: { data: TripData }) {
  const { trip, expenses, categories, travellers } = data
  const [filter, setFilter] = useState<ExpenseFilter>(EMPTY_FILTER)
  const [sort, setSort] = useState<ExpenseSort>('date_desc')
  const [showFilters, setShowFilters] = useState(false)
  const [justSaved] = useState(peekJustSaved)
  const today = localDateString()
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const travellerName = new Map(travellers.map((t) => [t.id, t.displayName]))
  const currencies = [...new Set(expenses.map((e) => e.originalCurrency))].sort()

  // Forget the "just saved" highlight a moment after it has been shown.
  useEffect(() => {
    if (!justSaved) return
    const timer = setTimeout(clearJustSaved, 2500)
    return () => clearTimeout(timer)
  }, [justSaved])

  const visible = sortExpenses(filterExpenses(expenses, filter), sort)
  const activeFilters = Object.entries(filter).filter(([k, v]) => k !== 'search' && v).length
  const update = (patch: Partial<ExpenseFilter>) => setFilter((f) => ({ ...f, ...patch }))
  const groupByDate = sort === 'date_desc' || sort === 'date_asc'

  if (expenses.length === 0) {
    return (
      <div>
        <PageHeader title="Expenses" subtitle={trip.name} />
        <EmptyState
          art="expenses"
          title="No expenses yet"
          action={
            trip.status === 'completed' ? undefined : (
              <LinkButton to={paths.expenseNew(trip.id)} variant="primary">
                <IconPlus width={18} height={18} /> Add expense
              </LinkButton>
            )
          }
        >
          Log your first expense. Foreign currencies are converted to {trip.baseCurrency} with the rate you enter.
        </EmptyState>
      </div>
    )
  }

  const groups: { date: string; items: typeof visible }[] = []
  for (const e of visible) {
    const last = groups[groups.length - 1]
    if (groupByDate && last && last.date === e.date) last.items.push(e)
    else groups.push({ date: groupByDate ? e.date : '', items: [e] })
  }
  let rowIndex = 0

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle={trip.name}
        actions={
          trip.status === 'completed' ? undefined : (
            <LinkButton to={paths.expenseNew(trip.id)} variant="primary" className="hidden md:inline-flex">
              <IconPlus width={18} height={18} /> Add expense
            </LinkButton>
          )
        }
      />
      {trip.status === 'completed' ? (
        <div className="mb-3">
          <TripLockedBanner tripId={trip.id} />
        </div>
      ) : null}

      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            className={`${inputClass} pl-11`}
            placeholder="Search expenses"
            aria-label="Search expenses"
            value={filter.search}
            onChange={(e) => update({ search: e.target.value })}
          />
        </div>
        <Button
          onClick={() => setShowFilters((s) => !s)}
          aria-expanded={showFilters}
          aria-controls="expense-filters"
          aria-label={activeFilters ? `Filters, ${activeFilters} on` : 'Filters'}
          className="min-h-12 px-3.5"
        >
          <IconFilter width={18} height={18} />
          <span className="hidden sm:inline">Filters</span>
          {activeFilters ? <span className="rounded-full bg-accent-700 px-1.5 text-xs text-white">{activeFilters}</span> : null}
        </Button>
      </div>

      {showFilters ? (
        <div id="expense-filters" className="animate-enter mb-3 grid grid-cols-1 gap-3 rounded-2xl border border-slate-200/70 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            From
            <input type="date" className={inputClass} value={filter.from} onChange={(e) => update({ from: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            To
            <input type="date" className={inputClass} value={filter.to} onChange={(e) => update({ to: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Category
            <select className={selectClass} value={filter.categoryId} onChange={(e) => update({ categoryId: e.target.value })}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Payment method
            <select className={selectClass} value={filter.paymentMethod} onChange={(e) => update({ paymentMethod: e.target.value })}>
              <option value="">All methods</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Paid by
            <select className={selectClass} value={filter.payerId} onChange={(e) => update({ payerId: e.target.value })}>
              <option value="">Anyone</option>
              {travellers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Currency
            <select className={selectClass} value={filter.currency} onChange={(e) => update({ currency: e.target.value })}>
              <option value="">All currencies</option>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <Button variant="ghost" onClick={() => setFilter({ ...EMPTY_FILTER, search: filter.search })} disabled={!activeFilters}>
              Clear filters
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mb-1 flex items-center justify-between gap-2 text-sm text-slate-600">
        <p aria-live="polite" className="leading-tight">
          <span className="block text-xs text-slate-500">
            {visible.length === expenses.length ? `${visible.length} expense${visible.length === 1 ? '' : 's'}` : `${visible.length} of ${expenses.length} expenses`}
          </span>
          <Money minor={sumMinor(visible.map((e) => e.baseAmountMinorUnits))} currency={trip.baseCurrency} className="text-lg font-semibold text-slate-900" />
        </p>
        <label className="flex items-center gap-2">
          <span className="sr-only">Sort by</span>
          <select
            className="min-h-10 rounded-full border border-slate-300 bg-white pr-2 pl-3 text-sm text-slate-700"
            value={sort}
            onChange={(e) => setSort(e.target.value as ExpenseSort)}
          >
            <option value="date_desc">Newest first</option>
            <option value="date_asc">Oldest first</option>
            <option value="amount_desc">Highest amount</option>
            <option value="amount_asc">Lowest amount</option>
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="mt-3">
          <EmptyState art="search" title="Nothing matches">
            Try a different search, or clear the filters.
          </EmptyState>
        </div>
      ) : (
        <div className="space-y-1">
          {groups.map((g, gi) => (
            <section key={g.date || gi} aria-label={g.date ? dayLabel(g.date, today) : 'Expenses'}>
              {groupByDate ? (
                <h2 className="sticky top-14 z-10 -mx-4 flex items-baseline justify-between bg-slate-50/95 px-5 py-2.5 text-[13px] font-semibold text-slate-600 backdrop-blur">
                  <span>{dayLabel(g.date, today)}</span>
                  <Money minor={sumMinor(g.items.map((e) => e.baseAmountMinorUnits))} currency={trip.baseCurrency} className="font-medium text-slate-500" />
                </h2>
              ) : null}
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-card">
                {g.items.map((e) => (
                  <ExpenseRow
                    key={e.id}
                    expense={e}
                    index={rowIndex++}
                    highlight={e.id === justSaved}
                    categoryName={catName.get(e.categoryId) ?? 'Unknown'}
                    payerName={travellerName.get(e.payerTravellerId) ?? e.payerNameSnapshot}
                    showDate={!groupByDate}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
