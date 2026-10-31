/**
 * JSON backup and restore.
 *
 * Backup file format (formatVersion 2; version 1 files have no "settlements" and still restore):
 * {
 *   "format": "travel-expense-tracker-backup",
 *   "formatVersion": 2,
 *   "dbSchemaVersion": 3,
 *   "exportedAt": "2026-01-31T12:00:00.000Z",
 *   "data": {
 *     "trips": Trip[], "travellers": Traveller[], "expenses": Expense[],
 *     "expenseShares": ExpenseShare[], "settlements": Settlement[], "categories": Category[],
 *     "settings": AppSettings | null
 *   }
 * }
 * Records use exactly the shapes in src/types/domain.ts (integer minor
 * units, decimal-string exchange rates).
 *
 * Restore never writes anything until the whole file has been validated.
 * Two modes are offered:
 * - merge: add trips (with their records) whose IDs are not already present,
 *   and categories that don't exist yet. Existing records are never changed.
 * - replace: delete everything, then load the backup, in one transaction.
 */
import { db, defaultSettings, DB_SCHEMA_VERSION, seedCategories } from '../../db/schema'
import { trackSave } from '../../db/saveStatus'
import {
  PAYMENT_METHODS,
  SPLIT_MODES,
  type AppSettings,
  type Category,
  type Expense,
  type ExpenseShare,
  type Settlement,
  type Traveller,
  type Trip,
} from '../../types/domain'
import { convertMinorUnits, isWellFormedCurrencyCode, MAX_MINOR_UNITS, parseExchangeRate } from '../money/money'

export const BACKUP_FORMAT = 'travel-expense-tracker-backup'
export const BACKUP_FORMAT_VERSION = 2

export interface BackupData {
  trips: Trip[]
  travellers: Traveller[]
  expenses: Expense[]
  expenseShares: ExpenseShare[]
  settlements: Settlement[]
  categories: Category[]
  settings: AppSettings | null
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  dbSchemaVersion: number
  exportedAt: string
  data: BackupData
}

export async function createBackup(): Promise<BackupFile> {
  return db.transaction('r', [db.trips, db.travellers, db.expenses, db.expenseShares, db.settlements, db.categories, db.settings], async () => ({
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    dbSchemaVersion: DB_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      trips: await db.trips.toArray(),
      travellers: await db.travellers.toArray(),
      expenses: await db.expenses.toArray(),
      expenseShares: await db.expenseShares.toArray(),
      settlements: await db.settlements.toArray(),
      categories: await db.categories.toArray(),
      settings: (await db.settings.get('app')) ?? null,
    },
  }))
}

// ---------- Validation ----------

class ValidationError extends Error {}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new ValidationError(message)
}

function str(o: Obj, key: string, where: string, opts: { empty?: boolean } = {}): string {
  const v = o[key]
  check(typeof v === 'string', `${where}: "${key}" must be text.`)
  check(opts.empty || v.trim() !== '', `${where}: "${key}" must not be empty.`)
  return v
}
function date(o: Obj, key: string, where: string): string {
  const v = str(o, key, where)
  check(DATE_RE.test(v) && !Number.isNaN(Date.parse(v)), `${where}: "${key}" must be a date like 2026-01-31.`)
  return v
}
function minor(o: Obj, key: string, where: string): number {
  const v = o[key]
  check(
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= MAX_MINOR_UNITS,
    `${where}: "${key}" must be a whole, non-negative number of minor units.`,
  )
  return v
}
function currency(o: Obj, key: string, where: string): string {
  const v = str(o, key, where)
  check(isWellFormedCurrencyCode(v), `${where}: "${v}" is not a valid currency code.`)
  return v
}
function arr(o: Obj, key: string): unknown[] {
  const v = o[key]
  check(Array.isArray(v), `Backup is missing the "${key}" list.`)
  return v
}

