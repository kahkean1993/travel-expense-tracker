/**
 * Data access layer. UI code reads and writes through these functions only,
 * so a cloud backend could later replace IndexedDB without touching screens.
 */
import { db, defaultSettings } from './schema'
import { trackSave } from './saveStatus'
import type {
  AppSettings,
  Category,
  Expense,
  ExpenseShare,
  ID,
  Traveller,
  Trip,
  TripStatus,
} from '../types/domain'

export const newId = (): ID => crypto.randomUUID()
const now = () => new Date().toISOString()

/** Records that data changed, for the backup reminder. Call inside a write transaction. */
async function bumpChangeCount(by = 1) {
  const settings = (await db.settings.get('app')) ?? defaultSettings()
  await db.settings.put({ ...settings, changesSinceBackup: settings.changesSinceBackup + by })
}

// ---------- Settings ----------

export const settingsRepo = {
  async get(): Promise<AppSettings> {
    return (await db.settings.get('app')) ?? defaultSettings()
  },
  update(patch: Partial<Omit<AppSettings, 'id' | 'schemaVersion'>>) {
    return trackSave(async () => {
      await db.transaction('rw', db.settings, async () => {
        const current = (await db.settings.get('app')) ?? defaultSettings()
        await db.settings.put({ ...current, ...patch })
      })
    })
  },
  markBackedUp() {
    return settingsRepo.update({ changesSinceBackup: 0, backupReminderSnoozedUntil: 0, lastBackupAt: now() })
  },
}

// ---------- Trips ----------

export type TripInput = Pick<
  Trip,
  'name' | 'destination' | 'startDate' | 'endDate' | 'baseCurrency' | 'budgetMinorUnits'
>

export const tripsRepo = {
  list: () => db.trips.toArray(),
  get: (id: ID) => db.trips.get(id),

  /** Creates a trip together with its initial travellers. */
  create(input: TripInput, travellerNames: string[], extra: { isSample?: boolean } = {}): Promise<Trip> {
    return trackSave(() =>
      db.transaction('rw', [db.trips, db.travellers, db.settings], async () => {
        const ts = now()
        const trip: Trip = { ...input, id: newId(), status: 'active', createdAt: ts, updatedAt: ts, ...extra }
        await db.trips.add(trip)
        const names = travellerNames.map((n) => n.trim()).filter(Boolean)
        await db.travellers.bulkAdd(
          // Offset timestamps by 1 ms so the list keeps the entered order.
          (names.length ? names : ['Me']).map((displayName, i) => {
            const created = new Date(Date.parse(ts) + i).toISOString()
            return { id: newId(), tripId: trip.id, displayName, createdAt: created, updatedAt: created }
          }),
        )
        await bumpChangeCount()
        return trip
      }),
    )
  },

  update(id: ID, input: TripInput) {
    return trackSave(() =>
      db.transaction('rw', [db.trips, db.expenses, db.settings], async () => {
        const trip = await db.trips.get(id)
        if (!trip) throw new Error('Trip not found.')
        if (input.baseCurrency !== trip.baseCurrency && (await db.expenses.where('tripId').equals(id).count()) > 0) {
          throw new Error('The base currency cannot change once a trip has expenses.')
        }
        await db.trips.put({ ...trip, ...input, updatedAt: now() })
        await bumpChangeCount()
      }),
    )
  },

  setStatus(id: ID, status: TripStatus) {
    return trackSave(() =>
      db.transaction('rw', [db.trips, db.settings], async () => {
        await db.trips.update(id, { status, updatedAt: now() })
        await bumpChangeCount()
      }),
    )
  },

  /** Deletes a trip and all of its travellers, expenses and shares. */
  delete(id: ID) {
    return trackSave(() =>
      db.transaction('rw', [db.trips, db.travellers, db.expenses, db.expenseShares, db.categories, db.settings], async () => {
        await db.expenseShares.where('tripId').equals(id).delete()
        await db.expenses.where('tripId').equals(id).delete()
        await db.travellers.where('tripId').equals(id).delete()
        await db.categories.where('tripId').equals(id).delete()
        await db.trips.delete(id)
        await bumpChangeCount()
      }),
    )
  },

  async counts(id: ID) {
    const [expenses, travellers] = await Promise.all([
      db.expenses.where('tripId').equals(id).count(),
      db.travellers.where('tripId').equals(id).count(),
    ])
    return { expenses, travellers }
  },
}

// ---------- Travellers ----------

