import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialValues, lastEntryFromForm, loadLastEntry, saveLastEntry, type LastEntry } from './quickEntry'
import { emptyExpenseForm } from './expenseDraft'
import type { Traveller, Trip } from '../../types/domain'

const trip = { id: 't', baseCurrency: 'MYR' } as Trip
const people = ['Me', 'Alex', 'Sam'].map((n, i) => ({ id: `p${i}`, tripId: 't', displayName: n })) as Traveller[]
const rateFor = (c: string) => (c === 'JPY' ? '0.0305' : null)
const last = (over: Partial<LastEntry> = {}): LastEntry => ({
  currency: 'JPY',
  paymentMethod: 'credit_card',
  payerId: 'p1',
  splitMode: 'equal',
  participantIds: ['p0', 'p1'],
  ...over,
})

// Tests run in plain Node, so give them a tiny in-memory localStorage.
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('initialValues', () => {
  it('starts like the blank form when nothing is remembered', () => {
    const v = initialValues(trip, people, '2026-03-02', null, { rateFor })
    expect(v).toEqual(emptyExpenseForm(trip, people, '2026-03-02'))
  })

  it('carries over currency, rate, payment method, payer and who it was split between', () => {
    const v = initialValues(trip, people, '2026-03-02', last(), { rateFor })
    expect(v).toMatchObject({ currency: 'JPY', rate: '0.0305', paymentMethod: 'credit_card', payerId: 'p1', splitMode: 'equal', participantIds: ['p0', 'p1'] })
    expect(v.amount).toBe('')
    expect(v.description).toBe('')
  })

  it('uses the signed-in person as payer on a shared trip', () => {
    const v = initialValues(trip, people, '2026-03-02', last(), { rateFor, myTravellerId: 'p2' })
    expect(v.payerId).toBe('p2')
    expect(v.participantIds).toEqual(['p0', 'p1'])
  })

  it('drops people who are no longer on the trip and falls back to everyone', () => {
    expect(initialValues(trip, people, 'd', last({ payerId: 'gone', participantIds: ['gone', 'p2'] }), { rateFor })).toMatchObject({ payerId: 'p0', participantIds: ['p2'] })
    expect(initialValues(trip, people, 'd', last({ participantIds: ['gone'] }), { rateFor }).participantIds).toEqual(['p0', 'p1', 'p2'])
  })

  it('remembers a personal expense but not custom amounts', () => {
    expect(initialValues(trip, people, 'd', last({ splitMode: 'personal', participantIds: ['p2'] }), { rateFor })).toMatchObject({ splitMode: 'personal', participantIds: ['p2'] })
    expect(initialValues(trip, people, 'd', last({ splitMode: 'custom_amount' }), { rateFor }).splitMode).toBe('equal')
    expect(initialValues(trip, people, 'd', last({ splitMode: 'custom_weight' }), { rateFor }).splitMode).toBe('custom_weight')
  })

  it('keeps a solo trip personal and ignores an invalid remembered currency', () => {
    const solo = [people[0]!]
    expect(initialValues(trip, solo, 'd', last(), { rateFor })).toMatchObject({ splitMode: 'personal', participantIds: ['p0'] })
    expect(initialValues(trip, people, 'd', last({ currency: 'XX' }), { rateFor }).currency).toBe('MYR')
    expect(initialValues(trip, people, 'd', last({ currency: 'MYR' }), { rateFor })).toMatchObject({ currency: 'MYR', rate: '1' })
  })
})

describe('remembering', () => {
  it('saves and loads per trip, and ignores damaged data', () => {
    const entry = lastEntryFromForm({ ...emptyExpenseForm(trip, people, 'd'), currency: 'jpy', payerId: 'p1' })
    expect(entry.currency).toBe('JPY')
    saveLastEntry('t', entry)
    expect(loadLastEntry('t')).toEqual(entry)
    expect(loadLastEntry('other')).toBeNull()
    localStorage.setItem('tet:lastEntry:t', '{"currency": 5}')
    expect(loadLastEntry('t')).toBeNull()
    localStorage.setItem('tet:lastEntry:t', 'not json')
    expect(loadLastEntry('t')).toBeNull()
  })
})
