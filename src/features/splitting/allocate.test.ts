import { describe, expect, it } from 'vitest'
import {
  allocateByWeights,
  allocateEqual,
  computeAllocation,
  computeBalances,
  suggestSettlements,
  type BalanceRow,
} from './allocate'

const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0)

describe('allocateEqual', () => {
  it('splits evenly', () => {
    expect(allocateEqual(900, ['a', 'b', 'c']).map((x) => x.amount)).toEqual([300, 300, 300])
  })

  it('distributes remainders deterministically and exactly', () => {
    expect(allocateEqual(1000, ['a', 'b', 'c']).map((x) => x.amount)).toEqual([334, 333, 333])
    expect(allocateEqual(1001, ['a', 'b', 'c']).map((x) => x.amount)).toEqual([334, 334, 333])
    expect(allocateEqual(1, ['a', 'b']).map((x) => x.amount)).toEqual([1, 0])
    for (let total = 0; total < 500; total += 7) {
      for (let n = 1; n <= 7; n++) {
        const ids = Array.from({ length: n }, (_, i) => `t${i}`)
        const result = allocateEqual(total, ids)
        expect(sum(result)).toBe(total)
        const amounts = result.map((r) => r.amount)
        expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('allocateByWeights', () => {
  it('splits in proportion to weights', () => {
    expect(
      allocateByWeights(1000, [
        { travellerId: 'a', weight: 2 },
        { travellerId: 'b', weight: 1 },
        { travellerId: 'c', weight: 1 },
      ]).map((x) => x.amount),
    ).toEqual([500, 250, 250])
  })

  it('always adds up to the total', () => {
    const r = allocateByWeights(1001, [
      { travellerId: 'a', weight: 3 },
      { travellerId: 'b', weight: 3 },
      { travellerId: 'c', weight: 1 },
    ])
    expect(sum(r)).toBe(1001)
    expect(r.map((x) => x.amount)).toEqual([429, 429, 143])
  })

  it('rejects invalid weights', () => {
    expect(() => allocateByWeights(100, [{ travellerId: 'a', weight: 0 }])).toThrow()
    expect(() => allocateByWeights(100, [{ travellerId: 'a', weight: 1.5 }])).toThrow()
    expect(() => allocateByWeights(100, [])).toThrow()
  })
})

describe('computeAllocation', () => {
  it('assigns a personal expense to the selected traveller only', () => {
    expect(computeAllocation({ mode: 'personal', total: 4500, participantIds: ['b'] })).toEqual({
      ok: true,
      value: [{ travellerId: 'b', amount: 4500 }],
    })
  })

  it('accepts custom amounts that match exactly', () => {
    const r = computeAllocation({
      mode: 'custom_amount',
      total: 1000,
      participantIds: ['a', 'b'],
      customAmounts: { a: 700, b: 300 },
    })
    expect(r.ok).toBe(true)
  })

  it('rejects custom amounts that do not match the total', () => {
    const under = computeAllocation({
      mode: 'custom_amount',
      total: 1000,
      participantIds: ['a', 'b'],
      customAmounts: { a: 700, b: 299 },
    })
    expect(under).toEqual({ ok: false, error: 'Shares add up to less than the total.' })
    const over = computeAllocation({
      mode: 'custom_amount',
      total: 1000,
      participantIds: ['a', 'b'],
      customAmounts: { a: 700, b: 301 },
    })
    expect(over.ok).toBe(false)
  })

  it('requires participants', () => {
    expect(computeAllocation({ mode: 'equal', total: 100, participantIds: [] }).ok).toBe(false)
  })

  it('validates weights', () => {
    expect(
      computeAllocation({ mode: 'custom_weight', total: 100, participantIds: ['a'], weights: { a: 0 } }).ok,
    ).toBe(false)
  })
})

describe('balances and settlements', () => {
  const travellers = ['me', 'ali', 'bea']

  it("includes the payer's payment and their own share", () => {
    // Me pays 90.00 split equally among three.
    const rows = computeBalances(
      travellers,
      [{ payerTravellerId: 'me', baseAmountMinorUnits: 9000 }],
      allocateEqual(9000, travellers).map((a) => ({
        travellerId: a.travellerId,
        allocatedBaseAmountMinorUnits: a.amount,
      })),
    )
    expect(rows).toEqual([
      { travellerId: 'me', paid: 9000, share: 3000, net: 6000 },
      { travellerId: 'ali', paid: 0, share: 3000, net: -3000 },
      { travellerId: 'bea', paid: 0, share: 3000, net: -3000 },
    ])
  })

  it('net balances sum to zero and transfers settle every balance', () => {
    // Pseudo-random scenario generator with a fixed seed.
    let seed = 42
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
    for (let round = 0; round < 200; round++) {
      const people = travellers.concat(['dan', 'eve']).slice(0, 2 + Math.floor(rand() * 4))
      const expenses: { payerTravellerId: string; baseAmountMinorUnits: number }[] = []
      const shares: { travellerId: string; allocatedBaseAmountMinorUnits: number }[] = []
      const n = 1 + Math.floor(rand() * 12)
      for (let i = 0; i < n; i++) {
        const total = 1 + Math.floor(rand() * 100000)
        const payer = people[Math.floor(rand() * people.length)]!
        const participants = people.filter(() => rand() > 0.3)
        if (participants.length === 0) participants.push(payer)
        expenses.push({ payerTravellerId: payer, baseAmountMinorUnits: total })
        const alloc = allocateEqual(total, participants)
        expect(sum(alloc)).toBe(total)
        alloc.forEach((a) => shares.push({ travellerId: a.travellerId, allocatedBaseAmountMinorUnits: a.amount }))
      }
      const balances = computeBalances(people, expenses, shares)
      expect(balances.reduce((s, b) => s + b.net, 0)).toBe(0)

      const transfers = suggestSettlements(balances)
      expect(transfers.length).toBeLessThanOrEqual(Math.max(0, people.length - 1))
      const after = new Map(balances.map((b) => [b.travellerId, b.net]))
      for (const t of transfers) {
        expect(t.amount).toBeGreaterThan(0)
        expect(t.fromTravellerId).not.toBe(t.toTravellerId)
        after.set(t.fromTravellerId, after.get(t.fromTravellerId)! + t.amount)
        after.set(t.toTravellerId, after.get(t.toTravellerId)! - t.amount)
      }
      for (const v of after.values()) expect(v).toBe(0)
    }
  })

  it('suggests no transfers when everyone is settled', () => {
    const rows: BalanceRow[] = [
      { travellerId: 'a', paid: 100, share: 100, net: 0 },
      { travellerId: 'b', paid: 0, share: 0, net: 0 },
    ]
    expect(suggestSettlements(rows)).toEqual([])
  })

  it('minimises transfers for a simple case', () => {
    const rows: BalanceRow[] = [
      { travellerId: 'a', paid: 0, share: 0, net: 6000 },
      { travellerId: 'b', paid: 0, share: 0, net: -3000 },
      { travellerId: 'c', paid: 0, share: 0, net: -3000 },
    ]
    expect(suggestSettlements(rows)).toEqual([
      { fromTravellerId: 'b', toTravellerId: 'a', amount: 3000 },
      { fromTravellerId: 'c', toTravellerId: 'a', amount: 3000 },
    ])
  })
})
