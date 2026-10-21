import { useTrips } from '../../db/hooks'
import { href, paths } from '../../app/router'
import { EmptyState, LinkButton, Loading, Money, PageHeader } from '../../components/ui'
import { formatDateRange } from '../../lib/dates'
import { IconChevronRight, IconPlus } from '../../components/Icons'
import { percentUsed } from '../../lib/money/money'
import type { Trip } from '../../types/domain'

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
        subtitle="Saved in this browser on this device only."
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
          title="No trips yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <LinkButton to={paths.tripNew()} variant="primary">
                <IconPlus width={18} height={18} /> Create your first trip
              </LinkButton>
              <LinkButton to={paths.settings()}>Restore a backup</LinkButton>
            </div>
          }
        >
          Create a trip with a budget and base currency, then record expenses as you go. You can also load sample data
          from Settings to explore.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <TripList title="Active" rows={active} empty="No active trips." />
          {completed.length ? <TripList title="Completed" rows={completed} /> : null}
        </div>
      )}
    </div>
  )
}

function TripList({ title, rows, empty }: { title: string; rows: { trip: Trip; spent: number; count: number }[]; empty?: string }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-600">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {rows.map(({ trip, spent, count }) => {
            const pct = percentUsed(spent, trip.budgetMinorUnits)
            return (
              <li key={trip.id}>
                <a href={href(paths.dashboard(trip.id))} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-900">
                      {trip.name}
                      {trip.isSample ? <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-600">Sample</span> : null}
                    </p>
                    <p className="truncate text-sm text-slate-600">
                      {[trip.destination, formatDateRange(trip.startDate, trip.endDate)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <Money minor={spent} currency={trip.baseCurrency} className="font-medium text-slate-900" />
                    <p className="text-xs text-slate-500">
                      {pct === null ? `${count} expense${count === 1 ? '' : 's'}` : `${pct}% of budget`}
                    </p>
                  </div>
                  <IconChevronRight className="shrink-0 text-slate-400" />
                </a>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
