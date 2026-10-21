import { describe, expect, it } from 'vitest'
import { dailySeries } from './stats'
import type { Expense, Trip } from '../../types/domain'

const trip = (startDate: string, endDate: string) => ({ startDate, endDate }) as Trip
const spend = (date: string, baseAmountMinorUnits: number) => ({ date, baseAmountMinorUnits }) as Expense

describe('dailySeries', () => {
  it('has one bar per trip day with totals, today and future flags', () => {
    const bars = dailySeries(trip('2026-03-01', '2026-03-04'), [spend('2026-03-02', 500), spend('2026-03-02', 250)], '2026-03-03')
    expect(bars.map((b) => [b.date, b.amount, b.isToday, b.isFuture])).toEqual([
      ['2026-03-01', 0, false, false],
      ['2026-03-02', 750, false, false],
      ['2026-03-03', 0, true, false],
      ['2026-03-04', 0, false, true],
    ])
  })

  it('shows the last 14 days of a long trip up to today', () => {
    const bars = dailySeries(trip('2026-03-01', '2026-03-31'), [], '2026-03-20')
    expect(bars).toHaveLength(14)
    expect(bars[0]!.date).toBe('2026-03-07')
    expect(bars.at(-1)!.date).toBe('2026-03-20')
  })

  it('shows the first 14 days before a long trip starts, and the end of a finished one', () => {
    expect(dailySeries(trip('2026-03-01', '2026-03-31'), [], '2026-02-01')[0]!.date).toBe('2026-03-01')
    const done = dailySeries(trip('2026-03-01', '2026-03-31'), [], '2026-06-01')
    expect(done.at(-1)!.date).toBe('2026-03-31')
    expect(done).toHaveLength(14)
  })

  it('includes expenses dated outside the planned trip days', () => {
    const bars = dailySeries(trip('2026-03-05', '2026-03-06'), [spend('2026-03-03', 100)], '2026-03-06')
    expect(bars.map((b) => b.date)).toEqual(['2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06'])
    expect(bars[0]!.amount).toBe(100)
  })
})
