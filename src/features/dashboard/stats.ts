/**
 * Trip statistics derived from stored records. All amounts are base-currency
 * minor units; expenses are only aggregated after conversion.
 */
import { percentUsed, sumMinor } from '../../lib/money/money'
import type { Category, Expense, ID, ISODate, Trip } from '../../types/domain'

export interface TripSummary {
  budget: number
  spent: number
  remaining: number
  percentUsed: number | null
  count: number
  /** Days from trip start up to today (or the end date), or null if not started. */
  daysElapsed: number | null
  averagePerDay: number | null
  budgetLevel: 'none' | 'ok' | 'warning' | 'over'
}

const DAY_MS = 86_400_000
export function daysBetweenInclusive(start: ISODate, end: ISODate): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / DAY_MS) + 1
}

export function summariseTrip(trip: Trip, expenses: Expense[], today: ISODate): TripSummary {
  const spent = sumMinor(expenses.map((e) => e.baseAmountMinorUnits))
  const pct = percentUsed(spent, trip.budgetMinorUnits)
  const lastDay = today < trip.endDate ? today : trip.endDate
  const daysElapsed = lastDay >= trip.startDate ? daysBetweenInclusive(trip.startDate, lastDay) : null
  return {
    budget: trip.budgetMinorUnits,
    spent,
    remaining: trip.budgetMinorUnits - spent,
    percentUsed: pct,
    count: expenses.length,
    daysElapsed,
    averagePerDay: daysElapsed && expenses.length ? Math.round(spent / daysElapsed) : null,
    budgetLevel: pct === null ? 'none' : pct >= 100 ? 'over' : pct >= 80 ? 'warning' : 'ok',
  }
}

export interface TotalRow {
  key: string
  label: string
  amount: number
  count: number
}

export function totalsByCategory(expenses: Expense[], categories: Category[]): TotalRow[] {
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const map = new Map<ID, TotalRow>()
  for (const e of expenses) {
    const row = map.get(e.categoryId) ?? { key: e.categoryId, label: names.get(e.categoryId) ?? 'Unknown', amount: 0, count: 0 }
    row.amount += e.baseAmountMinorUnits
    row.count++
    map.set(e.categoryId, row)
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label))
}

export function totalsByDay(expenses: Expense[]): TotalRow[] {
  const map = new Map<string, TotalRow>()
  for (const e of expenses) {
    const row = map.get(e.date) ?? { key: e.date, label: e.date, amount: 0, count: 0 }
    row.amount += e.baseAmountMinorUnits
    row.count++
    map.set(e.date, row)
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export function recentExpenses(expenses: Expense[], limit = 5): Expense[] {
  return [...expenses]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
}

export interface ExpenseFilter {
  search: string
  from: string
  to: string
  categoryId: string
  paymentMethod: string
  payerId: string
  currency: string
}

export const EMPTY_FILTER: ExpenseFilter = {
  search: '',
  from: '',
  to: '',
  categoryId: '',
  paymentMethod: '',
  payerId: '',
  currency: '',
}

export type ExpenseSort = 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'

export function filterExpenses(expenses: Expense[], f: ExpenseFilter): Expense[] {
  const q = f.search.trim().toLowerCase()
  return expenses.filter(
    (e) =>
      (!q || e.description.toLowerCase().includes(q) || e.notes.toLowerCase().includes(q)) &&
      (!f.from || e.date >= f.from) &&
      (!f.to || e.date <= f.to) &&
      (!f.categoryId || e.categoryId === f.categoryId) &&
      (!f.paymentMethod || e.paymentMethod === f.paymentMethod) &&
      (!f.payerId || e.payerTravellerId === f.payerId) &&
      (!f.currency || e.originalCurrency === f.currency),
  )
}

export function sortExpenses(expenses: Expense[], sort: ExpenseSort): Expense[] {
  const list = [...expenses]
  const byDate = (a: Expense, b: Expense) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)
  switch (sort) {
    case 'date_desc':
      return list.sort((a, b) => byDate(b, a))
    case 'date_asc':
      return list.sort(byDate)
    case 'amount_desc':
      return list.sort((a, b) => b.baseAmountMinorUnits - a.baseAmountMinorUnits || byDate(b, a))
    case 'amount_asc':
      return list.sort((a, b) => a.baseAmountMinorUnits - b.baseAmountMinorUnits || byDate(b, a))
  }
}
