import { describe, expect, it } from 'vitest'
import { allocateEqual, computeBalances } from './allocate'
import { statementFor } from './statement'
import type { Expense, ExpenseShare, Settlement } from '../../types/domain'

const names = new Map([['a', 'Alex'], ['b', 'Bea'], ['c', 'Cam']])
const expense = (id: string, payer: string, total: number, date: string, desc = id) =>
  ({ id, payerTravellerId: payer, baseAmountMinorUnits: total, date, description: desc, createdAt: `${date}T00:00:00Z` }) as Expense
const sharesFor = (e: Expense, people: string[]): ExpenseShare[] =>
  allocateEqual(e.baseAmountMinorUnits, people).map((x) => ({ id: `${e.id}-${x.travellerId}`, expenseId: e.id, travellerId: x.travellerId, allocatedBaseAmountMinorUnits: x.amount }) as ExpenseShare)
const payment = (id: string, from: string, to: string, amount: number, paidOn: string) =>
  ({ id, fromTravellerId: from, toTravellerId: to, amountMinorUnits: amount, paidOn, note: '', createdAt: `${paidOn}T12:00:00Z` }) as Settlement

describe('statementFor', () => {
  const dinner = expense('dinner', 'a', 9000, '2026-03-02', 'Dinner')
  const taxi = expense('taxi', 'b', 3000, '2026-03-03', 'Taxi')
  const expenses = [dinner, taxi]
  const shares = [...sharesFor(dinner, ['a', 'b', 'c']), ...sharesFor(taxi, ['b', 'c'])]
  const payments = [payment('p1', 'c', 'a', 2000, '2026-03-04')]

  it('lists what moved each balance, in date order, with who paid', () => {
    const s = statementFor('b', expenses, shares, payments, names)
    expect(s.lines.map((l) => [l.kind, l.title, l.detail, l.paid, l.share, l.effect])).toEqual([
      ['expense', 'Dinner', 'Paid by Alex', 0, 3000, -3000],
      ['expense', 'Taxi', 'Paid by Bea', 3000, 1500, 1500],
    ])
    expect(s.totals).toEqual({ paid: 3000, share: 4500, sent: 0, received: 0, net: -1500 })
  })

  it('shows payments on both sides', () => {
    const cam = statementFor('c', expenses, shares, payments, names)
    expect(cam.lines.at(-1)).toMatchObject({ kind: 'payment', title: 'Paid Alex', sent: 2000, effect: 2000 })
    const alex = statementFor('a', expenses, shares, payments, names)
    expect(alex.lines.at(-1)).toMatchObject({ kind: 'payment', title: 'Received from Cam', received: 2000, effect: -2000 })
  })

  it('skips expenses someone is not part of', () => {
    const personal = expense('solo', 'a', 500, '2026-03-05')
    const s = statementFor('c', [personal], [{ id: 's', expenseId: 'solo', travellerId: 'a', allocatedBaseAmountMinorUnits: 500 } as ExpenseShare], [], names)
    expect(s.lines).toEqual([])
    expect(s.totals.net).toBe(0)
  })

  it('always agrees with the balances shown elsewhere', () => {
    const rows = computeBalances(['a', 'b', 'c'], expenses, shares, payments)
    for (const row of rows) {
      const s = statementFor(row.travellerId, expenses, shares, payments, names)
      expect(s.totals).toEqual({ paid: row.paid, share: row.share, sent: row.sent, received: row.received, net: row.net })
    }
  })
})
