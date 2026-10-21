import { describe, expect, it } from 'vitest'
import { emptyExpenseForm, evaluateExpenseForm } from './expenseDraft'
import type { Traveller, Trip } from '../../types/domain'

const trip = { id: 't', baseCurrency: 'MYR' } as Trip
const travellers = ['Me', 'Alex', 'Sam'].map((n, i) => ({ id: `p${i}`, tripId: 't', displayName: n })) as Traveller[]
const base = { ...emptyExpenseForm(trip, travellers, '2026-03-02'), description: 'Taxi', categoryId: 'cat-transport' }

describe('evaluateExpenseForm', () => {
  it('same-currency expense uses rate 1 even if a rate was typed', () => {
    const ev = evaluateExpenseForm({ ...base, amount: '10.00', rate: '4.5' }, trip, travellers)
    expect(ev.result?.record.exchangeRate).toBe('1')
    expect(ev.result?.record.baseAmountMinorUnits).toBe(1000)
  })

  it('converts foreign currency and splits equally with exact total', () => {
    const ev = evaluateExpenseForm({ ...base, amount: '1000', currency: 'jpy', rate: '0.0312' }, trip, travellers)
    expect(ev.result?.record.originalCurrency).toBe('JPY')
    expect(ev.baseAmount).toBe(3120)
    expect(ev.result?.shares.map((s) => s.allocatedBaseAmountMinorUnits)).toEqual([1040, 1040, 1040])
  })

  it('reports field errors next to fields', () => {
    const ev = evaluateExpenseForm(
      { ...base, amount: '-1', description: '', categoryId: '', currency: 'XX', paymentAccountNote: '4111 1111 1111 1111' },
      trip,
      travellers,
    )
    expect(ev.result).toBeNull()
    expect(Object.keys(ev.errors).sort()).toEqual(['categoryId', 'currency', 'description', 'paymentAccountNote'])
    expect(evaluateExpenseForm({ ...base, amount: '-1' }, trip, travellers).errors.amount).toMatch(/negative/)
    expect(evaluateExpenseForm({ ...base, amount: '5', currency: 'JPY', rate: '' }, trip, travellers).errors.rate).toBeTruthy()
  })

  it('personal expense goes to the selected person only', () => {
    const ev = evaluateExpenseForm({ ...base, amount: '25', splitMode: 'personal', participantIds: ['p2'] }, trip, travellers)
    expect(ev.result?.shares).toEqual([{ travellerId: 'p2', travellerNameSnapshot: 'Sam', allocatedBaseAmountMinorUnits: 2500 }])
    expect(ev.result?.record.payerTravellerId).toBe('p0')
  })

  it('validates custom amounts against the total', () => {
    const bad = evaluateExpenseForm(
      { ...base, amount: '10', splitMode: 'custom_amount', participantIds: ['p0', 'p1'], customAmounts: { p0: '6', p1: '3.99' } },
      trip,
      travellers,
    )
    expect(bad.errors.split).toMatch(/less than/)
    expect(bad.customSum).toBe(999)
    const good = evaluateExpenseForm(
      { ...base, amount: '10', splitMode: 'custom_amount', participantIds: ['p0', 'p1'], customAmounts: { p0: '6', p1: '4' } },
      trip,
      travellers,
    )
    expect(good.result?.shares.map((s) => s.allocatedBaseAmountMinorUnits)).toEqual([600, 400])
  })

  it('splits by custom weights and stores the weights', () => {
    const ev = evaluateExpenseForm(
      { ...base, amount: '10', splitMode: 'custom_weight', participantIds: ['p0', 'p1'], weights: { p0: '3', p1: '1' } },
      trip,
      travellers,
    )
    expect(ev.result?.shares.map((s) => [s.allocatedBaseAmountMinorUnits, s.weight])).toEqual([
      [750, 3],
      [250, 1],
    ])
  })
})
