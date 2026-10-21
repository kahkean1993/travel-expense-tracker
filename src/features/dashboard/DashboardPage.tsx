import { useEffect, useState } from 'react'
import { href, paths } from '../../app/router'
import { TripGuard } from '../../components/TripGuard'
import type { TripData } from '../../db/hooks'
import { Card, EmptyState, LinkButton, Money, SectionTitle } from '../../components/ui'
import { inputClass, iconButtonClass } from '../../components/styles'
import { IconAlert, IconFilter, IconPencil, IconPlus } from '../../components/Icons'
import { AvatarStack, CategoryIcon, CountUpMoney, Ring, type RingTone } from '../../components/visuals'
import { categoryLook } from '../../components/look'
import { formatDate, formatDateRange } from '../../lib/dates'
import { localDateString } from '../../lib/export/csv'
import { formatMoney } from '../../lib/money/money'
import { EMPTY_FILTER, dailySeries, filterExpenses, recentExpenses, summariseTrip, totalsByCategory } from './stats'
import { ExpenseRow } from '../expenses/ExpenseRow'
import { clearJustSaved, peekJustSaved } from '../expenses/justSaved'

export function DashboardPage({ tripId }: { tripId: string }) {
  return <TripGuard tripId={tripId}>{(data) => <Dashboard data={data} />}</TripGuard>
}

