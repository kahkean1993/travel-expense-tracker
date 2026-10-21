/**
 * Share allocation and settlement calculations. All amounts are integer
 * minor units of the trip base currency.
 */

import type { ID, SplitMode } from '../../types/domain'
import type { Result } from '../../lib/money/money'

export interface Allocation {
  travellerId: ID
  amount: number
  weight?: number
}

/**
 * Splits `total` equally between participants. Indivisible minor units are
 * given one each to the first participants in the order supplied, so the
 * result always adds up to `total` and is deterministic.
 */
export function allocateEqual(total: number, participantIds: ID[]): Allocation[] {
  return allocateByWeights(
    total,
    participantIds.map((id) => ({ travellerId: id, weight: 1 })),
  ).map(({ travellerId, amount }) => ({ travellerId, amount }))
}

/**
 * Splits `total` in proportion to whole-number weights using the
 * largest-remainder method. Ties are broken by participant order.
 */
export function allocateByWeights(
  total: number,
  participants: { travellerId: ID; weight: number }[],
): Allocation[] {
  if (participants.length === 0) throw new RangeError('At least one participant is required')
  for (const p of participants) {
    if (!Number.isSafeInteger(p.weight) || p.weight <= 0) {
      throw new RangeError('Weights must be positive whole numbers')
    }
  }
  const totalWeight = BigInt(participants.reduce((s, p) => s + p.weight, 0))
  const big = BigInt(total)
  const rows = participants.map((p, index) => {
    const exact = big * BigInt(p.weight)
    return {
      travellerId: p.travellerId,
      weight: p.weight,
      index,
      amount: exact / totalWeight,
      remainder: exact % totalWeight,
    }
  })
  let leftover = big - rows.reduce((s, r) => s + r.amount, 0n)
  const order = [...rows].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  )
  for (const row of order) {
    if (leftover <= 0n) break
    row.amount += 1n
    leftover -= 1n
  }
  return rows.map((r) => ({ travellerId: r.travellerId, amount: Number(r.amount), weight: r.weight }))
}

/** Checks custom amounts add up exactly to the expense total. */
export function validateCustomAmounts(total: number, allocations: Allocation[]): Result<Allocation[]> {
  if (allocations.length === 0) return { ok: false, error: 'Choose at least one person.' }
  if (allocations.some((a) => !Number.isSafeInteger(a.amount) || a.amount < 0)) {
    return { ok: false, error: 'Each share must be zero or a positive amount.' }
  }
  const sum = allocations.reduce((s, a) => s + a.amount, 0)
  if (sum !== total) {
    return { ok: false, error: sum < total ? 'Shares add up to less than the total.' : 'Shares add up to more than the total.' }
  }
  return { ok: true, value: allocations }
}

export interface SplitInput {
  mode: SplitMode
  total: number
  /** Participants in display order. For "personal" the first entry is used. */
  participantIds: ID[]
  /** custom_amount: minor units per traveller. */
  customAmounts?: Record<ID, number>
  /** custom_weight: shares per traveller. */
  weights?: Record<ID, number>
}

/** Computes the final allocation for any split mode, validating input. */
export function computeAllocation(input: SplitInput): Result<Allocation[]> {
  const { mode, total, participantIds } = input
  if (participantIds.length === 0) {
    return { ok: false, error: mode === 'personal' ? 'Choose who this expense is for.' : 'Choose at least one person.' }
  }
  switch (mode) {
    case 'personal':
      return { ok: true, value: [{ travellerId: participantIds[0]!, amount: total }] }
    case 'equal':
      return { ok: true, value: allocateEqual(total, participantIds) }
    case 'custom_weight': {
      const weights = participantIds.map((id) => ({ travellerId: id, weight: input.weights?.[id] ?? 0 }))
      if (weights.some((w) => !Number.isSafeInteger(w.weight) || w.weight <= 0 || w.weight > 1000)) {
        return { ok: false, error: 'Shares must be whole numbers from 1 to 1000.' }
      }
      return { ok: true, value: allocateByWeights(total, weights) }
    }
    case 'custom_amount':
      return validateCustomAmounts(
        total,
        participantIds.map((id) => ({ travellerId: id, amount: input.customAmounts?.[id] ?? 0 })),
      )
  }
}

export interface BalanceRow {
  travellerId: ID
  /** Total of the expenses this person paid for. */
  paid: number
  /** This person's share of all expenses. */
  share: number
  /** Settlement payments this person has made to others. */
  sent: number
  /** Settlement payments this person has received. */
  received: number
  /** paid − share + sent − received. Positive: should receive money. Negative: owes money. */
  net: number
}

/**
 * Per-traveller totals from expenses (payer + amount), their shares and any
 * recorded settlement payments. Paying someone back moves both balances
 * towards zero, and all balances always add up to zero.
 */
export function computeBalances(
  travellerIds: ID[],
  expenses: { payerTravellerId: ID; baseAmountMinorUnits: number }[],
  shares: { travellerId: ID; allocatedBaseAmountMinorUnits: number }[],
  settlements: { fromTravellerId: ID; toTravellerId: ID; amountMinorUnits: number }[] = [],
): BalanceRow[] {
  const rows = new Map<ID, BalanceRow>()
  const row = (id: ID) => {
    let r = rows.get(id)
    if (!r) {
      r = { travellerId: id, paid: 0, share: 0, sent: 0, received: 0, net: 0 }
      rows.set(id, r)
    }
    return r
  }
  travellerIds.forEach(row)
  for (const e of expenses) row(e.payerTravellerId).paid += e.baseAmountMinorUnits
  for (const s of shares) row(s.travellerId).share += s.allocatedBaseAmountMinorUnits
  for (const p of settlements) {
    row(p.fromTravellerId).sent += p.amountMinorUnits
    row(p.toTravellerId).received += p.amountMinorUnits
  }
  for (const r of rows.values()) r.net = r.paid - r.share + r.sent - r.received
  return [...rows.values()]
}

export interface Transfer {
  fromTravellerId: ID
  toTravellerId: ID
  amount: number
}

/**
 * Suggests transfers that settle every balance. Greedy: repeatedly match the
 * largest debtor with the largest creditor. Produces at most n−1 transfers.
 * Ties are broken by the order of `balances`, so results are deterministic.
 */
export function suggestSettlements(balances: BalanceRow[]): Transfer[] {
  const indexed = balances.map((b, i) => ({ id: b.travellerId, amount: b.net, i }))
  const creditors = indexed.filter((b) => b.amount > 0)
  const debtors = indexed.filter((b) => b.amount < 0).map((d) => ({ ...d, amount: -d.amount }))
  const byAmount = (a: { amount: number; i: number }, b: { amount: number; i: number }) =>
    b.amount - a.amount || a.i - b.i
  const transfers: Transfer[] = []
  while (creditors.length && debtors.length) {
    creditors.sort(byAmount)
    debtors.sort(byAmount)
    const c = creditors[0]!
    const d = debtors[0]!
    const amount = Math.min(c.amount, d.amount)
    transfers.push({ fromTravellerId: d.id, toTravellerId: c.id, amount })
    c.amount -= amount
    d.amount -= amount
    if (c.amount === 0) creditors.shift()
    if (d.amount === 0) debtors.shift()
  }
  return transfers
}
