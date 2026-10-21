/**
 * Data access layer. UI code reads and writes through these functions only.
 *
 * Writes to a shared (cloud) trip also add an outbox entry in the same
 * transaction, so the sync engine (src/sync/engine.ts) uploads exactly the
 * changes that were saved locally, even if the app is closed in between.
 */
import { db as defaultDb, defaultSettings, type TravelDb } from './schema'
import { trackSave } from './saveStatus'
import { isValidCurrencyCode, parseExchangeRate } from '../lib/money/money'
import { MAX_RECEIPTS_PER_EXPENSE, MAX_RECEIPT_BYTES } from '../types/domain'
import type {
  AppSettings,
  Category,
  Expense,
  ExpenseShare,
  ID,
  ISODate,
  Receipt,
  Settlement,
  SyncTable,
  Traveller,
  Trip,
  TripStatus,
} from '../types/domain'

export const newId = (): ID => crypto.randomUUID()
const now = () => new Date().toISOString()

export type TripInput = Pick<
  Trip,
  'name' | 'destination' | 'startDate' | 'endDate' | 'baseCurrency' | 'budgetMinorUnits'
> & { categoryBudgets?: Record<ID, number> | undefined }
export type ExpenseRecord = Omit<Expense, 'id' | 'createdAt' | 'updatedAt'>
export type ShareRecord = Omit<ExpenseShare, 'id' | 'expenseId' | 'tripId'>

export const isCloudTrip = (trip: Trip | undefined) => trip?.syncMode === 'cloud'

export const TRIP_LOCKED = 'This trip is completed. Reopen it to change expenses.'
export type SettlementInput = Pick<Settlement, 'fromTravellerId' | 'toTravellerId' | 'amountMinorUnits' | 'paidOn'> &
  Partial<Pick<Settlement, 'originalAmountMinorUnits' | 'originalCurrency' | 'exchangeRate'>> & { note?: string }

/** The "paid in another currency" details of a payment, checked for consistency. */
function foreignPart(input: SettlementInput): Partial<Settlement> {
  if (input.originalAmountMinorUnits === undefined && !input.originalCurrency && !input.exchangeRate) return {}
  const { originalAmountMinorUnits: amount, originalCurrency: currency, exchangeRate: rate } = input
  if (!currency || !isValidCurrencyCode(currency) || !rate || !parseExchangeRate(rate).ok || !Number.isSafeInteger(amount) || (amount ?? 0) <= 0) {
    throw new Error('The currency details of this payment are not valid.')
  }
  return { originalAmountMinorUnits: amount!, originalCurrency: currency, exchangeRate: rate }
}

