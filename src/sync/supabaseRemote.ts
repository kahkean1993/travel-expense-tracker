/** Remote implementation backed by supabase-js (tables in supabase/migrations). */
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  RemoteError,
  type ChildRow,
  type ChildTable,
  type Invite,
  type InvitePreview,
  type InviteTraveller,
  type JoinPick,
  type Remote,
  type RemoteMemberRow,
  type RemoteTripRow,
} from './remote'

/** PostgREST returns at most this many rows per request by default. */
const PAGE = 1000

interface ApiError {
  message: string
  code?: string
}

/** Maps a supabase-js error to network / auth / rejected. */
export function toRemoteError(error: ApiError, status?: number): RemoteError {
  const text = `${error.message} ${error.code ?? ''}`
  if (
    status === 0 ||
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    /Failed to fetch|NetworkError|Load failed|network|timed out|ECONNREFUSED/i.test(error.message)
  ) {
    return new RemoteError('network', 'Could not reach the sync server.')
  }
  if (status === 401 || /JWT|PGRST30[123]/.test(text)) {
    return new RemoteError('auth', 'Your sign-in has expired.')
  }
  return new RemoteError('rejected', error.message || 'The server rejected this change.')
}

type Result<T> = { data: T | null; error: ApiError | null; status?: number }

function unwrap<T>(result: Result<T>): T {
  if (result.error) throw toRemoteError(result.error, result.status)
  return result.data as T
}

/** Runs a call, turning thrown fetch errors into RemoteErrors too. */
async function call<T>(run: () => PromiseLike<Result<T>>): Promise<T> {
  try {
    return unwrap(await run())
  } catch (error) {
    if (error instanceof RemoteError) throw error
    throw toRemoteError({ message: error instanceof Error ? error.message : String(error) }, 0)
  }
}

export class SupabaseRemote implements Remote {
  private userId: string | null = null

  constructor(readonly client: SupabaseClient) {}

  setUser(userId: string | null) {
    this.userId = userId
  }

  currentUserId() {
    return this.userId
  }

  async listMyTripIds() {
    const rows = await call<{ trip_id: string }[]>(() =>
      this.client.from('trip_members').select('trip_id').eq('user_id', this.userId!),
    )
    return rows.map((r) => r.trip_id)
  }

  fetchTrip(tripId: string) {
    return call<RemoteTripRow | null>(() => this.client.from('trips').select('*').eq('id', tripId).maybeSingle())
  }

  async fetchChanged<T extends ChildTable>(table: T, tripId: string, since: string | null) {
    const all: ChildRow<T>[] = []
    for (let from = 0; ; from += PAGE) {
      const page = await call<ChildRow<T>[]>(() => {
        let q = this.client.from(table).select('*').eq('trip_id', tripId)
        if (since) q = q.gt('updated_at', since)
        return q.order('updated_at').order('id').range(from, from + PAGE - 1)
      })
      all.push(...page)
      if (page.length < PAGE) return all
    }
  }

  fetchMembers(tripId: string) {
    return call<RemoteMemberRow[]>(() => this.client.from('trip_members').select('*').eq('trip_id', tripId))
  }

  async insertTrip(row: RemoteTripRow) {
    await call(() => this.client.from('trips').insert(row))
  }

  async updateTrip(row: RemoteTripRow) {
    // Owner and creation time are fixed on the server.
    const { id, owner_id: _owner, created_at: _created, ...changes } = row
    await call(() => this.client.from('trips').update(changes).eq('id', id))
  }

  async upsert<T extends ChildTable>(table: T, rows: ChildRow<T>[]) {
    await call(() => this.client.from(table).upsert(rows, { onConflict: 'id' }))
  }

  async softDelete(table: 'trips' | ChildTable, ids: string[]) {
    await call(() => this.client.from(table).update({ deleted_at: new Date().toISOString() }).in('id', ids))
  }

  async uploadReceipt(tripId: string, receiptId: string, blob: Blob) {
    const { error } = await this.client.storage.from('receipts').upload(`${tripId}/${receiptId}`, blob, { contentType: blob.type, upsert: true })
    if (error) throw toRemoteError({ message: error.message })
  }

  async downloadReceipt(tripId: string, receiptId: string) {
    const { data, error } = await this.client.storage.from('receipts').download(`${tripId}/${receiptId}`)
    if (error || !data) throw toRemoteError({ message: error?.message ?? 'Could not download the photo.' })
    return data
  }

  async removeReceiptFiles(files: { tripId: string; receiptId: string }[]) {
    await this.client.storage.from('receipts').remove(files.map((f) => `${f.tripId}/${f.receiptId}`))
  }

  async getActiveInvite(tripId: string): Promise<Invite | null> {
    const row = await call<{ token: string; expires_at: string } | null>(() =>
      this.client
        .from('trip_invites')
        .select('token, expires_at')
        .eq('trip_id', tripId)
        .is('revoked_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    )
    return row ? { token: row.token, expiresAt: row.expires_at } : null
  }

  async createInvite(tripId: string): Promise<Invite> {
    const row = await call<{ token: string; expires_at: string }>(() =>
      this.client.from('trip_invites').insert({ trip_id: tripId }).select('token, expires_at').single(),
    )
    return { token: row.token, expiresAt: row.expires_at }
  }

  async revokeInvites(tripId: string) {
    await call(() =>
      this.client.from('trip_invites').update({ revoked_at: new Date().toISOString() }).eq('trip_id', tripId).is('revoked_at', null),
    )
  }

  async previewInvite(token: string): Promise<InvitePreview | null> {
    const rows = await call<
      {
        trip_id: string
        trip_name: string
        member_count: number
        already_member: boolean
        travellers: InviteTraveller[] | null
      }[]
    >(() => this.client.rpc('invite_preview', { p_token: token }))
    const r = rows?.[0]
    return r
      ? {
          tripId: r.trip_id,
          tripName: r.trip_name,
          memberCount: Number(r.member_count),
          alreadyMember: r.already_member,
          travellers: r.travellers ?? [],
        }
      : null
  }

  acceptInvite(token: string, pick: JoinPick = {}) {
    return call<string>(() =>
      this.client.rpc('accept_invite', {
        p_token: token,
        p_traveller_id: pick.travellerId ?? null,
        p_new_traveller_name: pick.newName ?? null,
      }),
    )
  }

  async removeMember(tripId: string, userId: string) {
    await call(() => this.client.from('trip_members').delete().eq('trip_id', tripId).eq('user_id', userId))
  }

  /** Calls `onChange` whenever shared rows visible to this user change. */
  subscribe(onChange: () => void): () => void {
    let channel = this.client.channel('trip-sync')
    for (const table of ['trips', 'trip_members', 'travellers', 'expenses', 'settlements', 'receipts']) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange())
    }
    channel.subscribe()
    return () => {
      void this.client.removeChannel(channel)
    }
  }
}
