/** Converts between local (Dexie) records and server rows. */
import { PAYMENT_METHODS, SPLIT_MODES, type Expense, type ExpenseShare, type Traveller, type Trip } from '../types/domain'
import type { RemoteExpenseRow, RemoteTravellerRow, RemoteTripRow } from './remote'

export function tripToRemote(t: Trip, ownerId: string): RemoteTripRow {
  return {
    id: t.id,
    owner_id: ownerId,
    name: t.name,
    destination: t.destination,
    start_date: t.startDate,
    end_date: t.endDate,
    base_currency: t.baseCurrency,
    budget_minor: t.budgetMinorUnits,
    status: t.status,
    created_at: t.createdAt,
  }
}

export function tripFromRemote(r: RemoteTripRow): Trip {
  return {
    id: r.id,
    name: r.name,
    destination: r.destination,
    startDate: r.start_date,
    endDate: r.end_date,
    baseCurrency: r.base_currency,
    budgetMinorUnits: Number(r.budget_minor),
    status: r.status,
    syncMode: 'cloud',
    ownerId: r.owner_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
  }
}

export function travellerToRemote(t: Traveller): RemoteTravellerRow {
  return {
    id: t.id,
    trip_id: t.tripId,
    display_name: t.displayName,
    user_id: t.userId ?? null,
    created_at: t.createdAt,
  }
}

export function travellerFromRemote(r: RemoteTravellerRow): Traveller {
  return {
    id: r.id,
    tripId: r.trip_id,
    displayName: r.display_name,
    userId: r.user_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at ?? r.created_at,
  }
}

export function expenseToRemote(e: Expense, shares: ExpenseShare[], categoryName: string): RemoteExpenseRow {
  return {
    id: e.id,
    trip_id: e.tripId,
    description: e.description,
    date: e.date,
    original_amount_minor: e.originalAmountMinorUnits,
    original_currency: e.originalCurrency,
    exchange_rate: e.exchangeRate,
    base_amount_minor: e.baseAmountMinorUnits,
    base_currency: e.baseCurrency,
    category_id: e.categoryId,
    category_name: categoryName,
    payment_method: e.paymentMethod,
    payment_account_note: e.paymentAccountNote,
    payer_traveller_id: e.payerTravellerId,
    payer_name_snapshot: e.payerNameSnapshot,
    notes: e.notes,
    split_mode: e.splitMode,
    shares: shares.map((s) => ({
      travellerId: s.travellerId,
      name: s.travellerNameSnapshot,
      amount: s.allocatedBaseAmountMinorUnits,
      ...(s.weight ? { weight: s.weight } : {}),
    })),
    created_at: e.createdAt,
  }
}

/** Server row → local expense plus share rows (share ids are derived, so re-pulls are idempotent). */
export function expenseFromRemote(r: RemoteExpenseRow): { expense: Expense; shares: ExpenseShare[] } {
  const paymentMethod = (PAYMENT_METHODS as readonly string[]).includes(r.payment_method)
    ? (r.payment_method as Expense['paymentMethod'])
    : 'other'
  const splitMode = (SPLIT_MODES as readonly string[]).includes(r.split_mode)
    ? (r.split_mode as Expense['splitMode'])
    : 'custom_amount'
  return {
    expense: {
      id: r.id,
      tripId: r.trip_id,
      description: r.description,
      date: r.date,
      originalAmountMinorUnits: Number(r.original_amount_minor),
      originalCurrency: r.original_currency,
      exchangeRate: r.exchange_rate,
      baseAmountMinorUnits: Number(r.base_amount_minor),
      baseCurrency: r.base_currency,
      categoryId: r.category_id,
      paymentMethod,
      paymentAccountNote: r.payment_account_note,
      payerTravellerId: r.payer_traveller_id,
      payerNameSnapshot: r.payer_name_snapshot,
      notes: r.notes,
      splitMode,
      createdAt: r.created_at,
      updatedAt: r.updated_at ?? r.created_at,
    },
    shares: r.shares.map((s, i) => ({
      id: `${r.id}:${i}`,
      expenseId: r.id,
      tripId: r.trip_id,
      travellerId: s.travellerId,
      travellerNameSnapshot: s.name,
      allocatedBaseAmountMinorUnits: Number(s.amount),
      ...(s.weight ? { weight: s.weight } : {}),
    })),
  }
}
