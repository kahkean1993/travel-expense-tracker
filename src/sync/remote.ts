/**
 * The server side of sync, as the engine sees it. Row shapes mirror the
 * Supabase tables in supabase/migrations (snake_case, integer minor units).
 * src/sync/supabaseRemote.ts implements this with supabase-js; tests use an
 * in-memory implementation.
 */

export interface RemoteTripRow {
  id: string
  owner_id: string
  name: string
  destination: string
  start_date: string
  end_date: string
  base_currency: string
  budget_minor: number
  status: 'active' | 'completed'
  created_at: string
  updated_at?: string
  deleted_at?: string | null
}

export interface RemoteTravellerRow {
  id: string
  trip_id: string
  display_name: string
  user_id: string | null
  created_at: string
  updated_at?: string
  deleted_at?: string | null
}

export interface RemoteShare {
  travellerId: string
  name: string
  amount: number
  weight?: number
}

export interface RemoteExpenseRow {
  id: string
  trip_id: string
  description: string
  date: string
  original_amount_minor: number
  original_currency: string
  exchange_rate: string
  base_amount_minor: number
  base_currency: string
  category_id: string
  category_name: string
  payment_method: string
  payment_account_note: string
  payer_traveller_id: string
  payer_name_snapshot: string
  notes: string
  split_mode: string
  shares: RemoteShare[]
  created_at: string
  updated_at?: string
  deleted_at?: string | null
}

export interface RemoteMemberRow {
  trip_id: string
  user_id: string
  role: 'owner' | 'member'
  email: string | null
  joined_at: string
}

export interface InvitePreview {
  tripId: string
  tripName: string
  memberCount: number
  alreadyMember: boolean
}

export type ChildTable = 'travellers' | 'expenses'
export type ChildRow<T extends ChildTable> = T extends 'travellers' ? RemoteTravellerRow : RemoteExpenseRow

/**
 * - network: no connection or the server could not be reached; retry later.
 * - auth: the session is missing or expired; the user must sign in again.
 * - rejected: the server refused this change (permissions or validation).
 */
export class RemoteError extends Error {
  constructor(
    public kind: 'network' | 'auth' | 'rejected',
    message: string,
  ) {
    super(message)
    this.name = 'RemoteError'
  }
}

export interface Remote {
  /** The signed-in user's id, or null when signed out. */
  currentUserId(): string | null
  /** Ids of all trips the signed-in user is a member of. */
  listMyTripIds(): Promise<string[]>
  fetchTrip(tripId: string): Promise<RemoteTripRow | null>
  /** Rows changed after `since` (all rows when null), including soft-deleted ones. */
  fetchChanged<T extends ChildTable>(table: T, tripId: string, since: string | null): Promise<ChildRow<T>[]>
  fetchMembers(tripId: string): Promise<RemoteMemberRow[]>
  /** Creates a trip owned by the signed-in user. */
  insertTrip(row: RemoteTripRow): Promise<void>
  updateTrip(row: RemoteTripRow): Promise<void>
  upsert<T extends ChildTable>(table: T, rows: ChildRow<T>[]): Promise<void>
  softDelete(table: 'trips' | ChildTable, ids: string[]): Promise<void>
  createInvite(tripId: string): Promise<{ token: string; expiresAt: string }>
  previewInvite(token: string): Promise<InvitePreview | null>
  acceptInvite(token: string): Promise<string>
  removeMember(tripId: string, userId: string): Promise<void>
}
