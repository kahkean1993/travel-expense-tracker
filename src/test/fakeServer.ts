/**
 * In-memory stand-in for the Supabase backend, enforcing the same rules as
 * supabase/migrations (membership, owner-only deletion, share totals,
 * server-assigned updated_at). Used to test the sync engine with several
 * simulated devices. The real SQL rules are tested in supabase/tests.
 */
import {
  RemoteError,
  type ChildRow,
  type ChildTable,
  type InvitePreview,
  type Remote,
  type RemoteExpenseRow,
  type RemoteMemberRow,
  type RemoteTravellerRow,
  type RemoteTripRow,
} from '../sync/remote'

type Stored<T> = T & { updated_at: string; deleted_at: string | null }

export class FakeServer {
  online = true
  private tick = Date.parse('2026-03-01T00:00:00Z')
  trips = new Map<string, Stored<RemoteTripRow>>()
  members: RemoteMemberRow[] = []
  invites = new Map<string, { tripId: string; revoked: boolean }>()
  travellers = new Map<string, Stored<RemoteTravellerRow>>()
  expenses = new Map<string, Stored<RemoteExpenseRow>>()

  /** Strictly increasing server clock. */
  now() {
    this.tick += 1000
    return new Date(this.tick).toISOString()
  }

  device(userId: string | null, email = `${userId}@example.test`) {
    return new FakeRemote(this, userId, email)
  }
}

const clone = <T>(v: T): T => structuredClone(v)

export class FakeRemote implements Remote {
  constructor(
    private server: FakeServer,
    public userId: string | null,
    private email: string,
  ) {}

  currentUserId() {
    return this.userId
  }

  private table<T extends ChildTable>(table: T) {
    const map = table === 'travellers' ? this.server.travellers : this.server.expenses
    return map as unknown as Map<string, Stored<ChildRow<T>>>
  }

  private check() {
    if (!this.server.online) throw new RemoteError('network', 'Failed to fetch')
    if (!this.userId) throw new RemoteError('auth', 'Not signed in')
    return this.userId
  }
  private isMember(tripId: string) {
    return this.server.members.some((m) => m.trip_id === tripId && m.user_id === this.userId)
  }
  private assertMember(tripId: string) {
    if (!this.isMember(tripId)) throw new RemoteError('rejected', 'new row violates row-level security policy')
    if (this.server.trips.get(tripId)?.deleted_at) throw new RemoteError('rejected', 'This trip has been deleted')
  }

  async listMyTripIds() {
    const me = this.check()
    return this.server.members.filter((m) => m.user_id === me).map((m) => m.trip_id)
  }

  async fetchTrip(tripId: string) {
    this.check()
    const t = this.server.trips.get(tripId)
    return t && this.isMember(tripId) ? clone(t) : null
  }

  async fetchChanged<T extends ChildTable>(table: T, tripId: string, since: string | null) {
    this.check()
    if (!this.isMember(tripId)) return []
    const source = this.table(table)
    return [...source.values()].filter((r) => r.trip_id === tripId && (!since || r.updated_at > since)).map(clone)
  }

  async fetchMembers(tripId: string) {
    this.check()
    return this.isMember(tripId) ? clone(this.server.members.filter((m) => m.trip_id === tripId)) : []
  }

  async insertTrip(row: RemoteTripRow) {
    const me = this.check()
    if (row.owner_id !== me || this.server.trips.has(row.id)) {
      throw new RemoteError('rejected', 'new row violates row-level security policy')
    }
    this.server.trips.set(row.id, { ...clone(row), updated_at: this.server.now(), deleted_at: null })
    this.server.members.push({ trip_id: row.id, user_id: me, role: 'owner', email: this.email, joined_at: this.server.now() })
  }

  async updateTrip(row: RemoteTripRow) {
    this.check()
    this.assertMember(row.id)
    const existing = this.server.trips.get(row.id)!
    this.server.trips.set(row.id, {
      ...clone(row),
      owner_id: existing.owner_id,
      created_at: existing.created_at,
      updated_at: this.server.now(),
      deleted_at: existing.deleted_at,
    })
  }

  async upsert<T extends ChildTable>(table: T, rows: ChildRow<T>[]) {
    this.check()
    const target = this.table(table)
    // Validate the whole batch first: the real request is all-or-nothing.
    for (const row of rows) {
      this.assertMember(row.trip_id)
      const existing = target.get(row.id)
      if (existing && existing.trip_id !== row.trip_id) throw new RemoteError('rejected', 'trip_id cannot change')
      if (table === 'expenses') {
        const e = row as RemoteExpenseRow
        const sum = e.shares.reduce((s, x) => s + x.amount, 0)
        if (sum !== e.base_amount_minor) throw new RemoteError('rejected', 'violates check constraint "expenses_shares_check"')
        if (!this.server.travellers.has(e.payer_traveller_id)) {
          throw new RemoteError('rejected', 'violates foreign key constraint "expenses_payer_traveller_id_fkey"')
        }
      }
    }
    for (const row of rows) {
      const existing = target.get(row.id)
      target.set(row.id, {
        ...clone(row),
        created_at: existing?.created_at ?? row.created_at,
        updated_at: this.server.now(),
        deleted_at: existing?.deleted_at ?? null,
      } as Stored<ChildRow<T>>)
    }
  }

  async softDelete(table: 'trips' | ChildTable, ids: string[]) {
    const me = this.check()
    const target =
      table === 'trips' ? this.server.trips : table === 'travellers' ? this.server.travellers : this.server.expenses
    for (const id of ids) {
      const row = target.get(id) as Stored<{ trip_id?: string; owner_id?: string; id: string }> | undefined
      if (!row) continue
      const tripId = table === 'trips' ? id : row.trip_id!
      if (!this.isMember(tripId)) continue // RLS: silently matches no rows
      if (table === 'trips' && row.owner_id !== me) throw new RemoteError('rejected', 'Only the trip owner can delete this trip')
      row.deleted_at = this.server.now()
      row.updated_at = this.server.now()
    }
  }

  async createInvite(tripId: string) {
    this.check()
    this.assertMember(tripId)
    const token = crypto.randomUUID().replace(/-/g, '')
    this.server.invites.set(token, { tripId, revoked: false })
    return { token, expiresAt: this.server.now() }
  }

  async previewInvite(token: string): Promise<InvitePreview | null> {
    this.check()
    const inv = this.server.invites.get(token)
    const trip = inv && this.server.trips.get(inv.tripId)
    if (!inv || inv.revoked || !trip || trip.deleted_at) return null
    return {
      tripId: trip.id,
      tripName: trip.name,
      memberCount: this.server.members.filter((m) => m.trip_id === trip.id).length,
      alreadyMember: this.isMember(trip.id),
    }
  }

  async acceptInvite(token: string) {
    const me = this.check()
    const preview = await this.previewInvite(token)
    if (!preview) throw new RemoteError('rejected', 'This invite link is invalid, expired or was revoked')
    if (!preview.alreadyMember) {
      this.server.members.push({ trip_id: preview.tripId, user_id: me, role: 'member', email: this.email, joined_at: this.server.now() })
    }
    return preview.tripId
  }

  async removeMember(tripId: string, userId: string) {
    const me = this.check()
    const target = this.server.members.find((m) => m.trip_id === tripId && m.user_id === userId)
    if (!target) return
    const ownerId = this.server.trips.get(tripId)?.owner_id
    const allowed = (userId === me && target.role !== 'owner') || (ownerId === me && userId !== me)
    if (!allowed) return // RLS: no rows deleted
    this.server.members = this.server.members.filter((m) => m !== target)
  }
}
