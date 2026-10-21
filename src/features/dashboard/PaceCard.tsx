import type { TripData } from '../../db/hooks'
import { Card, Money, SectionTitle } from '../../components/ui'
import { formatMoney } from '../../lib/money/money'
import { cumulativeSeries, paceInfo } from './stats'

/** Spending so far against an even spread of the budget, plus what is safe to spend today. */
export function PaceCard({ data, today }: { data: TripData; today: string }) {
  const { trip, expenses } = data
  const pace = paceInfo(trip, expenses, today)
  if (!pace) return null
  const cur = trip.baseCurrency
  const points = cumulativeSeries(trip, expenses, today)
  const w = 320
  const h = 120
  const pad = 4
  const top = Math.max(trip.budgetMinorUnits, ...points.map((p) => p.actual ?? 0), 1)
  const x = (i: number) => pad + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (w - pad * 2))
  const y = (v: number) => h - pad - (v / top) * (h - pad * 2)
  const line = (pick: (p: (typeof points)[number]) => number | null) =>
    points
      .map((p, i) => ({ v: pick(p), i }))
      .filter((q): q is { v: number; i: number } => q.v !== null)
      .map((q, n) => `${n === 0 ? 'M' : 'L'}${x(q.i).toFixed(1)} ${y(q.v).toFixed(1)}`)
      .join(' ')

  const ahead = pace.aheadBy
  const status =
    pace.state === 'before'
      ? 'The trip has not started yet.'
      : ahead > 0
        ? `${formatMoney(ahead, cur)} ahead of an even pace`
        : ahead < 0
          ? `${formatMoney(-ahead, cur)} under an even pace`
          : 'Right on an even pace'
  const tone = pace.state === 'before' ? 'text-slate-600' : ahead > 0 ? 'text-rose-800' : 'text-emerald-800'

  return (
    <Card>
      <SectionTitle>Spending pace</SectionTitle>
      {pace.state === 'during' ? (
        <div className="mb-3 rounded-xl bg-accent-50 px-3.5 py-3">
          <p className="text-xs font-medium text-accent-800">Safe to spend today</p>
          <p className="text-2xl font-semibold text-accent-900">
            {pace.safePerDay !== null ? <Money minor={pace.safePerDay} currency={cur} /> : 'Budget used up'}
          </p>
          <p className="text-xs text-accent-800">
            {pace.daysLeft} day{pace.daysLeft === 1 ? '' : 's'} left including today
          </p>
        </div>
      ) : null}
      <p className={`text-sm font-medium ${tone}`}>{status}</p>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="mt-2 h-32 w-full" role="img" aria-label={`Spending against budget plan. ${status}.`}>
        <path d={line((p) => p.plan)} fill="none" strokeWidth={2} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" className="stroke-slate-400" />
        <path d={line((p) => p.actual)} fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="stroke-accent-700" />
      </svg>
      <p className="mt-1 flex gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-accent-700" /> Spent</span>
        <span className="flex items-center gap-1.5"><span className="h-0 w-4 border-t-2 border-dashed border-slate-400" /> Even pace</span>
      </p>
    </Card>
  )
}
