import { describe, expect, it } from 'vitest'
import { addDaysIso, repeatPlan } from './repeat'

describe('repeatPlan', () => {
  it('splits a total across days, leftover units to the first days', () => {
    const plan = repeatPlan('2026-03-30', 1000, 3, 'split')
    expect(plan).toEqual([
      { date: '2026-03-30', amount: 334 },
      { date: '2026-03-31', amount: 333 },
      { date: '2026-04-01', amount: 333 },
    ])
    expect(plan.reduce((s, p) => s + p.amount, 0)).toBe(1000)
  })
  it('gives each day the full amount', () => {
    expect(repeatPlan('2026-03-01', 450, 2, 'each').map((p) => p.amount)).toEqual([450, 450])
  })
  it('rolls over months and leap days', () => {
    expect(addDaysIso('2028-02-28', 2)).toBe('2028-03-01')
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01')
  })
  it('rejects zero days', () => {
    expect(() => repeatPlan('2026-03-01', 100, 0, 'split')).toThrow()
  })
})
