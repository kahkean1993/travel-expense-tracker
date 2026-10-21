/** React hooks that re-render automatically when IndexedDB data changes. */
import { useLiveQuery } from 'dexie-react-hooks'
import { categoriesRepo, expensesRepo, settingsRepo, travellersRepo, tripsRepo } from './repositories'
import type { Category, Expense, ExpenseShare, ID, Traveller, Trip } from '../types/domain'

export interface TripData {
  trip: Trip
  travellers: Traveller[]
  expenses: Expense[]
  shares: ExpenseShare[]
  categories: Category[]
}

/** undefined while loading, null if the trip does not exist. */
export function useTripData(tripId: ID): TripData | null | undefined {
  return useLiveQuery(async () => {
    const trip = await tripsRepo.get(tripId)
    if (!trip) return null
    const [travellers, expenses, shares, categories] = await Promise.all([
      travellersRepo.listByTrip(tripId),
      expensesRepo.listByTrip(tripId),
      expensesRepo.sharesByTrip(tripId),
      categoriesRepo.list(tripId),
    ])
    return { trip, travellers, expenses, shares, categories }
  }, [tripId])
}

export function useTrips() {
  return useLiveQuery(async () => {
    const [trips, expenses] = await Promise.all([tripsRepo.list(), expensesRepo.listAll()])
    const spent = new Map<ID, number>()
    const counts = new Map<ID, number>()
    for (const e of expenses) {
      spent.set(e.tripId, (spent.get(e.tripId) ?? 0) + e.baseAmountMinorUnits)
      counts.set(e.tripId, (counts.get(e.tripId) ?? 0) + 1)
    }
    return trips.map((trip) => ({ trip, spent: spent.get(trip.id) ?? 0, count: counts.get(trip.id) ?? 0 }))
  })
}

export function useSettings() {
  return useLiveQuery(() => settingsRepo.get())
}

export function useCategories() {
  return useLiveQuery(() => categoriesRepo.list())
}