export function createRepositories(db: TravelDb) {
  /** Records that data changed, for the backup reminder. Call inside a write transaction. */
  async function bumpChangeCount(by = 1) {
    const settings = (await db.settings.get('app')) ?? defaultSettings()
    await db.settings.put({ ...settings, changesSinceBackup: settings.changesSinceBackup + by })
  }

  /** Queues a record for upload if its trip is shared. Call inside a write transaction. */
  async function queue(tripId: ID, table: SyncTable, recordId: ID, op: 'upsert' | 'delete') {
    if (!isCloudTrip(await db.trips.get(tripId))) return
    await db.outbox.put({ key: `${table}:${recordId}`, table, recordId, tripId, op, queuedAt: now() })
  }

  /** Deletes every local record of a trip (not the outbox entries unless asked). */
  async function deleteTripRows(id: ID, opts: { keepOutboxKey?: string } = {}) {
    await db.expenseShares.where('tripId').equals(id).delete()
    await db.expenses.where('tripId').equals(id).delete()
    await db.settlements.where('tripId').equals(id).delete()
    await db.receipts.where('tripId').equals(id).delete()
    await db.travellers.where('tripId').equals(id).delete()
    await db.categories.where('tripId').equals(id).delete()
    await db.members.where('tripId').equals(id).delete()
    await db.syncCursors.delete(id)
    await db.outbox
      .where('tripId')
      .equals(id)
      .filter((e) => e.key !== opts.keepOutboxKey)
      .delete()
    await db.trips.delete(id)
  }

  const allTripTables = () => [
    db.trips,
    db.travellers,
    db.expenses,
    db.expenseShares,
    db.settlements,
    db.receipts,
    db.categories,
    db.members,
    db.syncCursors,
    db.outbox,
    db.settings,
  ]

  // ---------- Settings ----------

  const settingsRepo = {
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

  const tripsRepo = {
    list: () => db.trips.toArray(),
    get: (id: ID) => db.trips.get(id),

    /** Creates a local trip together with its initial travellers. */
    create(input: TripInput, travellerNames: string[], extra: { isSample?: boolean } = {}): Promise<Trip> {
      return trackSave(() =>
        db.transaction('rw', [db.trips, db.travellers, db.settings], async () => {
          const ts = now()
          const { categoryBudgets, ...basics } = input
          const trip: Trip = { ...basics, ...(categoryBudgets && Object.keys(categoryBudgets).length ? { categoryBudgets } : {}), id: newId(), status: 'active', syncMode: 'local', createdAt: ts, updatedAt: ts, ...extra }
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
        db.transaction('rw', [db.trips, db.expenses, db.outbox, db.settings], async () => {
          const trip = await db.trips.get(id)
          if (!trip) throw new Error('Trip not found.')
          if (input.baseCurrency !== trip.baseCurrency && (await db.expenses.where('tripId').equals(id).count()) > 0) {
            throw new Error('The base currency cannot change once a trip has expenses.')
          }
          const { categoryBudgets, ...rest } = input
          const next: Trip = { ...trip, ...rest, updatedAt: now() }
          if (categoryBudgets && Object.keys(categoryBudgets).length > 0) next.categoryBudgets = categoryBudgets
          else delete next.categoryBudgets
          await db.trips.put(next)
          await queue(id, 'trips', id, 'upsert')
          await bumpChangeCount()
        }),
      )
    },

    setStatus(id: ID, status: TripStatus) {
      return trackSave(() =>
        db.transaction('rw', [db.trips, db.outbox, db.settings], async () => {
          await db.trips.update(id, { status, updatedAt: now() })
          await queue(id, 'trips', id, 'upsert')
          await bumpChangeCount()
        }),
      )
    },

    /**
     * Deletes a trip and all of its travellers, expenses and shares. For a
     * shared trip (owner only) the deletion is also queued for upload, so it
     * disappears from every member's device.
     */
    delete(id: ID) {
      return trackSave(() =>
        db.transaction('rw', allTripTables(), async () => {
          const trip = await db.trips.get(id)
          const key = `trips:${id}`
          if (isCloudTrip(trip)) {
            await db.outbox.put({ key, table: 'trips', recordId: id, tripId: id, op: 'delete', queuedAt: now() })
          }
          await deleteTripRows(id, { keepOutboxKey: isCloudTrip(trip) ? key : undefined })
          await bumpChangeCount()
        }),
      )
    },

    /** Removes this device's copy of a trip without touching the server. Used by sync. */
    removeLocalCopy(id: ID) {
      return db.transaction('rw', allTripTables(), () => deleteTripRows(id))
    },

    async counts(id: ID) {
      const [expenses, travellers] = await Promise.all([
        db.expenses.where('tripId').equals(id).count(),
        db.travellers.where('tripId').equals(id).count(),
      ])
      return { expenses, travellers }
    },
  }

  // ---------- Receipt photos ----------

  const receiptsRepo = {
    listByExpense: (expenseId: ID) => db.receipts.where('expenseId').equals(expenseId).sortBy('createdAt'),
    listByTrip: (tripId: ID) => db.receipts.where('tripId').equals(tripId).toArray(),

    /** Attaches a (already shrunk) photo to an expense. */
    add(expenseId: ID, blob: Blob): Promise<Receipt> {
      return trackSave(() =>
        db.transaction('rw', [db.expenses, db.receipts, db.trips, db.outbox, db.settings], async () => {
          const expense = await db.expenses.get(expenseId)
          if (!expense) throw new Error('This expense no longer exists.')
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) throw new Error('Receipts must be JPEG, PNG or WebP photos.')
          if (blob.size === 0 || blob.size > MAX_RECEIPT_BYTES) throw new Error('This photo is too large. Photos can be up to 2 MB.')
          if ((await db.receipts.where('expenseId').equals(expenseId).count()) >= MAX_RECEIPTS_PER_EXPENSE) {
            throw new Error(`An expense can have up to ${MAX_RECEIPTS_PER_EXPENSE} receipt photos.`)
          }
          const ts = now()
          const receipt: Receipt = { id: newId(), tripId: expense.tripId, expenseId, mimeType: blob.type, sizeBytes: blob.size, blob, createdAt: ts, updatedAt: ts }
          await db.receipts.add(receipt)
          await queue(expense.tripId, 'receipts', receipt.id, 'upsert')
          await bumpChangeCount()
          return receipt
        }),
      )
    },

    remove(id: ID) {
      return trackSave(() =>
        db.transaction('rw', [db.receipts, db.trips, db.outbox, db.settings], async () => {
          const r = await db.receipts.get(id)
          if (!r) return
          await db.receipts.delete(id)
          await queue(r.tripId, 'receipts', id, 'delete')
          await bumpChangeCount()
        }),
      )
    },

    /** Keeps a photo downloaded from the server so it opens offline next time. */
    async cacheBlob(id: ID, blob: Blob) {
      await db.receipts.update(id, { blob })
    },
  }

  // ---------- Travellers ----------

  const travellersRepo = {
    listAll: () => db.travellers.toArray(),
    listByTrip: async (tripId: ID) =>
      (await db.travellers.where('tripId').equals(tripId).toArray()).sort(
        (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      ),

    add(tripId: ID, displayName: string): Promise<Traveller> {
      return trackSave(() =>
        db.transaction('rw', [db.trips, db.travellers, db.outbox, db.settings], async () => {
          const ts = now()
          const t: Traveller = { id: newId(), tripId, displayName: displayName.trim(), createdAt: ts, updatedAt: ts }
          await db.travellers.add(t)
          await queue(tripId, 'travellers', t.id, 'upsert')
          await bumpChangeCount()
          return t
        }),
      )
    },

    /** Renames a traveller. Expense snapshots keep the name used when saved. */
    rename(id: ID, displayName: string) {
      return travellersRepo.patch(id, { displayName: displayName.trim() })
    },

    /** Marks which signed-in member this traveller is (null to unlink). */
    linkUser(id: ID, userId: string | null) {
      return trackSave(() =>
        db.transaction('rw', [db.trips, db.travellers, db.outbox, db.settings], async () => {
          const t = await db.travellers.get(id)
          if (!t) throw new Error('Traveller not found.')
          // One traveller per person: unlink any other traveller on this trip first.
          if (userId) {
            const others = await db.travellers.where('tripId').equals(t.tripId).filter((o) => o.userId === userId && o.id !== id).toArray()
            for (const o of others) {
              await db.travellers.update(o.id, { userId: null, updatedAt: now() })
              await queue(o.tripId, 'travellers', o.id, 'upsert')
            }
          }
          await db.travellers.update(id, { userId, updatedAt: now() })
          await queue(t.tripId, 'travellers', id, 'upsert')
        }),
      )
    },

    patch(id: ID, changes: Partial<Pick<Traveller, 'displayName'>>) {
      return trackSave(() =>
        db.transaction('rw', [db.trips, db.travellers, db.outbox, db.settings], async () => {
          const t = await db.travellers.get(id)
          if (!t) throw new Error('Traveller not found.')
          await db.travellers.update(id, { ...changes, updatedAt: now() })
          await queue(t.tripId, 'travellers', id, 'upsert')
          await bumpChangeCount()
        }),
      )
    },

    /** Number of expenses and settlement payments this traveller is part of. */
    async usageCount(id: ID): Promise<number> {
      const [paid, shares, payments] = await Promise.all([
        db.expenses.where('payerTravellerId').equals(id).primaryKeys(),
        db.expenseShares.where('travellerId').equals(id).toArray(),
        db.settlements.filter((s) => s.fromTravellerId === id || s.toTravellerId === id).count(),
      ])
      return new Set([...paid, ...shares.map((s) => s.expenseId)]).size + payments
    },

    /** Removes a traveller. Refuses if any expense references them, to protect history. */
    remove(id: ID) {
      return trackSave(() =>
        db.transaction('rw', [db.trips, db.travellers, db.expenses, db.expenseShares, db.settlements, db.outbox, db.settings], async () => {
          const t = await db.travellers.get(id)
          if (!t) return
          if ((await travellersRepo.usageCount(id)) > 0) {
            throw new Error('This person is part of saved expenses or payments. Edit or delete those first.')
          }
          await db.travellers.delete(id)
          await queue(t.tripId, 'travellers', id, 'delete')
          await bumpChangeCount()
        }),
      )
    },
  }

  // ---------- Expenses ----------

  const expensesRepo = {
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
      return this.saveMany([{ id, record, shares }]).then((saved) => saved[0]!)
    },

    /** Saves several expenses in one transaction: either all of them are stored, or none. */
    saveMany(items: { id?: ID | undefined; record: ExpenseRecord; shares: ShareRecord[] }[]): Promise<Expense[]> {
      for (const { record, shares } of items) {
        const shareTotal = shares.reduce((s, x) => s + x.allocatedBaseAmountMinorUnits, 0)
        if (shareTotal !== record.baseAmountMinorUnits) {
          return Promise.reject(new Error('Shares do not add up to the expense total.'))
        }
      }
      return trackSave(() =>
        db.transaction('rw', [db.trips, db.expenses, db.expenseShares, db.outbox, db.settings], async () => {
          const ts = now()
          const saved: Expense[] = []
          for (const { id, record, shares } of items) {
            if ((await db.trips.get(record.tripId))?.status === 'completed') throw new Error(TRIP_LOCKED)
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
              shares.map((sh) => ({ ...sh, id: newId(), expenseId: expense.id, tripId: expense.tripId })),
            )
            await queue(expense.tripId, 'expenses', expense.id, 'upsert')
            saved.push(expense)
          }
          await bumpChangeCount(saved.length)
          return saved
        }),
      )
    },

    delete(id: ID) {
      return trackSave(() =>
        db.transaction('rw', [db.trips, db.expenses, db.expenseShares, db.receipts, db.outbox, db.settings], async () => {
          const e = await db.expenses.get(id)
          if (!e) return
          if ((await db.trips.get(e.tripId))?.status === 'completed') throw new Error(TRIP_LOCKED)
          for (const r of await db.receipts.where('expenseId').equals(id).toArray()) {
            await db.receipts.delete(r.id)
            await queue(e.tripId, 'receipts', r.id, 'delete')
          }
          await db.expenseShares.where('expenseId').equals(id).delete()
          await db.expenses.delete(id)
          await queue(e.tripId, 'expenses', id, 'delete')
          await bumpChangeCount()
        }),
      )
    },
  }

  // ---------- Categories ----------

  const categoriesRepo = {
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
          if (all.some((c) => c.tripId === null && c.name.toLowerCase() === trimmed.toLowerCase())) {
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
          if (all.some((c) => c.id !== id && c.tripId === null && c.name.toLowerCase() === trimmed.toLowerCase())) {
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

  // ---------- Settlement payments ----------

  const settlementsRepo = {
    listByTrip: (tripId: ID) => db.settlements.where('tripId').equals(tripId).toArray(),

    /** Records that one traveller paid another. Allowed even after the trip is completed. */
    add(tripId: ID, input: SettlementInput): Promise<Settlement> {
      return trackSave(() =>
        db.transaction('rw', [db.trips, db.travellers, db.settlements, db.outbox, db.settings], async () => {
          if (!Number.isSafeInteger(input.amountMinorUnits) || input.amountMinorUnits <= 0) {
            throw new Error('The amount must be greater than zero.')
          }
          if (input.fromTravellerId === input.toTravellerId) throw new Error('Someone cannot pay themselves.')
          const [from, to] = await Promise.all([db.travellers.get(input.fromTravellerId), db.travellers.get(input.toTravellerId)])
          if (!from || !to || from.tripId !== tripId || to.tripId !== tripId) throw new Error('Both people must be on this trip.')
          const ts = now()
          const payment: Settlement = {
            id: newId(),
            tripId,
            fromTravellerId: input.fromTravellerId,
            toTravellerId: input.toTravellerId,
            amountMinorUnits: input.amountMinorUnits,
            paidOn: input.paidOn as ISODate,
            note: (input.note ?? '').trim().slice(0, 200),
            ...foreignPart(input),
            createdAt: ts,
            updatedAt: ts,
          }
          await db.settlements.add(payment)
          await queue(tripId, 'settlements', payment.id, 'upsert')
          await bumpChangeCount()
          return payment
        }),
      )
    },

    /** Undoes a recorded payment. */
    remove(id: ID) {
      return trackSave(() =>
        db.transaction('rw', [db.trips, db.settlements, db.outbox, db.settings], async () => {
          const payment = await db.settlements.get(id)
          if (!payment) return
          await db.settlements.delete(id)
          await queue(payment.tripId, 'settlements', id, 'delete')
          await bumpChangeCount()
        }),
      )
    },
  }

  const outboxRepo = {
    count: () => db.outbox.count(),
    list: () => db.outbox.toArray(),
    /** Clears the error on failed entries so the next sync tries them again. */
    retryFailed: () =>
      db.outbox.toCollection().modify((e) => {
        delete e.error
      }),
  }

  return { settingsRepo, tripsRepo, travellersRepo, expensesRepo, categoriesRepo, settlementsRepo, receiptsRepo, outboxRepo }
}

export type Repositories = ReturnType<typeof createRepositories>

/** Repositories for the app's own database. */
export const { settingsRepo, tripsRepo, travellersRepo, expensesRepo, categoriesRepo, settlementsRepo, receiptsRepo, outboxRepo } =
  createRepositories(defaultDb)
