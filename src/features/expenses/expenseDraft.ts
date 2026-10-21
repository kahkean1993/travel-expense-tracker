/**
 * Pure validation + calculation for the expense form. Turns raw form text
 * into an Expense record and its shares, or field-level error messages.
 */
import type { ExpenseRecord, ShareRecord } from '../../db/repositories'
import {
  convertMinorUnits,
  isValidCurrencyCode,
  normaliseCurrencyCode,
  parseAmountToMinor,
  parseExchangeRate,
} from '../../lib/money/money'
import type { Expense, ExpenseShare, ID, PaymentMethod, SplitMode, Traveller, Trip } from '../../types/domain'
import { computeAllocation, type Allocation } from '../splitting/allocate'

export interface ExpenseFormValues {
  amount: string
  currency: string
  rate: string
  description: string
  date: string
  categoryId: ID
  paymentMethod: PaymentMethod
  paymentAccountNote: string
  payerId: ID
  notes: string
  splitMode: SplitMode
  /** For "personal": the single person. For other modes: all selected people. */
  participantIds: ID[]
  customAmounts: Record<ID, string>
  weights: Record<ID, string>
}

export type ExpenseField = keyof ExpenseFormValues | 'split'
export type FieldErrors = Partial<Record<ExpenseField, string>>

export interface ExpenseEvaluation {
  errors: FieldErrors
  /** Converted total in base minor units, when amount/rate are valid. */
  baseAmount: number | null
  allocation: Allocation[] | null
  /** Sum of entered custom amounts (custom_amount mode only). */
  customSum: number | null
  result: { record: ExpenseRecord; shares: ShareRecord[] } | null
}

export function emptyExpenseForm(trip: Trip, travellers: Traveller[], today: string): ExpenseFormValues {
  const first = travellers[0]?.id ?? ''
  return {
    amount: '',
    currency: trip.baseCurrency,
    rate: '1',
    description: '',
    date: today,
    categoryId: '',
    paymentMethod: 'cash',
    paymentAccountNote: '',
    payerId: first,
    notes: '',
    splitMode: travellers.length > 1 ? 'equal' : 'personal',
    participantIds: travellers.length > 1 ? travellers.map((t) => t.id) : [first],
    customAmounts: {},
    weights: {},
  }
}

/** Fills the form from a saved expense (for edit or duplicate). */
export function formFromExpense(e: Expense, shares: ExpenseShare[], amountText: (minor: number, cur: string) => string): ExpenseFormValues {
  const customAmounts: Record<ID, string> = {}
  const weights: Record<ID, string> = {}
  for (const s of shares) {
    customAmounts[s.travellerId] = amountText(s.allocatedBaseAmountMinorUnits, e.baseCurrency)
    if (s.weight) weights[s.travellerId] = String(s.weight)
  }
  return {
    amount: amountText(e.originalAmountMinorUnits, e.originalCurrency),
    currency: e.originalCurrency,
    rate: e.exchangeRate,
    description: e.description,
    date: e.date,
    categoryId: e.categoryId,
    paymentMethod: e.paymentMethod,
    paymentAccountNote: e.paymentAccountNote,
    payerId: e.payerTravellerId,
    notes: e.notes,
    splitMode: e.splitMode,
    participantIds: shares.map((s) => s.travellerId),
    customAmounts,
    weights,
  }
}