function validateTrip(v: unknown, i: number): Trip {
  const where = `Trip #${i + 1}`
  check(isObj(v), `${where} is not an object.`)
  const t: Trip = {
    id: str(v, 'id', where),
    name: str(v, 'name', where),
    destination: str(v, 'destination', where, { empty: true }),
    startDate: date(v, 'startDate', where),
    endDate: date(v, 'endDate', where),
    baseCurrency: currency(v, 'baseCurrency', where),
    budgetMinorUnits: minor(v, 'budgetMinorUnits', where),
    status: v.status === 'completed' ? 'completed' : 'active',
    // Restored trips are always local copies; shared trips come back by signing in.
    syncMode: 'local',
    createdAt: str(v, 'createdAt', where),
    updatedAt: str(v, 'updatedAt', where),
  }
  check(v.status === 'active' || v.status === 'completed', `${where}: unknown status.`)
  check(t.endDate >= t.startDate, `${where}: end date is before start date.`)
  if (v.isSample === true) t.isSample = true
  if (v.categoryBudgets !== undefined) {
    check(isObj(v.categoryBudgets), `${where}: category budgets are not valid.`)
    const budgets: Record<string, number> = {}
    for (const [id, amount] of Object.entries(v.categoryBudgets)) {
      check(typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_MINOR_UNITS, `${where}: a category budget is not valid.`)
      if (amount > 0) budgets[id] = amount
    }
    if (Object.keys(budgets).length) t.categoryBudgets = budgets
  }
  return t
}

function validateTraveller(v: unknown, i: number): Traveller {
  const where = `Traveller #${i + 1}`
  check(isObj(v), `${where} is not an object.`)
  return {
    id: str(v, 'id', where),
    tripId: str(v, 'tripId', where),
    displayName: str(v, 'displayName', where),
    createdAt: str(v, 'createdAt', where),
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : str(v, 'createdAt', where),
  }
}

function validateExpense(v: unknown, i: number): Expense {
  const where = `Expense #${i + 1}`
  check(isObj(v), `${where} is not an object.`)
  const rate = parseExchangeRate(str(v, 'exchangeRate', where))
  check(rate.ok, `${where}: invalid exchange rate.`)
  const pm = v.paymentMethod
  check(typeof pm === 'string' && (PAYMENT_METHODS as readonly string[]).includes(pm), `${where}: unknown payment method.`)
  const sm = v.splitMode
  check(typeof sm === 'string' && (SPLIT_MODES as readonly string[]).includes(sm), `${where}: unknown split mode.`)
  const e: Expense = {
    id: str(v, 'id', where),
    tripId: str(v, 'tripId', where),
    description: str(v, 'description', where),
    date: date(v, 'date', where),
    originalAmountMinorUnits: minor(v, 'originalAmountMinorUnits', where),
    originalCurrency: currency(v, 'originalCurrency', where),
    exchangeRate: rate.value,
    baseAmountMinorUnits: minor(v, 'baseAmountMinorUnits', where),
    baseCurrency: currency(v, 'baseCurrency', where),
    categoryId: str(v, 'categoryId', where),
    paymentMethod: pm as Expense['paymentMethod'],
    paymentAccountNote: str(v, 'paymentAccountNote', where, { empty: true }),
    payerTravellerId: str(v, 'payerTravellerId', where),
    payerNameSnapshot: str(v, 'payerNameSnapshot', where, { empty: true }),
    notes: str(v, 'notes', where, { empty: true }),
    splitMode: sm as Expense['splitMode'],
    createdAt: str(v, 'createdAt', where),
    updatedAt: str(v, 'updatedAt', where),
  }
  check(e.originalAmountMinorUnits > 0, `${where}: amount must be greater than zero.`)
  if (e.originalCurrency === e.baseCurrency) {
    check(e.exchangeRate === '1', `${where}: same-currency expense must use rate 1.`)
    check(e.baseAmountMinorUnits === e.originalAmountMinorUnits, `${where}: converted amount does not match.`)
  } else {
    check(
      convertMinorUnits(e.originalAmountMinorUnits, e.originalCurrency, e.baseCurrency, e.exchangeRate) ===
        e.baseAmountMinorUnits,
      `${where}: converted amount does not match its saved exchange rate.`,
    )
  }
  return e
}