function Dashboard({ data }: { data: TripData }) {
  const { trip, expenses, categories, travellers } = data
  const today = localDateString()
  const summary = summariseTrip(trip, expenses, today)
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const travellerName = new Map(travellers.map((t) => [t.id, t.displayName]))
  const [justSaved] = useState(peekJustSaved)
  // Forget the "just saved" highlight a moment after it has been shown.
  useEffect(() => {
    if (!justSaved) return
    const timer = setTimeout(clearJustSaved, 2500)
    return () => clearTimeout(timer)
  }, [justSaved])

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words text-slate-900">{trip.name}</h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
            <span>{[trip.destination, formatDateRange(trip.startDate, trip.endDate)].filter(Boolean).join(' · ')}</span>
            {trip.status === 'completed' ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">Completed</span> : null}
          </p>
          {travellers.length > 1 ? (
            <p className="mt-2.5 flex items-center gap-2 text-sm text-slate-600">
              <AvatarStack names={travellers.map((t) => t.displayName)} />
              <span className="truncate">{travellers.map((t) => t.displayName).join(', ')}</span>
            </p>
          ) : null}
        </div>
        <a href={href(paths.tripEdit(trip.id))} className={`-mr-2 ${iconButtonClass}`} aria-label="Edit trip">
          <IconPencil width={19} height={19} />
        </a>
      </header>

      <BudgetHero data={data} summary={summary} />

      {expenses.length === 0 ? (
        <EmptyState
          art="expenses"
          title="No expenses yet"
          action={
            <LinkButton to={paths.expenseNew(trip.id)} variant="primary">
              <IconPlus width={18} height={18} /> Add the first expense
            </LinkButton>
          }
        >
          Spending by category and by day will show up here as you add expenses.
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <CategoryCard data={data} />
            <DailyCard data={data} today={today} average={summary.averagePerDay} />
          </div>

          <Card className="overflow-hidden p-0 sm:p-0">
            <div className="px-4 pt-4 sm:px-5 sm:pt-5">
              <SectionTitle action={<a className="rounded-lg px-2 py-1.5 text-sm font-medium text-accent-700 hover:bg-accent-50" href={href(paths.expenses(trip.id))}>View all</a>}>
                Recent
              </SectionTitle>
            </div>
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {recentExpenses(expenses).map((e, i) => (
                <ExpenseRow
                  key={e.id}
                  expense={e}
                  index={i}
                  highlight={e.id === justSaved}
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

// ---------- Budget hero ----------

function BudgetHero({ data, summary }: { data: TripData; summary: ReturnType<typeof summariseTrip> }) {
  const { trip } = data
  const cur = trip.baseCurrency
  const hasBudget = summary.budget > 0
  const over = summary.budgetLevel === 'over'
  const tone: RingTone = over ? 'over' : summary.budgetLevel === 'warning' ? 'warning' : 'ok'
  const bigAmount = hasBudget ? Math.abs(summary.remaining) : summary.spent

  return (
    <section aria-label="Budget" className="animate-enter relative overflow-hidden rounded-3xl bg-linear-to-br from-accent-800 to-accent-900 p-5 text-white shadow-raised">
      <span aria-hidden="true" className="pointer-events-none absolute -top-16 -right-12 size-48 rounded-full bg-white/5" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-20 -left-10 size-44 rounded-full bg-white/5" />
      <div className="relative grid grid-cols-[1fr_auto] items-center gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white/80">{hasBudget ? (over ? 'Over budget by' : 'Left to spend') : 'Spent so far'}</p>
          <CountUpMoney
            minor={bigAmount}
            currency={cur}
            className="mt-1 block text-[clamp(1.75rem,8.5vw,2.5rem)] leading-tight font-semibold tracking-tight"
          />
          <p className="mt-1 text-sm text-white/80">
            {hasBudget ? (
              <>of {formatMoney(summary.budget, cur)} budget</>
            ) : (
              <>
                No budget set ·{' '}
                <a className="font-medium text-white underline underline-offset-2" href={href(paths.tripEdit(trip.id))}>
                  Set one
                </a>
              </>
            )}
          </p>
        </div>
        {summary.percentUsed !== null ? (
          <Ring percent={summary.percentUsed} tone={tone} size={88} label={`${summary.percentUsed}% of the budget used`} />
        ) : null}
      </div>

      {summary.budgetLevel === 'warning' || over ? (
        <p
          role="status"
          className={`relative mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${
            over ? 'bg-rose-200 text-rose-950' : 'bg-amber-200 text-amber-950'
          }`}
        >
          <IconAlert width={16} height={16} />
          {over ? 'Over budget' : `${summary.percentUsed}% of the budget is used`}
        </p>
      ) : null}

      <dl className="relative mt-5 grid grid-cols-3 gap-2 border-t border-white/15 pt-4">
        <HeroStat label="Spent" value={<Money minor={summary.spent} currency={cur} hideSymbol />} />
        {hasBudget ? <HeroStat label="Budget" value={<Money minor={summary.budget} currency={cur} hideSymbol />} /> : <HeroStat label="Expenses" value={String(summary.count)} />}
        <HeroStat
          label="Per day"
          value={summary.averagePerDay !== null ? <Money minor={summary.averagePerDay} currency={cur} hideSymbol /> : '–'}
        />
      </dl>
    </section>
  )
}

function HeroStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-white/75">{label}</dt>
      <dd className="mt-0.5 truncate text-[15px] font-semibold">{value}</dd>
    </div>
  )
}

// ---------- By category ----------

function CategoryCard({ data }: { data: TripData }) {
  const { trip, expenses, categories } = data
  const cur = trip.baseCurrency
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const filtered = filterExpenses(expenses, { ...EMPTY_FILTER, from, to, categoryId })
  const rows = totalsByCategory(filtered, categories)
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const shown = showAll ? rows : rows.slice(0, 5)
  const filtering = Boolean(from || to || categoryId)

  return (
    <Card>
      <SectionTitle
        action={
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="dash-filters"
            className="press inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-accent-700 hover:bg-accent-50"
          >
            <IconFilter width={16} height={16} /> Filter{filtering ? ' (on)' : ''}
          </button>
        }
      >
        By category
      </SectionTitle>

      {open ? (
        <div id="dash-filters" className="animate-enter mb-4 grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-3">
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
          {filtering ? (
            <button
              type="button"
              className="justify-self-start text-sm font-medium text-accent-700 underline"
              onClick={() => {
                setFrom('')
                setTo('')
                setCategoryId('')
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <p className="py-4 text-sm text-slate-500">No expenses match these filters.</p>
      ) : (
        <>
          <div className="mb-4 flex h-3 origin-left animate-grow-x overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            {rows.map((r) => (
              <span key={r.key} className={`h-full ${categoryLook(r.key, r.label).bar}`} style={{ width: `${(r.amount / total) * 100}%` }} />
            ))}
          </div>
          <ul className="space-y-3">
            {shown.map((r) => (
              <li key={r.key} className="flex items-center gap-3">
                <CategoryIcon id={r.key} name={r.label} size="sm" />
                <span className="min-w-0 flex-1 text-sm leading-tight text-slate-800">
                  {r.label}
                  <span className="block text-xs text-slate-500">
                    {r.count} expense{r.count === 1 ? '' : 's'}
                  </span>
                </span>
                <Money minor={r.amount} currency={cur} className="text-sm font-semibold text-slate-900" />
                <span className="tabular w-9 text-right text-xs text-slate-500">{total ? Math.round((r.amount / total) * 100) : 0}%</span>
              </li>
            ))}
          </ul>
          {rows.length > 5 ? (
            <button type="button" className="mt-3 min-h-9 text-sm font-medium text-accent-700 underline" onClick={() => setShowAll((s) => !s)}>
              {showAll ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          ) : null}
        </>
      )}
    </Card>
  )
}

// ---------- Daily spending ----------

function DailyCard({ data, today, average }: { data: TripData; today: string; average: number | null }) {
  const { trip, expenses } = data
  const cur = trip.baseCurrency
  const bars = dailySeries(trip, expenses, today)
  const max = Math.max(...bars.map((b) => b.amount), 1)
  const compact = bars.length > 9

  return (
    <Card>
      <SectionTitle action={average !== null ? <span className="text-xs text-slate-500">Avg {formatMoney(average, cur)} / day</span> : null}>
        Daily spending
      </SectionTitle>
      <div className="flex h-36 items-end gap-1.5" aria-hidden="true">
        {bars.map((b, i) => (
          <div key={b.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={`${formatDate(b.date, { day: 'numeric', month: 'short' })}: ${formatMoney(b.amount, cur)}`}>
            <div className="flex w-full flex-1 items-end justify-center">
              {b.amount > 0 ? (
                <div
                  className={`w-full max-w-9 origin-bottom animate-grow-y rounded-t-md ${b.isToday ? 'bg-accent-700' : 'bg-accent-600/70'}`}
                  style={{ height: `${Math.max(6, (b.amount / max) * 100)}%`, animationDelay: `${Math.min(i, 14) * 40}ms` }}
                />
              ) : (
                <span className={`mb-0.5 size-1.5 rounded-full ${b.isFuture ? 'bg-slate-200' : 'bg-slate-300'}`} />
              )}
            </div>
            <span className={`tabular text-[11px] leading-none ${b.isToday ? 'font-semibold text-accent-800' : 'text-slate-500'}`}>
              {compact ? new Date(b.date + 'T00:00:00').getDate() : formatDate(b.date, { weekday: 'short' }).slice(0, 3)}
            </span>
          </div>
        ))}
      </div>
      {/* The same numbers as text, for screen readers. */}
      <ul className="sr-only">
        {bars.map((b) => (
          <li key={b.date}>
            {formatDate(b.date)}: {formatMoney(b.amount, cur)}
          </li>
        ))}
      </ul>
    </Card>
  )
}
