/**
 * Repeating an expense over consecutive days (hotel nights, a daily pass).
 * - "split": the total is divided across the days.
 * - "each": every day gets the full amount.
 * Whole minor units only: with "split", the first days take any leftover unit.
 */
import type { ISODate } from '../../types/domain'

export type RepeatMode = 'split' | 'each'

export function addDaysIso(date: ISODate, days: number): ISODate {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y!, m! - 1, d! + days))
  return t.toISOString().slice(0, 10)
}

export function repeatPlan(startDate: ISODate, totalMinor: number, days: number, mode: RepeatMode): { date: ISODate; amount: number }[] {
  if (!Number.isInteger(days) || days < 1) throw new RangeError('At least one day')
  const base = mode === 'each' ? totalMinor : Math.floor(totalMinor / days)
  const leftover = mode === 'each' ? 0 : totalMinor - base * days
  return Array.from({ length: days }, (_, i) => ({ date: addDaysIso(startDate, i), amount: base + (i < leftover ? 1 : 0) }))
}

/** "Hotel (day 2 of 3)", shortened so the whole text stays within the 200-character limit. */
export function repeatDescription(description: string, day: number, days: number, max = 200): string {
  const suffix = ` (day ${day} of ${days})`
  return description.trim().slice(0, max - suffix.length).trimEnd() + suffix
}
