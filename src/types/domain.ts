/**
 * Domain model for the Travel Expense Tracker.
 *
 * Storage conventions (also used verbatim in the JSON backup format):
 * - IDs are random UUID strings.
 * - Money is stored as integer *minor units* (e.g. sen for MYR, yen for JPY)
 *   in plain JS numbers. All values are validated to be safe integers, so
 *   addition and subtraction are exact. Never store floating-point amounts.
 * - Exchange rates are stored as normalised decimal strings (e.g. "0.0312")
 *   meaning "1 unit of originalCurrency = <rate> units of baseCurrency".
 *   Conversion uses BigInt arithmetic, see src/lib/money/money.ts.
 * - Dates are ISO calendar dates "YYYY-MM-DD" (no time zone).
 * - Timestamps are ISO 8601 date-time strings.
 */

export type ID = string
/** ISO 4217 three-letter currency code, upper case. */
export type CurrencyCode = string
/** Calendar date "YYYY-MM-DD". */
export type ISODate = string
/** ISO 8601 timestamp. */
export type ISODateTime = string

export type TripStatus = 'active' | 'completed'

/**
 * - local: stored only in this browser (the default, and all v1 trips).
 * - cloud: shared through Supabase; changes sync between members' devices.
 */
export type SyncMode = 'local' | 'cloud'

export interface Trip {
  id: ID
  name: string
  destination: string
  startDate: ISODate
  endDate: ISODate
  baseCurrency: CurrencyCode
  /** Budget in minor units of baseCurrency. 0 means "no budget set". */
  budgetMinorUnits: number
  status: TripStatus
  /** True for trips created by "Load sample data". */
  isSample?: boolean
  /** Missing means 'local'. */
  syncMode?: SyncMode
  /** Supabase user id of the owner, for cloud trips. */
  ownerId?: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface Traveller {
  id: ID
  tripId: ID
  displayName: string
  /** Supabase user id of the member this traveller represents (cloud trips). */
  userId?: string | null
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export const PAYMENT_METHODS = [
  'cash',
  'credit_card',
  'debit_card',
  'ewallet',
  'bank_transfer',
  'other',
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  credit_card: 'Credit Card',
  debit_card: 'Debit Card',
  ewallet: 'E-wallet',
  bank_transfer: 'Bank Transfer',
  other: 'Other',
}

/**
 * - personal: the whole amount is assigned to one traveller.
 * - equal: split equally between the selected participants.
 * - custom_amount: each participant gets an explicit amount.
 * - custom_weight: each participant gets a whole number of shares.
 */
export const SPLIT_MODES = ['personal', 'equal', 'custom_amount', 'custom_weight'] as const
export type SplitMode = (typeof SPLIT_MODES)[number]

export interface Expense {
  id: ID
  tripId: ID
  description: string
  date: ISODate
  /** Amount as entered, in minor units of originalCurrency. */
  originalAmountMinorUnits: number
  originalCurrency: CurrencyCode
  /** "1 originalCurrency = exchangeRate baseCurrency". "1" when currencies match. */
  exchangeRate: string
  /** Converted amount in minor units of baseCurrency, rounded half-up once at save time. */
  baseAmountMinorUnits: number
  baseCurrency: CurrencyCode
  categoryId: ID
  paymentMethod: PaymentMethod
  /** Optional free-text label such as "Maybank Visa". Never card numbers. */
  paymentAccountNote: string
  payerTravellerId: ID
  /** Name of the payer at the time of saving, kept for historical reports. */
  payerNameSnapshot: string
  notes: string
  splitMode: SplitMode
  /** Supabase user ids of who first added / last changed it (shared trips only). */
  createdBy?: string
  updatedBy?: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * A recorded payment towards settling up: `fromTravellerId` paid
 * `toTravellerId` this amount. Integer minor units of the trip base currency.
 * Balances and the "who pays whom" suggestions take these into account.
 */
export interface Settlement {
  id: ID
  tripId: ID
  fromTravellerId: ID
  toTravellerId: ID
  amountMinorUnits: number
  paidOn: ISODate
  note: string
  /** Supabase user id of who recorded it (shared trips only). */
  createdBy?: string
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

export interface ExpenseShare {
  id: ID
  expenseId: ID
  tripId: ID
  travellerId: ID
  travellerNameSnapshot: string
  /** This traveller's share in minor units of the expense's baseCurrency. */
  allocatedBaseAmountMinorUnits: number
  /** Only for custom_weight splits: the number of shares assigned. */
  weight?: number
}

export interface Category {
  id: ID
  /** null = global category available to every trip. */
  tripId: ID | null
  name: string
  isCustom: boolean
  createdAt: ISODateTime
}

export type SyncTable = 'trips' | 'travellers' | 'expenses' | 'settlements'

/**
 * A local change to a cloud trip that has not been uploaded yet. Keyed by
 * table + record id, so several edits to one record upload once.
 */
export interface OutboxEntry {
  key: string
  table: SyncTable
  recordId: ID
  tripId: ID
  op: 'upsert' | 'delete'
  queuedAt: ISODateTime
  /** Set when the server rejected this change; it is skipped until retried. */
  error?: string
}

/** Per cloud trip: the newest server updated_at already downloaded. */
export interface SyncCursor {
  tripId: ID
  pulledUntil: ISODateTime | null
}

export interface TripMember {
  tripId: ID
  userId: string
  role: 'owner' | 'member'
  email: string | null
  joinedAt: ISODateTime
}

export interface AppSettings {
  id: 'app'
  schemaVersion: number
  defaultBaseCurrency: CurrencyCode
  /** Number of data changes since the last JSON backup was downloaded. */
  changesSinceBackup: number
  lastBackupAt: ISODateTime | null
  /** Hide the backup reminder until changesSinceBackup reaches this value. */
  backupReminderSnoozedUntil: number
}

export const SEED_CATEGORIES: { id: ID; name: string }[] = [
  { id: 'cat-transport', name: 'Transport' },
  { id: 'cat-accommodation', name: 'Accommodation' },
  { id: 'cat-food', name: 'Food & Drinks' },
  { id: 'cat-shopping', name: 'Shopping' },
  { id: 'cat-activities', name: 'Activities' },
  { id: 'cat-insurance', name: 'Travel Insurance' },
  { id: 'cat-sim', name: 'SIM & Internet' },
  { id: 'cat-health', name: 'Health & Essentials' },
  { id: 'cat-misc', name: 'Miscellaneous' },
]

export const MISC_CATEGORY_ID = 'cat-misc'
