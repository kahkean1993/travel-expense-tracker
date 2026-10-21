import { paths } from '../../app/router'
import { TripGuard } from '../../components/TripGuard'
import type { TripData } from '../../db/hooks'
import { Card, EmptyState, LinkButton, Money, PageHeader, SectionTitle } from '../../components/ui'
import { formatDate } from '../../lib/dates'
import { formatMoney } from '../../lib/money/money'
import { settlementFor } from './settlement'
import { statementFor } from './statement'

export function PersonStatementPage({ tripId, travellerId }: { tripId: string; travellerId: string }) {
  return <TripGuard tripId={tripId}>{(data) => <Statement data={data} travellerId={travellerId} />}</TripGuard>
}

function Statement({ data, travellerId }: { data: TripData; travellerId: string }) {
  const { trip, expenses, shares, settlements } = data
  const cur = trip.baseCurrency
  const { names } = settlementFor(data)
  if (!names.has(travellerId)) {
    return (
      <EmptyState title="Person not found" action={<LinkButton to={paths.travellers(trip.id)} variant="primary">Back to split</LinkButton>}>
        They may have been removed from this trip.
      </EmptyState>
    )
  }
  const name = names.get(travellerId)!
  const { lines, totals } = statementFor(travellerId, expenses, shares, settlements, names)
  const verdict = totals.net > 0 ? `${name} gets back ${formatMoney(totals.net, cur)}` : totals.net < 0 ? `${name} owes ${formatMoney(-totals.net, cur)}` : `${name} is settled up`

  return (
    <div className="space-y-4">
      <PageHeader title={name} subtitle={`${trip.name} · why the balance is what it is`} back={paths.travellers(trip.id)} />

      <Card>
        <p className="text-lg font-semibold text-slate-900">{verdict}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <Row label="Paid for the group" minor={totals.paid} cur={cur} />
          <Row label="Their share of costs" minor={totals.share} cur={cur} />
          <Row label="Payments they made" minor={totals.sent} cur={cur} />
          <Row label="Payments they received" minor={totals.received} cur={cur} />
        </dl>
        <p className="mt-3 text-xs text-slate-500">Balance = paid − share + payments made − payments received.</p>
      </Card>

      <Card className="p-0 sm:p-0">
        <div className="px-4 pt-4 sm:px-5 sm:pt-5">
          <SectionTitle>Line by line</SectionTitle>
        </div>
        {lines.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-slate-500 sm:px-5">Nothing yet. Expenses and payments involving {name} appear here.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {lines.map((l) => (
              <li key={`${l.kind}:${l.id}`} className="flex items-start gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">{l.title}</p>
                  <p className="text-xs text-slate-500">
                    {formatDate(l.date)}
                    {l.detail ? ` · ${l.detail}` : ''}
                  </p>
                  {l.kind === 'expense' ? (
                    <p className="mt-0.5 text-xs text-slate-600">
                      {l.paid > 0 ? `Paid ${formatMoney(l.paid, cur)}` : ''}
                      {l.paid > 0 && l.share > 0 ? ' · ' : ''}
                      {l.share > 0 ? `share ${formatMoney(l.share, cur)}` : ''}
                    </p>
                  ) : null}
                </div>
                <span className={`tabular shrink-0 text-sm font-semibold ${l.effect > 0 ? 'text-emerald-800' : l.effect < 0 ? 'text-rose-800' : 'text-slate-600'}`}>
                  {l.effect > 0 ? '+' : l.effect < 0 ? '−' : ''}
                  <Money minor={Math.abs(l.effect)} currency={cur} hideSymbol />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Row({ label, minor, cur }: { label: string; minor: number; cur: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-900">
        <Money minor={minor} currency={cur} />
      </dd>
    </div>
  )
}
