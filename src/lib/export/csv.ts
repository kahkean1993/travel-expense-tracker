/**
 * CSV export compatible with Microsoft Excel: UTF-8 with BOM, CRLF line
 * endings, RFC 4180 quoting. Amount columns are plain decimals so Excel
 * treats them as numbers.
 */
import type { Category, Expense, ExpenseShare, Traveller, Trip } from '../../types/domain'
import { PAYMENT_METHOD_LABELS } from '../../types/domain'
import { currencyFractionDigits, minorToDecimalString } from '../money/money'
import { SPLIT_MODE_LABELS } from '../../features/expenses/labels'

/** Quotes a field when needed and neutralises spreadsheet formula injection. */
export function escapeCsvField(value: string | number): string {
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\r\n]/.test(text) || /^\s|\s$/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv(rows: (string | number)[][]): string {
  return '﻿' + rows.map((r) => r.map(escapeCsvField).join(',')).join('\r\n') + '\r\n'
}

export function buildExpensesCsv(
  trip: Trip,
  expenses: Expense[],
  shares: ExpenseShare[],
  categories: Category[],
  travellers: Traveller[],
): string {
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const travellerName = new Map(travellers.map((t) => [t.id, t.displayName]))
  const sharesByExpense = new Map<string, ExpenseShare[]>()
  for (const s of shares) {
    const list = sharesByExpense.get(s.expenseId) ?? []
    list.push(s)
    sharesByExpense.set(s.expenseId, list)
  }
  const baseDigits = currencyFractionDigits(trip.baseCurrency)
  const header = [
    'Date',
    'Description',
    'Category',
    'Original amount',
    'Original currency',
    'Exchange rate (1 original = x base)',
    `Amount (${trip.baseCurrency})`,
    'Base currency',
    'Payment method',
    'Payment account note',
    'Paid by',
    'Split type',
    'Split details',
    'Notes',
  ]
  const rows = [...expenses]
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
    .map((e) => [
      e.date,
      e.description,
      catName.get(e.categoryId) ?? 'Unknown',
      minorToDecimalString(e.originalAmountMinorUnits, currencyFractionDigits(e.originalCurrency)),
      e.originalCurrency,
      e.exchangeRate,
      minorToDecimalString(e.baseAmountMinorUnits, baseDigits),
      e.baseCurrency,
      PAYMENT_METHOD_LABELS[e.paymentMethod],
      e.paymentAccountNote,
      travellerName.get(e.payerTravellerId) ?? e.payerNameSnapshot,
      SPLIT_MODE_LABELS[e.splitMode],
      (sharesByExpense.get(e.id) ?? [])
        .map(
          (s) =>
            `${travellerName.get(s.travellerId) ?? s.travellerNameSnapshot}: ${minorToDecimalString(s.allocatedBaseAmountMinorUnits, baseDigits)}`,
        )
        .join('; '),
      e.notes,
    ])
  return toCsv([header, ...rows])
}

/** "My Japan Trip!" → "my-japan-trip" */
export function slugify(text: string): string {
  return (
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'trip'
  )
}

export function todayStamp(d = new Date()): string {
  return localDateString(d)
}

/** Local calendar date as YYYY-MM-DD. */
export function localDateString(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Triggers a browser download of text content. */
export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
