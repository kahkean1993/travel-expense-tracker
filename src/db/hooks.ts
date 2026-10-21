/** React hooks that re-render automatically when IndexedDB data changes. */
import { useLiveQuery } from 'dexie-react-hooks'
import { categoriesRepo, expensesRepo, settingsRepo, settlementsRepo, travellersRepo, tripsRepo } from './repositories'
import type { Category, Expense, ExpenseShare, ID, Settlement, Traveller, Trip } from '../types/domain'

export interface TripData {
  trip: Trip
  travellers: Traveller[]
  expenses: Expense[]
  shares: ExpenseShare[]
  settlements: Settlement[]
  categories: Category[]
}

/** undefined while loading, null if the trip does not exist. */
export function useTripData(tripId: ID): TripData | null | undefined {
  return useLiveQuery(async () => {
    const trip = await tripsRepo.get(tripId)
    if (!trip) return null
    const [travellers, expenses, shares, settlements, categories] = await Promise.all([
      travellersRepo.listByTrip(tripId),
      expensesRepo.listByTrip(tripId),
      expensesRepo.sharesByTrip(tripId),
      settlementsRepo.listByTrip(tripId),
      categoriesRepo.list(tripId),
    ])
    return { trip, travellers, expenses, shares, settlements, categories }
  }, [tripId])
}

export function useTrips() {
  return useLiveQuery(async () => {
    const [trips, expenses, travellers] = await Promise.all([tripsRepo.list(), expensesRepo.listAll(), travellersRepo.listAll()])
    const names = new Map<ID, string[]>()
    for (const t of [...travellers].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
      names.set(t.tripId, [...(names.get(t.tripId) ?? []), t.displayName])
    }
    const spent = new Map<ID, number>()
    const counts = new Map<ID, number>()
    for (const e of expenses) {
      spent.set(e.tripId, (spent.get(e.tripId) ?? 0) + e.baseAmountMinorUnits)
      counts.set(e.tripId, (counts.get(e.tripId) ?? 0) + 1)
    }
    return trips.map((trip) => ({
      trip,
      spent: spent.get(trip.id) ?? 0,
      count: counts.get(trip.id) ?? 0,
      people: names.get(trip.id) ?? [],
    }))
  })
}

export function useSettings() {
  return useLiveQuery(() => settingsRepo.get())
}

export function useCategories() {
  return useLiveQuery(() => categoriesRepo.list())
}
