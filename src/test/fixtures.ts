/** Synthetic test data only — no real personal information. */
import { tripsRepo, travellersRepo, expensesRepo, type TripInput } from '../db/repositories'
import { evaluateExpenseForm, emptyExpenseForm, type ExpenseFormValues } from '../features/expenses/expenseDraft'
import type { Trip } from '../types/domain'

export const tripInput = (over: Partial<TripInput> = {}): TripInput => ({
  name: 'Test Trip',
  destination: 'Testville',
  startDate: '2026-03-01',
  endDate: '2026-03-07',
  baseCurrency: 'MYR',
  budgetMinorUnits: 100000,
  ...over,
})

export async function makeTrip(names = ['Me', 'Alex', 'Sam'], over: Partial<TripInput> = {}) {
  const trip = await tripsRepo.create(tripInput(over), names)
  const travellers = await travellersRepo.listByTrip(trip.id)
  return { trip, travellers }
}

export async function addExpense(
  trip: Trip,
  travellers: Awaited<ReturnType<typeof travellersRepo.listByTrip>>,
  over: Partial<ExpenseFormValues>,
) {
  const values = { ...emptyExpenseForm(trip, travellers, '2026-03-02'), description: 'Item', categoryId: 'cat-food', ...over }
  const ev = evaluateExpenseForm(values, trip, travellers)
  if (!ev.result) throw new Error(JSON.stringify(ev.errors))
  return expensesRepo.save(undefined, ev.result.record, ev.result.shares)
}
