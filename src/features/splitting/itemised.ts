/**
 * Splitting a bill by item: each item is shared equally by the people who had
 * it, an optional service charge / tax percentage is added in proportion to
 * what each person had, and the result is a total per person that adds up
 * exactly to the bill. Amounts are integer minor units of the bill's currency.
 */
import type { ID } from '../../types/domain'
import { allocateByWeights, allocateEqual } from './allocate'

export interface BillItem {
  amount: number
  sharerIds: ID[]
}

export interface ItemisedResult {
  /** Items only, before any extra charge. */
  subtotal: number
  extra: number
  total: number
  /** What each person owes, extra charge included. Only people with something to pay. */
  perPerson: Map<ID, number>
}

/** "10" or "7.5" → basis points (1000, 750). Null when it isn't a percentage with up to 2 decimals. */
export function parsePercentToBps(text: string): number | null {
  const t = text.trim()
  if (t === '') return 0
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(t)
  if (!m) return null
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0')
  return bps <= 10000 ? bps : null
}

export function splitItemised(items: BillItem[], extraBps: number): ItemisedResult {
  const sub = new Map<ID, number>()
  let subtotal = 0
  for (const item of items) {
    if (item.amount <= 0 || item.sharerIds.length === 0) continue
    subtotal += item.amount
    for (const a of allocateEqual(item.amount, item.sharerIds)) sub.set(a.travellerId, (sub.get(a.travellerId) ?? 0) + a.amount)
  }
  const extra = Number((BigInt(subtotal) * BigInt(extraBps) * 2n + 10000n) / 20000n)
  const people = [...sub.entries()].filter(([, v]) => v > 0)
  const perPerson = new Map<ID, number>(people)
  if (extra > 0 && people.length > 0) {
    const shares = allocateByWeights(extra, people.map(([travellerId, weight]) => ({ travellerId, weight })))
    for (const s of shares) perPerson.set(s.travellerId, (perPerson.get(s.travellerId) ?? 0) + s.amount)
  }
  return { subtotal, extra, total: subtotal + extra, perPerson }
}

/** Turns per-person totals into base-currency amounts that add up exactly to `baseTotal`. */
export function toBaseAmounts(perPerson: Map<ID, number>, baseTotal: number): Map<ID, number> {
  const people = [...perPerson.entries()].filter(([, v]) => v > 0).map(([travellerId, weight]) => ({ travellerId, weight }))
  if (people.length === 0) return new Map()
  return new Map(allocateByWeights(baseTotal, people).map((a) => [a.travellerId, a.amount]))
}
