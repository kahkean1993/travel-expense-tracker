import type { TripData } from '../../db/hooks'
import { formatMoney } from '../../lib/money/money'
import { settlementFor } from './settlement'

/** Plain-text summary that can be pasted into a chat. */
export function summaryText(data: TripData): string {
  const { trip } = data
  const cur = trip.baseCurrency
  const { names, balances, transfers } = settlementFor(data)
  const lines = [`${trip.name} – who pays whom`]
  if (transfers.length === 0) lines.push('Everyone is settled up.')
  for (const t of transfers) lines.push(`• ${names.get(t.fromTravellerId)} pays ${names.get(t.toTravellerId)} ${formatMoney(t.amount, cur)}`)
  const paid = data.settlements
  if (paid.length > 0) {
    lines.push('', 'Already paid:')
    for (const p of paid) lines.push(`• ${names.get(p.fromTravellerId)} → ${names.get(p.toTravellerId)} ${formatMoney(p.amountMinorUnits, cur)}`)
  }
  lines.push('', 'Balances:')
  for (const b of balances) {
    const who = names.get(b.travellerId)
    lines.push(`• ${who}: ${b.net > 0 ? 'gets back' : b.net < 0 ? 'owes' : 'settled'} ${b.net === 0 ? '' : formatMoney(Math.abs(b.net), cur)}`.trimEnd())
  }
  return lines.join('\n')
}
