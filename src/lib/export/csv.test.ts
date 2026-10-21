import { describe, expect, it } from 'vitest'
import { buildExpensesCsv, escapeCsvField, slugify, toCsv } from './csv'
import type { Expense, ExpenseShare, Traveller, Trip } from '../../types/domain'

describe('CSV', () => {
  it('escapes commas, quotes and newlines', () => {
    expect(escapeCsvField('plain')).toBe('plain')
    expect(escapeCsvField('a,b')).toBe('"a,b"')
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""')
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"')
    expect(escapeCsvField('line1\r\nline2')).toBe('"line1\r\nline2"')
    expect(escapeCsvField(12)).toBe('12')
  })

  it('neutralises spreadsheet formulas', () => {
    expect(escapeCsvField('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(escapeCsvField('@cmd')).toBe("'@cmd")
  })

  it('writes a BOM, header and CRLF rows', () => {
    expect(toCsv([['a', 'b'], ['1', 'x,y']])).toBe('﻿a,b\r\n1,"x,y"\r\n')
  })

  it('builds an expense export', () => {
    const trip = { id: 't', name: 'T', baseCurrency: 'MYR' } as Trip
    const travellers = [{ id: 'p', displayName: 'Me' }, { id: 'q', displayName: 'Alex' }] as Traveller[]
    const expense = {
      id: 'e', tripId: 't', date: '2026-03-02', description: 'Dinner, "nice"', categoryId: 'cat-food',
      originalAmountMinorUnits: 1500, originalCurrency: 'JPY', exchangeRate: '0.0312', baseAmountMinorUnits: 4680,
      baseCurrency: 'MYR', paymentMethod: 'cash', paymentAccountNote: '', payerTravellerId: 'p', payerNameSnapshot: 'Me',
      notes: 'two\nlines', splitMode: 'equal', createdAt: '', updatedAt: '',
    } as Expense
    const shares = [
      { expenseId: 'e', travellerId: 'p', allocatedBaseAmountMinorUnits: 2340 },
      { expenseId: 'e', travellerId: 'q', allocatedBaseAmountMinorUnits: 2340 },
    ] as ExpenseShare[]
    const csv = buildExpensesCsv(trip, [expense], shares, [{ id: 'cat-food', name: 'Food & Drinks', tripId: null, isCustom: false, createdAt: '' }], travellers)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toMatch(/^Date,Description,Category/)
    expect(lines[1]).toBe(
      '2026-03-02,"Dinner, ""nice""",Food & Drinks,1500,JPY,0.0312,46.80,MYR,Cash,,Me,Split equally,Me: 23.40; Alex: 23.40,"two\nlines"',
    )
  })

  it('slugifies file names', () => {
    expect(slugify('My Japan Trip!')).toBe('my-japan-trip')
    expect(slugify('Café 2026')).toBe('cafe-2026')
    expect(slugify('***')).toBe('trip')
  })
})
