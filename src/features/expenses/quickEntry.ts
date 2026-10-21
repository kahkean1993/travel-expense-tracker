/**
 * Remembers how the previous expense on a trip was entered (currency,
 * payment method, who paid, who it was split between), so the next one
 * starts from the same place. Stored per trip, only in this browser.
 */
import { isValidCurrencyCode } from '../../lib/money/money'
import { PAYMENT_METHODS, SPLIT_MODES, type ID, type PaymentMethod, type SplitMode, type Traveller, type Trip } from '../../types/domain'
import { emptyExpenseForm, type ExpenseFormValues } from './expenseDraft'

export interface LastEntry {
  currency: string
  paymentMethod: PaymentMethod
  payerId: ID
  splitMode: SplitMode
  participantIds: ID[]
}

const key = (tripId: ID) => `tet:lastEntry:${tripId}`

export function lastEntryFromForm(v: ExpenseFormValues): LastEntry {
  return {
    currency: v.currency.trim().toUpperCase(),
    paymentMethod: v.paymentMethod,
    payerId: v.payerId,
    splitMode: v.splitMode,
    participantIds: v.participantIds,
  }
}

export function saveLastEntry(tripId: ID, entry: LastEntry) {
  try {
    localStorage.setItem(key(tripId), JSON.stringify(entry))
  } catch {
    // Remembering is a convenience; ignore storage problems.
  }
}

export function loadLastEntry(tripId: ID): LastEntry | null {
  try {
    const raw = localStorage.getItem(key(tripId))
    if (!raw) return null
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return null
    const e = v as Record<string, unknown>
    if (
      typeof e.currency !== 'string' ||
      typeof e.payerId !== 'string' ||
      !(PAYMENT_METHODS as readonly string[]).includes(e.paymentMethod as string) ||
      !(SPLIT_MODES as readonly string[]).includes(e.splitMode as string) ||
      !Array.isArray(e.participantIds) ||
      !e.participantIds.every((p) => typeof p === 'string')
    ) {
      return null
    }
    return e as unknown as LastEntry
  } catch {
    return null
  }
}

/**
 * Starting values for a new expense. Whatever was remembered is checked
 * against the trip as it is now (travellers may have been removed).
 * On a shared trip the signed-in person is the default payer.
 */
export function initialValues(
  trip: Trip,
  travellers: Traveller[],
  today: string,
  last: LastEntry | null,
  options: { myTravellerId?: ID | undefined; rateFor: (currency: string) => string | null },
): ExpenseFormValues {
  const blank = emptyExpenseForm(trip, travellers, today)
  const valid = new Set(travellers.map((t) => t.id))
  const everyone = travellers.map((t) => t.id)
  const payerId = options.myTravellerId ?? (last && valid.has(last.payerId) ? last.payerId : blank.payerId)

  const values: ExpenseFormValues = { ...blank, payerId }
  if (last) {
    const currency = last.currency
    if (isValidCurrencyCode(currency)) {
      values.currency = currency
      values.rate = currency === trip.baseCurrency ? '1' : (options.rateFor(currency) ?? '')
    }
    values.paymentMethod = last.paymentMethod
    if (travellers.length > 1) {
      const people = last.participantIds.filter((id) => valid.has(id))
      values.splitMode = last.splitMode === 'custom_amount' ? 'equal' : last.splitMode // amounts don't carry over
      values.participantIds = people.length > 0 ? people : everyone
      if (values.splitMode === 'personal') values.participantIds = [people[0] ?? payerId]
    }
  }
  if (travellers.length < 2) {
    values.splitMode = 'personal'
    values.participantIds = [payerId]
  } else if (!last && options.myTravellerId) {
    values.participantIds = values.splitMode === 'personal' ? [payerId] : values.participantIds
  }
  return values
}