export const travellersRepo = {
  listByTrip: async (tripId: ID) =>
    (await db.travellers.where('tripId').equals(tripId).toArray()).sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    ),

  add(tripId: ID, displayName: string): Promise<Traveller> {
    return trackSave(() =>
      db.transaction('rw', [db.travellers, db.settings], async () => {
        const ts = now()
        const t: Traveller = { id: newId(), tripId, displayName: displayName.trim(), createdAt: ts, updatedAt: ts }
        await db.travellers.add(t)
        await bumpChangeCount()
        return t
      }),
    )
  },

  /** Renames a traveller. Expense snapshots keep the name used when saved. */
  rename(id: ID, displayName: string) {
    return trackSave(() =>
      db.transaction('rw', [db.travellers, db.settings], async () => {
        await db.travellers.update(id, { displayName: displayName.trim(), updatedAt: now() })
        await bumpChangeCount()
      }),
    )
  },

  /** Number of expenses where this traveller paid or has a share. */
  async usageCount(id: ID): Promise<number> {
    const [paid, shares] = await Promise.all([
      db.expenses.where('payerTravellerId').equals(id).primaryKeys(),
      db.expenseShares.where('travellerId').equals(id).toArray(),
    ])
    return new Set([...paid, ...shares.map((s) => s.expenseId)]).size
  },

  /** Removes a traveller. Refuses if any expense references them, to protect history. */
  remove(id: ID) {
    return trackSave(() =>
      db.transaction('rw', [db.travellers, db.expenses, db.expenseShares, db.settings], async () => {
        if ((await travellersRepo.usageCount(id)) > 0) {
          throw new Error('This person is part of saved expenses. Edit or delete those expenses first.')
        }
        await db.travellers.delete(id)
        await bumpChangeCount()
      }),
    )
  },
}

// ---------- Expenses ----------

export type ExpenseRecord = Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>
export type ShareRecord = Omit<ExpenseShare, 'id' | 'expenseId' | 'tripId'>

export const expensesRepo = {
  listByTrip: (tripId: ID) => db.expenses.where('tripId').equals(tripId).toArray(),
  listAll: () => db.expenses.toArray(),
  get: (id: ID) => db.expenses.get(id),
  sharesByTrip: (tripId: ID) => db.expenseShares.where('tripId').equals(tripId).toArray(),
  sharesByExpense: (expenseId: ID) => db.expenseShares.where('expenseId').equals(expenseId).toArray(),

  /**
   * Creates (id undefined) or updates an expense and replaces its shares
   * atomically. Shares must add up to baseAmountMinorUnits.
   */
  save(id: ID | undefined, record: ExpenseRecord, shares: ShareRecord[]): Promise<Expense> {
    const shareTotal = shares.reduce((s, x) => s + x.allocatedBaseAmountMinorUnits, 0)
    if (shareTotal !== record.baseAmountMinorUnits) {
      return Promise.reject(new Error('Shares do not add up to the expense total.'))
    }
    return trackSave(() =>
      db.transaction('rw', [db.expenses, db.expenseShares, db.settings], async () => {
        const ts = now()
        const existing = id ? await db.expenses.get(id) : undefined
        if (id && !existing) throw new Error('This expense no longer exists.')
        const expense: Expense = {
          ...record,
          id: existing?.id ?? newId(),
          createdAt: existing?.createdAt ?? ts,
          updatedAt: ts,
        }
        await db.expenses.put(expense)
        await db.expenseShares.where('expenseId').equals(expense.id).delete()
        await db.expenseShares.bulkAdd(
          shares.map((s) => ({ ...s, id: newId(), expenseId: expense.id, tripId: expense.tripId })),
        )
        await bumpChangeCount()
        return expense
      }),
    )
  },

  delete(id: ID) {
    return trackSave(() =>
      db.transaction('rw', [db.expenses, db.expenseShares, db.settings], async () => {
        await db.expenseShares.where('expenseId').equals(id).delete()
        await db.expenses.delete(id)
        await bumpChangeCount()
      }),
    )
  },
}

// ---------- Categories ----------

export const categoriesRepo = {
  /** Global categories plus any belonging to the given trip. */
  async list(tripId?: ID): Promise<Category[]> {
    const all = await db.categories.toArray()
    return all.filter((c) => c.tripId === null || c.tripId === tripId)
  },

  add(name: string): Promise<Category> {
    return trackSave(() =>
      db.transaction('rw', [db.categories, db.settings], async () => {
        const trimmed = name.trim()
        const all = await db.categories.toArray()
        if (all.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
          throw new Error('A category with this name already exists.')
        }
        const c: Category = { id: newId(), tripId: null, name: trimmed, isCustom: true, createdAt: now() }
        await db.categories.add(c)
        await bumpChangeCount()
        return c
      }),
    )
  },

  rename(id: ID, name: string) {
    return trackSave(() =>
      db.transaction('rw', [db.categories, db.settings], async () => {
        const trimmed = name.trim()
        const all = await db.categories.toArray()
        if (all.some((c) => c.id !== id && c.name.toLowerCase() === trimmed.toLowerCase())) {
          throw new Error('A category with this name already exists.')
        }
        await db.categories.update(id, { name: trimmed })
        await bumpChangeCount()
      }),
    )
  },

  usageCount: (id: ID) => db.expenses.where('categoryId').equals(id).count(),

  remove(id: ID) {
    return trackSave(() =>
      db.transaction('rw', [db.categories, db.expenses, db.settings], async () => {
        const cat = await db.categories.get(id)
        if (!cat?.isCustom) throw new Error('Built-in categories cannot be deleted.')
        if ((await db.expenses.where('categoryId').equals(id).count()) > 0) {
          throw new Error('This category is used by saved expenses. Recategorise them first.')
        }
        await db.categories.delete(id)
        await bumpChangeCount()
      }),
    )
  },
}
