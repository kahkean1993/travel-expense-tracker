import { describe, expect, it } from 'vitest'
import { categoryBudgetRows, cumulativeSeries, dailySeries, paceInfo } from './stats'
import type { Category, Expense, Trip } from '../../types/domain'

const trip = (startDate: string, endDate: string) => ({ startDate, endDate }) as Trip
const baseTrip = trip('2026-03-01', '2026-03-05')
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

describe('paceInfo', () => {
  const t = { startDate: '2026-03-01', endDate: '2026-03-10', budgetMinorUnits: 100000 } as Trip

  it('has no pace without a budget', () => {
    expect(paceInfo({ ...t, budgetMinorUnits: 0 }, [], '2026-03-05')).toBeNull()
  })

  it('compares spending with an even spread of the budget', () => {
    // Day 5 of 10: an even spread would be 50,000 by now.
    const p = paceInfo(t, [spend('2026-03-02', 30000), spend('2026-03-04', 40000)], '2026-03-05')!
    expect(p).toMatchObject({ state: 'during', totalDays: 10, daysElapsed: 5, daysLeft: 6, expectedByToday: 50000, spentToDate: 70000, aheadBy: 20000, remaining: 30000 })
    expect(p.safePerDay).toBe(5000) // 30,000 left over the 6 days left, counting today
  })

  it('reports being under pace and before/after the trip', () => {
    expect(paceInfo(t, [spend('2026-03-01', 1000)], '2026-03-05')!.aheadBy).toBe(1000 - 50000)
    const before = paceInfo(t, [], '2026-02-20')!
    expect(before).toMatchObject({ state: 'before', daysElapsed: 0, daysLeft: 0, expectedByToday: 0, safePerDay: null })
    const after = paceInfo(t, [spend('2026-03-03', 120000)], '2026-03-20')!
    expect(after).toMatchObject({ state: 'after', daysElapsed: 10, daysLeft: 0, remaining: -20000, safePerDay: null })
  })

  it('has no safe amount once the budget is used up', () => {
    expect(paceInfo(t, [spend('2026-03-02', 100000)], '2026-03-05')!.safePerDay).toBeNull()
  })

  it('does not overflow with very large budgets', () => {
    const big = { ...t, budgetMinorUnits: 900_000_000_000_000 } as Trip
    expect(paceInfo(big, [], '2026-03-05')!.expectedByToday).toBe(450_000_000_000_000)
  })
})

describe('cumulativeSeries', () => {
  const t = { startDate: '2026-03-01', endDate: '2026-03-04', budgetMinorUnits: 4000 } as Trip

  it('adds up spending by day against the even budget line', () => {
    const pts = cumulativeSeries(t, [spend('2026-03-01', 500), spend('2026-03-03', 700)], '2026-03-03')
    expect(pts.map((p) => [p.date, p.actual, p.plan])).toEqual([
      ['2026-03-01', 500, 1000],
      ['2026-03-02', 500, 2000],
      ['2026-03-03', 1200, 3000],
      ['2026-03-04', null, 4000],
    ])
  })
})

describe('categoryBudgetRows', () => {
  it('compares spending with each category budget, fullest first', () => {
    const trip = { ...baseTrip, categoryBudgets: { food: 10000, transport: 5000, gone: 0 } } as Trip
    const e = (categoryId: string, amount: number) => ({ categoryId, baseAmountMinorUnits: amount }) as Expense
    const rows = categoryBudgetRows(trip, [e('food', 8500), e('transport', 6000), e('other', 99999)], [
      { id: 'food', name: 'Food' },
      { id: 'transport', name: 'Transport' },
    ] as Category[])
    expect(rows.map((r) => [r.name, r.percent, r.level])).toEqual([
      ['Transport', 120, 'over'],
      ['Food', 85, 'warning'],
    ])
  })
})