function validateShare(v: unknown, i: number): ExpenseShare {
  const where = `Expense share #${i + 1}`
  check(isObj(v), `${where} is not an object.`)
  const s: ExpenseShare = {
    id: str(v, 'id', where),
    expenseId: str(v, 'expenseId', where),
    tripId: str(v, 'tripId', where),
    travellerId: str(v, 'travellerId', where),
    travellerNameSnapshot: str(v, 'travellerNameSnapshot', where, { empty: true }),
    allocatedBaseAmountMinorUnits: minor(v, 'allocatedBaseAmountMinorUnits', where),
  }
  if (v.weight !== undefined) {
    check(typeof v.weight === 'number' && Number.isSafeInteger(v.weight) && v.weight > 0, `${where}: invalid weight.`)
    s.weight = v.weight
  }
  return s
}

function validateSettlement(v: unknown, i: number): Settlement {
  const where = `Payment #${i + 1}`
  check(isObj(v), `${where} is not an object.`)
  const s: Settlement = {
    id: str(v, 'id', where),
    tripId: str(v, 'tripId', where),
    fromTravellerId: str(v, 'fromTravellerId', where),
    toTravellerId: str(v, 'toTravellerId', where),
    amountMinorUnits: minor(v, 'amountMinorUnits', where),
    paidOn: date(v, 'paidOn', where),
    note: str(v, 'note', where, { empty: true }),
    createdAt: str(v, 'createdAt', where),
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : str(v, 'createdAt', where),
  }
  if (v.originalCurrency !== undefined) {
    const rate = parseExchangeRate(str(v, 'exchangeRate', where))
    check(rate.ok, `${where}: invalid exchange rate.`)
    s.originalCurrency = currency(v, 'originalCurrency', where)
    s.exchangeRate = rate.value
    s.originalAmountMinorUnits = minor(v, 'originalAmountMinorUnits', where)
    check(s.originalAmountMinorUnits > 0, `${where}: original amount must be greater than zero.`)
  }
  check(s.amountMinorUnits > 0, `${where}: amount must be greater than zero.`)
  check(s.fromTravellerId !== s.toTravellerId, `${where}: someone cannot pay themselves.`)
  return s
}

function validateCategory(v: unknown, i: number): Category {
  const where = `Category #${i + 1}`
  check(isObj(v), `${where} is not an object.`)
  check(v.tripId === null || typeof v.tripId === 'string', `${where}: invalid trip reference.`)
  return {
    id: str(v, 'id', where),
    tripId: v.tripId as string | null,
    name: str(v, 'name', where),
    isCustom: v.isCustom === true,
    createdAt: str(v, 'createdAt', where),
  }
}

function validateSettings(v: unknown): AppSettings | null {
  if (v === null || v === undefined) return null
  check(isObj(v), 'Settings are not an object.')
  const base = defaultSettings()
  return {
    ...base,
    defaultBaseCurrency:
      typeof v.defaultBaseCurrency === 'string' && isWellFormedCurrencyCode(v.defaultBaseCurrency)
        ? v.defaultBaseCurrency
        : base.defaultBaseCurrency,
  }
}

function uniqueIds(items: { id: string }[], label: string) {
  const seen = new Set<string>()
  for (const item of items) {
    check(!seen.has(item.id), `Backup contains duplicate ${label} IDs.`)
    seen.add(item.id)
  }
}