export function evaluateExpenseForm(v: ExpenseFormValues, trip: Trip, travellers: Traveller[]): ExpenseEvaluation {
  const errors: FieldErrors = {}
  const names = new Map(travellers.map((t) => [t.id, t.displayName]))

  const currency = normaliseCurrencyCode(v.currency)
  let originalMinor: number | null = null
  if (!isValidCurrencyCode(currency)) {
    errors.currency = 'Enter a valid 3-letter currency code, e.g. JPY.'
  } else {
    const amount = parseAmountToMinor(v.amount, currency)
    if (amount.ok) originalMinor = amount.value
    else errors.amount = amount.error
  }

  const sameCurrency = currency === trip.baseCurrency
  let rate = '1'
  if (!sameCurrency && !errors.currency) {
    const parsed = parseExchangeRate(v.rate)
    if (parsed.ok) rate = parsed.value
    else errors.rate = parsed.error
  }

  let baseAmount: number | null = null
  if (originalMinor !== null && !errors.rate && !errors.currency) {
    try {
      baseAmount = convertMinorUnits(originalMinor, currency, trip.baseCurrency, rate)
      if (baseAmount === 0) errors.rate = `This converts to 0 ${trip.baseCurrency}. Check the amount and rate.`
    } catch (e) {
      errors.amount = e instanceof Error ? e.message : 'Amount cannot be converted.'
    }
  }

  if (!v.description.trim()) errors.description = 'Add a short description, e.g. "Train to Kyoto".'
  else if (v.description.trim().length > 200) errors.description = 'Keep the description under 200 characters.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) errors.date = 'Choose a date.'
  if (!v.categoryId) errors.categoryId = 'Choose a category.'
  if (!names.has(v.payerId)) errors.payerId = 'Choose who paid.'
  if (v.notes.length > 2000) errors.notes = 'Notes are limited to 2000 characters.'
  if (/\d{12,}/.test(v.paymentAccountNote.replace(/[\s-]/g, ''))) {
    errors.paymentAccountNote = 'Do not enter card or account numbers. Use a nickname like "Maybank Visa".'
  }

  const participants = v.participantIds.filter((id) => names.has(id))
  let allocation: Allocation[] | null = null
  let customSum: number | null = null
  if (baseAmount !== null && baseAmount > 0) {
    const customAmounts: Record<ID, number> = {}
    const weights: Record<ID, number> = {}
    let customError: string | null = null
    if (v.splitMode === 'custom_amount') {
      customSum = 0
      for (const id of participants) {
        const text = (v.customAmounts[id] ?? '').trim()
        const parsed = parseAmountToMinor(text === '' ? '0' : text, trip.baseCurrency, { allowZero: true })
        if (!parsed.ok) customError = `${names.get(id)}: ${parsed.error}`
        else {
          customAmounts[id] = parsed.value
          customSum += parsed.value
        }
      }
    }
    if (v.splitMode === 'custom_weight') {
      for (const id of participants) {
        const text = (v.weights[id] ?? '1').trim()
        weights[id] = /^\d+$/.test(text) ? Number(text) : NaN
      }
    }
    const result = customError
      ? { ok: false as const, error: customError }
      : computeAllocation({
          mode: v.splitMode,
          total: baseAmount,
          participantIds: v.splitMode === 'personal' ? participants.slice(0, 1) : participants,
          customAmounts,
          weights,
        })
    if (result.ok) allocation = result.value
    else errors.split = result.error
  } else if (participants.length === 0) {
    errors.split = 'Choose at least one person.'
  }

  const valid = Object.keys(errors).length === 0 && baseAmount !== null && allocation !== null && originalMinor !== null
  return {
    errors,
    baseAmount,
    allocation,
    customSum,
    result: valid
      ? {
          record: {
            tripId: trip.id,
            description: v.description.trim(),
            date: v.date,
            originalAmountMinorUnits: originalMinor!,
            originalCurrency: currency,
            exchangeRate: sameCurrency ? '1' : rate,
            baseAmountMinorUnits: baseAmount!,
            baseCurrency: trip.baseCurrency,
            categoryId: v.categoryId,
            paymentMethod: v.paymentMethod,
            paymentAccountNote: v.paymentAccountNote.trim(),
            payerTravellerId: v.payerId,
            payerNameSnapshot: names.get(v.payerId) ?? '',
            notes: v.notes.trim(),
            splitMode: v.splitMode,
          },
          shares: allocation!.map((a) => ({
            travellerId: a.travellerId,
            travellerNameSnapshot: names.get(a.travellerId) ?? '',
            allocatedBaseAmountMinorUnits: a.amount,
            ...(v.splitMode === 'custom_weight' && a.weight ? { weight: a.weight } : {}),
          })),
        }
      : null,
  }
}
