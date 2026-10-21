import type { TripData } from '../../db/hooks'
import { computeBalances, suggestSettlements } from './allocate'

/** Balance rows, display names and settlement suggestions for a trip. */
export function settlementFor({ travellers, expenses, shares }: Pick<TripData, 'travellers' | 'expenses' | 'shares'>) {
  const names = new Map(travellers.map((t) => [t.id, t.displayName]))
  // Fall back to saved snapshots for anyone no longer in the list.
  for (const s of shares) if (!names.has(s.travellerId)) names.set(s.travellerId, s.travellerNameSnapshot || 'Former traveller')
  for (const e of expenses) if (!names.has(e.payerTravellerId)) names.set(e.payerTravellerId, e.payerNameSnapshot || 'Former traveller')
  const balances = computeBalances(travellers.map((t) => t.id), expenses, shares)
  return { names, balances, transfers: suggestSettlements(balances) }
}
