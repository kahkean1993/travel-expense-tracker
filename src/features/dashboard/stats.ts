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

export interface DayBar {
  date: ISODate
  amount: number
  isToday: boolean
  isFuture: boolean
}

const addDays = (date: ISODate, days: number): ISODate => new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10)

/**
 * One bar per trip day for the daily chart. Long trips show only the last
 * `maxDays` days up to today (or the first `maxDays` if the trip hasn't
 * started). Expenses dated outside the trip's own days are still shown.
 */
export function dailySeries(trip: Trip, expenses: Expense[], today: ISODate, maxDays = 14): DayBar[] {
  const dates = expenses.map((e) => e.date)
  const first = [trip.startDate, ...dates].reduce((a, b) => (b < a ? b : a))
  const last = [trip.endDate, ...dates].reduce((a, b) => (b > a ? b : a))
  let start = first
  let end = last
  if (daysBetweenInclusive(first, last) > maxDays) {
    if (today < first) end = addDays(first, maxDays - 1)
    else {
      end = today < last ? today : last
      start = addDays(end, -(maxDays - 1))
      if (start < first) {
        start = first
        end = addDays(first, maxDays - 1)
      }
    }
  }
  const totals = new Map<ISODate, number>()
  for (const e of expenses) totals.set(e.date, (totals.get(e.date) ?? 0) + e.baseAmountMinorUnits)
  const bars: DayBar[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) {
    bars.push({ date: d, amount: totals.get(d) ?? 0, isToday: d === today, isFuture: d > today })
  }
  return bars
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

// ---------- Budget pace ----------

export interface PaceInfo {
  totalDays: number
  /** Trip days that have passed, counting today. 0 before the trip, all days after it. */
  daysElapsed: number
  /** Days still to go, counting today. 0 before the trip starts and after it ends. */
  daysLeft: number
  state: 'before' | 'during' | 'after'
  /** What an even spread of the budget would have been spent by today. */
  expectedByToday: number
  /** Spent on days up to and including today. */
  spentToDate: number
  /** spentToDate − expectedByToday. Positive: spending faster than the budget allows. */
  aheadBy: number
  /** Budget left per remaining day (counting today), or null when it doesn't apply. */
  safePerDay: number | null
  remaining: number
}

/** Pace against the budget, or null when the trip has no budget. */
export function paceInfo(trip: Trip, expenses: Expense[], today: ISODate): PaceInfo | null {
  if (trip.budgetMinorUnits <= 0) return null
  const totalDays = Math.max(1, daysBetweenInclusive(trip.startDate, trip.endDate))
  const state = today < trip.startDate ? 'before' : today > trip.endDate ? 'after' : 'during'
  const daysElapsed = state === 'before' ? 0 : state === 'after' ? totalDays : daysBetweenInclusive(trip.startDate, today)
  const daysLeft = state === 'during' ? totalDays - daysElapsed + 1 : 0
  const budget = BigInt(trip.budgetMinorUnits)
  const expectedByToday = Number((budget * BigInt(daysElapsed) * 2n + BigInt(totalDays)) / (BigInt(totalDays) * 2n))
  const spentToDate = sumMinor(expenses.filter((e) => e.date <= today).map((e) => e.baseAmountMinorUnits))
  const remaining = trip.budgetMinorUnits - sumMinor(expenses.map((e) => e.baseAmountMinorUnits))
  return {
    totalDays,
    daysElapsed,
    daysLeft,
    state,
    expectedByToday,
    spentToDate,
    aheadBy: spentToDate - expectedByToday,
    safePerDay: daysLeft > 0 && remaining > 0 ? Math.floor(remaining / daysLeft) : null,
    remaining,
  }
}

export interface PacePoint {
  date: ISODate
  /** Running total spent by the end of this day, or null for days that haven't happened yet. */
  actual: number | null
  /** Where an even spread of the budget would be at the end of this day. */
  plan: number
}

/** Cumulative spending against an even budget line, one point per day. */
export function cumulativeSeries(trip: Trip, expenses: Expense[], today: ISODate): PacePoint[] {
  const dates = expenses.map((e) => e.date)
  const first = [trip.startDate, ...dates].reduce((a, b) => (b < a ? b : a))
  const last = [trip.endDate, ...dates].reduce((a, b) => (b > a ? b : a))
  const totalDays = Math.max(1, daysBetweenInclusive(trip.startDate, trip.endDate))
  const perDay = new Map<ISODate, number>()
  for (const e of expenses) perDay.set(e.date, (perDay.get(e.date) ?? 0) + e.baseAmountMinorUnits)
  const points: PacePoint[] = []
  let running = 0
  for (let d = first; d <= last; d = addDays(d, 1)) {
    running += perDay.get(d) ?? 0
    const dayNumber = Math.min(totalDays, Math.max(0, daysBetweenInclusive(trip.startDate, d)))
    const plan = Number((BigInt(trip.budgetMinorUnits) * BigInt(dayNumber) * 2n + BigInt(totalDays)) / (BigInt(totalDays) * 2n))
    points.push({ date: d, actual: d <= today ? running : null, plan })
  }
  return points
}

export interface CategoryBudgetRow {
  id: ID
  name: string
  budget: number
  spent: number
  percent: number
  level: 'ok' | 'warning' | 'over'
}

/** Spending against each category that has its own budget, fullest first. */
export function categoryBudgetRows(trip: Trip, expenses: Expense[], categories: Category[]): CategoryBudgetRow[] {
  const budgets = trip.categoryBudgets ?? {}
  const spentBy = new Map<ID, number>()
  for (const e of expenses) spentBy.set(e.categoryId, (spentBy.get(e.categoryId) ?? 0) + e.baseAmountMinorUnits)
  const names = new Map(categories.map((c) => [c.id, c.name]))
  const rows: CategoryBudgetRow[] = []
  for (const [id, budget] of Object.entries(budgets)) {
    if (!(budget > 0)) continue
    const spent = spentBy.get(id) ?? 0
    const percent = percentUsed(spent, budget) ?? 0
    rows.push({ id, name: names.get(id) ?? 'Removed category', budget, spent, percent, level: percent >= 100 ? 'over' : percent >= 80 ? 'warning' : 'ok' })
  }
  return rows.sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name))
}
