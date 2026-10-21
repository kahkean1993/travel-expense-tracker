import { describe, expect, it } from 'vitest'
import { parsePercentToBps, splitItemised, toBaseAmounts } from './itemised'

describe('splitItemised', () => {
  it('shares each item among the people who had it', () => {
    const r = splitItemised(
      [
        { amount: 3000, sharerIds: ['a'] },
        { amount: 2000, sharerIds: ['b'] },
        { amount: 1001, sharerIds: ['a', 'b'] },
      ],
      0,
    )
    expect(r.subtotal).toBe(6001)
    expect(r.total).toBe(6001)
    expect([...r.perPerson]).toEqual([['a', 3501], ['b', 2500]])
  })

  it('adds service charge in proportion and always adds up exactly', () => {
    const r = splitItemised([{ amount: 3000, sharerIds: ['a'] }, { amount: 1000, sharerIds: ['b'] }, { amount: 333, sharerIds: ['a', 'b', 'c'] }], 1050)
    expect(r.extra).toBe(Math.round(4333 * 0.105))
    expect([...r.perPerson.values()].reduce((s, v) => s + v, 0)).toBe(r.total)
  })

  it('ignores empty items and handles a bill with no items', () => {
    expect(splitItemised([{ amount: 0, sharerIds: ['a'] }, { amount: 500, sharerIds: [] }], 1000)).toMatchObject({ total: 0, perPerson: new Map() })
  })
})

describe('parsePercentToBps', () => {
  it('accepts percentages with up to 2 decimals', () => {
    expect(parsePercentToBps('10')).toBe(1000)
    expect(parsePercentToBps('7.5')).toBe(750)
    expect(parsePercentToBps('')).toBe(0)
    expect(parsePercentToBps('101')).toBeNull()
    expect(parsePercentToBps('-1')).toBeNull()
    expect(parsePercentToBps('1.234')).toBeNull()
  })
})

describe('toBaseAmounts', () => {
  it('converts per-person totals to base amounts summing to the base total', () => {
    const m = toBaseAmounts(new Map([['a', 3501], ['b', 2500]]), 1799)
    expect([...m.values()].reduce((s, v) => s + v, 0)).toBe(1799)
  })
})
