import Dexie, { type EntityTable } from 'dexie'
import type {
  AppSettings,
  Category,
  Expense,
  ExpenseShare,
  OutboxEntry,
  SyncCursor,
  Traveller,
  Trip,
  TripMember,
} from '../types/domain'
import { SEED_CATEGORIES } from '../types/domain'

/**
 * IndexedDB schema (via Dexie).
 *
 * Migration strategy: never edit an existing `db.version(n)` block once
 * released. To change the schema, add `db.version(n + 1).stores({...})`
 * with the new indexes and, if records need transforming, an
 * `.upgrade(tx => ...)` callback. Bump DB_SCHEMA_VERSION to match, and
 * teach src/lib/export/backup.ts to upgrade older backup files.
 */
export const DB_SCHEMA_VERSION = 2
export const DB_NAME = 'travel-expense-tracker'

export class TravelDb extends Dexie {
  trips!: EntityTable<Trip, 'id'>
  travellers!: EntityTable<Traveller, 'id'>
  expenses!: EntityTable<Expense, 'id'>
  expenseShares!: EntityTable<ExpenseShare, 'id'>
  categories!: EntityTable<Category, 'id'>
  settings!: EntityTable<AppSettings, 'id'>
  outbox!: EntityTable<OutboxEntry, 'key'>
  syncCursors!: EntityTable<SyncCursor, 'tripId'>
  members!: Dexie.Table<TripMember, [string, string]>

  constructor(name = DB_NAME) {
    super(name)
    this.version(1).stores({
      trips: 'id, status, updatedAt',
      travellers: 'id, tripId',
      expenses: 'id, tripId, [tripId+date], categoryId, payerTravellerId',
      expenseShares: 'id, expenseId, tripId, travellerId',
      categories: 'id, tripId',
      settings: 'id',
    })
    // v2: shared (cloud) trips. Existing trips stay local-only.
    this.version(2)
      .stores({
        outbox: 'key, tripId, table',
        syncCursors: 'tripId',
        members: '[tripId+userId], tripId',
      })
      .upgrade(async (tx) => {
        await tx.table('trips').toCollection().modify((t: Trip) => {
          t.syncMode ??= 'local'
        })
        await tx.table('settings').toCollection().modify((s: AppSettings) => {
          s.schemaVersion = 2
        })
      })
    this.on('populate', (tx) => {
      const now = new Date().toISOString()
      void tx.table('categories').bulkAdd(seedCategories(now))
      void tx.table('settings').add(defaultSettings())
    })
  }
}

export function seedCategories(now: string): Category[] {
  return SEED_CATEGORIES.map((c) => ({ id: c.id, tripId: null, name: c.name, isCustom: false, createdAt: now }))
}

export function defaultSettings(): AppSettings {
  return {
    id: 'app',
    schemaVersion: DB_SCHEMA_VERSION,
    defaultBaseCurrency: 'MYR',
    changesSinceBackup: 0,
    lastBackupAt: null,
    backupReminderSnoozedUntil: 0,
  }
}

export const db = new TravelDb()
