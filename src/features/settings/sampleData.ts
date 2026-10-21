/**
 * Optional demo data, created only when the user presses "Load sample data".
 * Names and amounts are fictional. Totals are calculated by the normal
 * conversion and split code, never hard-coded.
 */
import { db } from '../../db/schema'
import { expensesRepo, travellersRepo, tripsRepo } from '../../db/repositories'
import { trackSave } from '../../db/saveStatus'
import { localDateString } from '../../lib/export/csv'
import { emptyExpenseForm, evaluateExpenseForm, type ExpenseFormValues } from '../expenses/expenseDraft'

function shiftDays(base: Date, days: number) {
  const d = new Date(base)
  d.setDate(d.getDate() + days)
  return localDateString(d)
}

export async function loadSampleData() {
  const today = new Date()
  const trip = await tripsRepo.create(
    {
      name: 'Sample: Tokyo & Kyoto',
      destination: 'Japan',
      startDate: shiftDays(today, -3),
      endDate: shiftDays(today, 4),
      baseCurrency: 'MYR',
      budgetMinorUnits: 800000,
    },
    ['Me', 'Alex', 'Sam'],
    { isSample: true },
  )
  const travellers = await travellersRepo.listByTrip(trip.id)
  const [me, alex, sam] = travellers.map((t) => t.id) as [string, string, string]
  const base = emptyExpenseForm(trip, travellers, localDateString(today))
  const items: Partial<ExpenseFormValues>[] = [
    { amount: '2850', currency: 'MYR', description: 'Return flights KUL–HND', categoryId: 'cat-transport', paymentMethod: 'credit_card', paymentAccountNote: 'Travel card', date: shiftDays(today, -10) },
    { amount: '120', currency: 'MYR', description: 'Travel insurance', categoryId: 'cat-insurance', paymentMethod: 'debit_card', date: shiftDays(today, -8) },
    { amount: '42000', currency: 'JPY', rate: '0.0305', description: 'Hotel in Shinjuku (2 nights)', categoryId: 'cat-accommodation', paymentMethod: 'credit_card', payerId: alex, date: shiftDays(today, -3) },
    { amount: '3600', currency: 'JPY', rate: '0.0305', description: 'Ramen dinner', categoryId: 'cat-food', paymentMethod: 'cash', date: shiftDays(today, -3) },
    { amount: '1980', currency: 'JPY', rate: '0.0305', description: 'eSIM 10 GB', categoryId: 'cat-sim', paymentMethod: 'ewallet', splitMode: 'personal', participantIds: [me], date: shiftDays(today, -3) },
    { amount: '40500', currency: 'JPY', rate: '0.0305', description: 'Shinkansen to Kyoto', categoryId: 'cat-transport', paymentMethod: 'credit_card', payerId: sam, date: shiftDays(today, -1) },
    { amount: '6400', currency: 'JPY', rate: '0.0305', description: 'Temple entry & tea ceremony', categoryId: 'cat-activities', paymentMethod: 'cash', payerId: alex, splitMode: 'custom_weight', participantIds: [me, alex, sam], weights: { [me]: '1', [alex]: '2', [sam]: '1' }, date: shiftDays(today, -1) },
    { amount: '5200', currency: 'JPY', rate: '0.0305', description: 'Souvenirs', categoryId: 'cat-shopping', paymentMethod: 'cash', splitMode: 'personal', participantIds: [me], notes: 'Gifts for family', date: shiftDays(today, 0) },
  ]
  for (const item of items) {
    const ev = evaluateExpenseForm({ ...base, ...item }, trip, travellers)
    if (!ev.result) throw new Error('Sample data is invalid: ' + JSON.stringify(ev.errors))
    await expensesRepo.save(undefined, ev.result.record, ev.result.shares)
  }
  return trip
}

export async function sampleTripIds(): Promise<string[]> {
  return (await db.trips.toArray()).filter((t) => t.isSample).map((t) => t.id)
}

export function removeSampleData() {
  return trackSave(async () => {
    for (const id of await sampleTripIds()) await tripsRepo.delete(id)
  })
}