/** Parses and fully validates backup text. Returns data or a readable error. */
export function parseBackup(text: string): { ok: true; backup: BackupFile } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'This file is not valid JSON. Choose a backup file downloaded from this app.' }
  }
  try {
    check(isObj(raw) && raw.format === BACKUP_FORMAT, 'This file is not a Travel Expense Tracker backup.')
    check(
      typeof raw.formatVersion === 'number' && raw.formatVersion >= 1,
      'The backup file has no valid format version.',
    )
    check(
      raw.formatVersion <= BACKUP_FORMAT_VERSION,
      'This backup was made by a newer version of the app. Update the app before restoring it.',
    )
    check(isObj(raw.data), 'The backup file has no data section.')
    const d = raw.data
    const data: BackupData = {
      trips: arr(d, 'trips').map(validateTrip),
      travellers: arr(d, 'travellers').map(validateTraveller),
      expenses: arr(d, 'expenses').map(validateExpense),
      expenseShares: arr(d, 'expenseShares').map(validateShare),
      // Version 1 backups were made before payments existed.
      settlements: d.settlements === undefined && raw.formatVersion < 2 ? [] : arr(d, 'settlements').map(validateSettlement),
      categories: arr(d, 'categories').map(validateCategory),
      settings: validateSettings(d.settings),
    }
    uniqueIds(data.trips, 'trip')
    uniqueIds(data.travellers, 'traveller')
    uniqueIds(data.expenses, 'expense')
    uniqueIds(data.expenseShares, 'expense share')
    uniqueIds(data.settlements, 'payment')
    uniqueIds(data.categories, 'category')

    // Referential integrity.
    const trips = new Map(data.trips.map((t) => [t.id, t]))
    const travellers = new Map(data.travellers.map((t) => [t.id, t]))
    const categories = new Set(data.categories.map((c) => c.id))
    for (const t of data.travellers) check(trips.has(t.tripId), `Traveller "${t.displayName}" belongs to a missing trip.`)
    const shareTotals = new Map<string, number>()
    const expenses = new Map(data.expenses.map((e) => [e.id, e]))
    for (const e of data.expenses) {
      const trip = trips.get(e.tripId)
      check(trip, `Expense "${e.description}" belongs to a missing trip.`)
      check(e.baseCurrency === trip.baseCurrency, `Expense "${e.description}" uses a different base currency from its trip.`)
      check(travellers.get(e.payerTravellerId)?.tripId === e.tripId, `Expense "${e.description}" has an unknown payer.`)
      check(categories.has(e.categoryId), `Expense "${e.description}" uses a missing category.`)
    }
    for (const s of data.expenseShares) {
      const e = expenses.get(s.expenseId)
      check(e && e.tripId === s.tripId, 'An expense share refers to a missing expense.')
      check(travellers.get(s.travellerId)?.tripId === s.tripId, 'An expense share refers to an unknown traveller.')
      shareTotals.set(s.expenseId, (shareTotals.get(s.expenseId) ?? 0) + s.allocatedBaseAmountMinorUnits)
    }
    for (const s of data.settlements) {
      check(trips.has(s.tripId), 'A payment belongs to a missing trip.')
      check(
        travellers.get(s.fromTravellerId)?.tripId === s.tripId && travellers.get(s.toTravellerId)?.tripId === s.tripId,
        'A payment refers to an unknown traveller.',
      )
    }
    for (const e of data.expenses) {
      check(
        shareTotals.get(e.id) === e.baseAmountMinorUnits,
        `Shares of expense "${e.description}" do not add up to its total.`,
      )
    }
    return {
      ok: true,
      backup: {
        format: BACKUP_FORMAT,
        formatVersion: raw.formatVersion,
        dbSchemaVersion: typeof raw.dbSchemaVersion === 'number' ? raw.dbSchemaVersion : DB_SCHEMA_VERSION,
        exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
        data,
      },
    }
  } catch (error) {
    if (error instanceof ValidationError) return { ok: false, error: error.message }
    return { ok: false, error: 'The backup could not be read. It may be damaged.' }
  }
}

// ---------- Preview & restore ----------

export interface ImportPreview {
  exportedAt: string
  trips: { id: string; name: string; expenses: number; exists: boolean }[]
  totalExpenses: number
  totalPayments: number
  newTrips: number
  existingTrips: number
  newCategories: number
}

export async function previewImport(backup: BackupFile): Promise<ImportPreview> {
  const existingTripIds = new Set(await db.trips.toCollection().primaryKeys())
  const existingCats = new Set(await db.categories.toCollection().primaryKeys())
  const trips = backup.data.trips.map((t) => ({
    id: t.id,
    name: t.name,
    expenses: backup.data.expenses.filter((e) => e.tripId === t.id).length,
    exists: existingTripIds.has(t.id),
  }))
  return {
    exportedAt: backup.exportedAt,
    trips,
    totalExpenses: backup.data.expenses.length,
    totalPayments: backup.data.settlements.length,
    newTrips: trips.filter((t) => !t.exists).length,
    existingTrips: trips.filter((t) => t.exists).length,
    newCategories: backup.data.categories.filter((c) => !existingCats.has(c.id)).length,
  }
}

const allTables = () => [
  db.trips,
  db.travellers,
  db.expenses,
  db.expenseShares,
  db.settlements,
  db.receipts,
  db.categories,
  db.settings,
  db.outbox,
  db.syncCursors,
  db.members,
]

