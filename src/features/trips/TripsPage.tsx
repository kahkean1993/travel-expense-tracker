import { useTrips } from '../../db/hooks'
import { href, paths } from '../../app/router'
import { EmptyState, LinkButton, Loading, Money, PageHeader } from '../../components/ui'
import { IconPlus } from '../../components/Icons'
import { AvatarStack } from '../../components/visuals'
import { tripCover } from '../../components/look'
import { formatDateRange } from '../../lib/dates'
import { percentUsed } from '../../lib/money/money'
import { cloudConfigured } from '../../sync/cloud'
import type { Trip } from '../../types/domain'

interface Row {
  trip: Trip
  spent: number
  count: number
  people: string[]
}

export function TripsPage() {
  const rows = useTrips()
  if (!rows) return <Loading />

  const sorted = [...rows].sort((a, b) => b.trip.startDate.localeCompare(a.trip.startDate))
  const active = sorted.filter((r) => r.trip.status === 'active')
  const completed = sorted.filter((r) => r.trip.status === 'completed')

  return (
    <div>
      <PageHeader
        title="Trips"
        subtitle={cloudConfigured ? 'On this device unless shared' : 'Saved on this device'}
        actions={
          rows.length ? (
            <LinkButton to={paths.tripNew()} variant="primary">
              <IconPlus width={18} height={18} /> New trip
            </LinkButton>
          ) : null
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          art="trips"
          title="Where are you off to?"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton to={paths.tripNew()} variant="primary">
                <IconPlus width={18} height={18} /> Create your first trip
              </LinkButton>
              <LinkButton to={paths.settings()}>Restore a backup</LinkButton>
            </div>
          }
        >
          Set a budget, add your travel companions and log expenses as you go. Try the sample trip from Settings to look around first.
        </EmptyState>
      ) : (
        <div className="space-y-7">
          <TripList title="Active" rows={active} empty="No active trips." />
          {completed.length ? <TripList title="Completed" rows={completed} /> : null}
        </div>
      )}
    </div>
  )
}

function TripList({ title, rows, empty }: { title: string; rows: Row[]; empty?: string }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2.5 text-xs font-semibold tracking-wider text-slate-500 uppercase">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {rows.map((row, i) => (
            <TripCard key={row.trip.id} row={row} index={i} />
          ))}
        </ul>
      )}
    </section>
  )
}

function TripCard({ row: { trip, spent, count, people }, index }: { row: Row; index: number }) {
  const pct = percentUsed(spent, trip.budgetMinorUnits)
  const tone = pct === null ? 'bg-accent-600' : pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-accent-600'
  return (
    <li className="animate-enter" style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}>
      <a
        href={href(paths.dashboard(trip.id))}
        className="press block overflow-hidden rounded-2xl border border-slate-200/70 bg-surface shadow-card hover:shadow-md"
      >
        <div className={`relative flex min-h-20 items-start justify-between gap-2 overflow-hidden bg-linear-to-br ${tripCover(trip.id)} p-4 text-white`}>
          <span aria-hidden="true" className="absolute -right-8 -bottom-12 size-32 rounded-full bg-white/10" />
          <p className="relative min-w-0 text-sm font-medium text-white/90">
            {trip.destination || 'Trip'}
            <span className="block text-xs text-white/80">{formatDateRange(trip.startDate, trip.endDate)}</span>
          </p>
          <span className="relative flex shrink-0 gap-1.5">
            {trip.syncMode === 'cloud' ? <Pill>Shared</Pill> : null}
            {trip.isSample ? <Pill>Sample</Pill> : null}
          </span>
        </div>
        <div className="space-y-3 p-4">
          <p className="truncate text-lg font-semibold text-slate-900">{trip.name}</p>
          <div>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <Money minor={spent} currency={trip.baseCurrency} className="text-base font-semibold text-slate-900" />
              <span className="text-slate-500">
                {trip.budgetMinorUnits > 0 ? <>of <Money minor={trip.budgetMinorUnits} currency={trip.baseCurrency} /></> : 'No budget'}
              </span>
            </div>
            {pct !== null ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${pct}% of the budget used`}>
                <div className={`h-full origin-left animate-grow-x rounded-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-between text-sm text-slate-500">
            <AvatarStack names={people} />
            <span>
              {count} expense{count === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </a>
    </li>
  )
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold text-white">{children}</span>
}
