import { TripGuard } from '../../components/TripGuard'
import type { TripData } from '../../db/hooks'
import { Button, Card, EmptyState, LinkButton, Money, PageHeader } from '../../components/ui'
import { formatDate, formatDateRange } from '../../lib/dates'
import { IconDownload, IconPrinter } from '../../components/Icons'
import { paths } from '../../app/router'
import { buildExpensesCsv, downloadText, localDateString, slugify, todayStamp } from '../../lib/export/csv'
import { formatMoney } from '../../lib/money/money'
import { PAYMENT_METHOD_LABELS } from '../../types/domain'
import { sortExpenses, summariseTrip, totalsByCategory, totalsByDay, type TotalRow } from '../dashboard/stats'
import { settlementFor } from '../splitting/settlement'
import { SPLIT_MODE_LABELS } from '../expenses/labels'

export function ReportPage({ tripId }: { tripId: string }) {
  return <TripGuard tripId={tripId}>{(data) => <Report data={data} />}</TripGuard>
}

function Report({ data }: { data: TripData }) {
  const { trip, expenses, shares, categories, travellers } = data
  const cur = trip.baseCurrency
  const summary = summariseTrip(trip, expenses, localDateString())
  const { names, balances, transfers } = settlementFor(data)
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const sorted = sortExpenses(expenses, 'date_asc')
  const sharesByExpense = new Map<string, typeof shares>()
  for (const s of shares) sharesByExpense.set(s.expenseId, [...(sharesByExpense.get(s.expenseId) ?? []), s])

  function exportCsv() {
    const csv = buildExpensesCsv(trip, expenses, shares, categories, travellers)
    downloadText(`${slugify(trip.name)}-expenses-${todayStamp()}.csv`, csv, 'text/csv;charset=utf-8')
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Trip report"
        subtitle={trip.name}
        actions={
          <>
            <Button onClick={() => window.print()} disabled={expenses.length === 0}>
              <IconPrinter width={18} height={18} /> Print / PDF
            </Button>
            <Button onClick={exportCsv} disabled={expenses.length === 0}>
              <IconDownload width={18} height={18} /> Export CSV
            </Button>
          </>
        }
      />
      <p className="no-print text-sm text-slate-600">
        The CSV opens in Excel or Google Sheets. For a full backup of every trip that can be restored later, use{' '}
        <a className="text-accent-700 underline" href={`#${paths.settings()}`}>
          Settings &amp; Backup
        </a>
        .
      </p>

      {expenses.length === 0 ? (
        <EmptyState
          title="Nothing to report yet"
          action={<LinkButton to={paths.expenseNew(trip.id)} variant="primary">Add an expense</LinkButton>}
        >
          The report fills in automatically from the expenses you record.
        </EmptyState>
      ) : (
        <article className="space-y-4 print:space-y-6">
          <Card className="print-break-avoid print:border-0 print:p-0">
            <h2 className="text-lg font-semibold">{trip.name}</h2>
            <p className="text-sm text-slate-600">
              {[trip.destination, formatDateRange(trip.startDate, trip.endDate)].filter(Boolean).join(' · ')}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Item label="Base currency" value={cur} />
              <Item label="Budget" value={trip.budgetMinorUnits ? formatMoney(trip.budgetMinorUnits, cur) : 'Not set'} />
              <Item label="Total spent" value={formatMoney(summary.spent, cur)} />
              <Item
                label={summary.remaining < 0 ? 'Over budget by' : 'Under budget by'}
                value={trip.budgetMinorUnits ? formatMoney(Math.abs(summary.remaining), cur) : '—'}
              />
            </dl>
            <p className="mt-2 text-xs text-slate-500">
              {summary.count} expenses · Report generated {formatDate(localDateString())}
            </p>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
            <TotalsTable title="By category" rows={totalsByCategory(expenses, categories)} currency={cur} />
            <TotalsTable
              title="By day"
              rows={totalsByDay(expenses).map((r) => ({ ...r, label: formatDate(r.key, { weekday: 'short', day: 'numeric', month: 'short' }) }))}
              currency={cur}
            />
          </div>

          <Card className="print-break-avoid print:border-0 print:p-0">
            <h2 className="mb-2 text-base font-semibold">Per traveller ({cur})</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                  <th className="py-1.5 font-medium">Person</th>
                  <th className="py-1.5 text-right font-medium">Paid</th>
                  <th className="py-1.5 text-right font-medium">Share</th>
                  <th className="py-1.5 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {balances.map((b) => (
                  <tr key={b.travellerId}>
                    <td className="py-1.5">{names.get(b.travellerId)}</td>
                    <td className="py-1.5 text-right"><Money minor={b.paid} currency={cur} /></td>
                    <td className="py-1.5 text-right"><Money minor={b.share} currency={cur} /></td>
                    <td className="py-1.5 text-right font-medium">
                      <Money minor={b.net} currency={cur} /> {b.net > 0 ? '(gets back)' : b.net < 0 ? '(owes)' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="mt-4 mb-1 text-sm font-semibold">Settlement suggestions</h3>
            {transfers.length === 0 ? (
              <p className="text-sm text-slate-600">Everyone is settled up.</p>
            ) : (
              <ul className="list-disc pl-5 text-sm">
                {transfers.map((t, i) => (
                  <li key={i}>
                    {names.get(t.fromTravellerId)} pays {names.get(t.toTravellerId)} {formatMoney(t.amount, cur)}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-slate-500">Suggestions only; not recorded payments.</p>
          </Card>

          <Card className="print:border-0 print:p-0">
            <h2 className="mb-2 text-base font-semibold">All expenses</h2>
            <div className="-mx-4 overflow-x-auto print:mx-0 print:overflow-visible">
              <table className="w-full min-w-[46rem] text-xs sm:text-sm print:min-w-0 print:text-[9pt]">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase">
                    <th className="px-4 py-1.5 font-medium print:px-1">Date</th>
                    <th className="px-2 py-1.5 font-medium print:px-1">Description</th>
                    <th className="px-2 py-1.5 font-medium print:px-1">Category</th>
                    <th className="px-2 py-1.5 text-right font-medium print:px-1">Original</th>
                    <th className="px-2 py-1.5 text-right font-medium print:px-1">Rate</th>
                    <th className="px-2 py-1.5 text-right font-medium print:px-1">{cur}</th>
                    <th className="px-2 py-1.5 font-medium print:px-1">Method</th>
                    <th className="px-2 py-1.5 font-medium print:px-1">Paid by</th>
                    <th className="px-4 py-1.5 font-medium print:px-1">Split</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 align-top">
                  {sorted.map((e) => {
                    const foreign = e.originalCurrency !== e.baseCurrency
                    return (
                      <tr key={e.id} className="print-break-avoid">
                        <td className="px-4 py-1.5 whitespace-nowrap print:px-1">{e.date}</td>
                        <td className="px-2 py-1.5 print:px-1">
                          {e.description}
                          {e.notes ? <span className="block text-slate-500">{e.notes}</span> : null}
                        </td>
                        <td className="px-2 py-1.5 print:px-1">{catName.get(e.categoryId) ?? 'Unknown'}</td>
                        <td className="px-2 py-1.5 text-right whitespace-nowrap tabular print:px-1">
                          {formatMoney(e.originalAmountMinorUnits, e.originalCurrency)}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular print:px-1">{foreign ? e.exchangeRate : '—'}</td>
                        <td className="px-2 py-1.5 text-right print:px-1">
                          <Money minor={e.baseAmountMinorUnits} currency={cur} />
                        </td>
                        <td className="px-2 py-1.5 print:px-1">
                          {PAYMENT_METHOD_LABELS[e.paymentMethod]}
                          {e.paymentAccountNote ? <span className="block text-slate-500">{e.paymentAccountNote}</span> : null}
                        </td>
                        <td className="px-2 py-1.5 print:px-1">{names.get(e.payerTravellerId)}</td>
                        <td className="px-4 py-1.5 print:px-1">
                          <span className="text-slate-500">{SPLIT_MODE_LABELS[e.splitMode]}</span>
                          {(sharesByExpense.get(e.id) ?? []).map((s) => (
                            <span key={s.id} className="block whitespace-nowrap">
                              {names.get(s.travellerId)}: {formatMoney(s.allocatedBaseAmountMinorUnits, cur)}
                            </span>
                          ))}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-semibold">
                    <td className="px-4 py-2 print:px-1" colSpan={5}>Total</td>
                    <td className="px-2 py-2 text-right print:px-1"><Money minor={summary.spent} currency={cur} /></td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-500">Rate = how many {cur} one unit of the original currency was worth.</p>
          </Card>
        </article>
      )}
    </div>
  )
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium tabular">{value}</dd>
    </div>
  )
}

function TotalsTable({ title, rows, currency }: { title: string; rows: TotalRow[]; currency: string }) {
  return (
    <Card className="print-break-avoid print:border-0 print:p-0">
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      <table className="w-full text-sm">
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="py-1.5">{r.label}</td>
              <td className="py-1.5 text-right text-slate-500">{r.count}</td>
              <td className="py-1.5 text-right"><Money minor={r.amount} currency={currency} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