/** Adds trips and categories that are not present yet. Never overwrites. */
export function importMerge(backup: BackupFile): Promise<{ addedTrips: number; skippedTrips: number }> {
  return trackSave(() =>
    db.transaction('rw', allTables(), async () => {
      const { data } = backup
      const existingTripIds = new Set(await db.trips.toCollection().primaryKeys())
      const existingCats = new Set(await db.categories.toCollection().primaryKeys())
      const newTrips = data.trips.filter((t) => !existingTripIds.has(t.id))
      const ids = new Set(newTrips.map((t) => t.id))
      // A record ID colliding with a different trip's record would be a corrupted mix; refuse.
      const travellers = data.travellers.filter((t) => ids.has(t.tripId))
      const expenses = data.expenses.filter((e) => ids.has(e.tripId))
      const shares = data.expenseShares.filter((s) => ids.has(s.tripId))
      const payments = data.settlements.filter((s) => ids.has(s.tripId))
      const clash =
        (await db.travellers.bulkGet(travellers.map((t) => t.id))).some(Boolean) ||
        (await db.expenses.bulkGet(expenses.map((e) => e.id))).some(Boolean) ||
        (await db.expenseShares.bulkGet(shares.map((s) => s.id))).some(Boolean) ||
        (await db.settlements.bulkGet(payments.map((s) => s.id))).some(Boolean)
      if (clash) throw new Error('Some records in this backup clash with existing data. Use "Replace all data" instead.')
      // A backup category with the same name as a local one is merged into it.
      const localByName = new Map((await db.categories.toArray()).map((c) => [c.name.toLowerCase(), c.id]))
      const categoryIdMap = new Map<string, string>()
      const newCategories = []
      for (const c of data.categories) {
        if (existingCats.has(c.id) || (c.tripId !== null && !ids.has(c.tripId))) continue
        const sameName = localByName.get(c.name.toLowerCase())
        if (sameName) categoryIdMap.set(c.id, sameName)
        else newCategories.push(c)
      }
      await db.categories.bulkAdd(newCategories)
      await db.trips.bulkAdd(
        newTrips.map((t) => {
          if (!t.categoryBudgets) return t
          // Budgets follow their category when it was merged into a local one with the same name.
          const budgets = Object.fromEntries(Object.entries(t.categoryBudgets).map(([id, v]) => [categoryIdMap.get(id) ?? id, v]))
          return { ...t, categoryBudgets: budgets }
        }),
      )
      await db.travellers.bulkAdd(travellers)
      await db.expenses.bulkAdd(expenses.map((e) => ({ ...e, categoryId: categoryIdMap.get(e.categoryId) ?? e.categoryId })))
      await db.expenseShares.bulkAdd(shares)
      await db.settlements.bulkAdd(payments)
      const settings = (await db.settings.get('app')) ?? defaultSettings()
      await db.settings.put({ ...settings, changesSinceBackup: settings.changesSinceBackup + 1 })
      return { addedTrips: newTrips.length, skippedTrips: data.trips.length - newTrips.length }
    }),
  )
}

/** Replaces all app data with the backup, atomically. */
export function importReplace(backup: BackupFile): Promise<void> {
  return trackSave(() =>
    db.transaction('rw', allTables(), async () => {
      const { data } = backup
      if ((await db.outbox.count()) > 0) {
        throw new Error('Some changes to shared trips have not been uploaded yet. Go online and let them sync first.')
      }
      await Promise.all(allTables().map((t) => t.clear()))
      await db.categories.bulkAdd(data.categories)
      const present = new Set(data.categories.map((c) => c.id))
      await db.categories.bulkAdd(seedCategories(new Date().toISOString()).filter((c) => !present.has(c.id)))
      await db.trips.bulkAdd(data.trips)
      await db.travellers.bulkAdd(data.travellers)
      await db.expenses.bulkAdd(data.expenses)
      await db.expenseShares.bulkAdd(data.expenseShares)
      await db.settlements.bulkAdd(data.settlements)
      const imported = data.settings ?? defaultSettings()
      await db.settings.put({
        ...defaultSettings(),
        defaultBaseCurrency: imported.defaultBaseCurrency,
        lastBackupAt: new Date().toISOString(),
      })
    }),
  )
}
