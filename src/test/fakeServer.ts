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
  type Invite,
  type InvitePreview,
  type JoinPick,
  type Remote,
  type RemoteExpenseRow,
  type RemoteMemberRow,
  type RemoteReceiptRow,
  type RemoteSettlementRow,
  type RemoteTravellerRow,
  type RemoteTripRow,
} from '../sync/remote'

type Stored<T> = T & { updated_at: string; deleted_at: string | null }

export class FakeServer {
  online = true
  private tick = Date.parse('2026-03-01T00:00:00Z')
  trips = new Map<string, Stored<RemoteTripRow>>()
  members: RemoteMemberRow[] = []
  invites = new Map<string, { tripId: string; revoked: boolean; expiresAt: string; createdAt: string }>()
  /** Users who joined without an email (anonymous sign-in). */
  anonymousUsers = new Set<string>()
  travellers = new Map<string, Stored<RemoteTravellerRow>>()
  expenses = new Map<string, Stored<RemoteExpenseRow>>()
  settlements = new Map<string, Stored<RemoteSettlementRow>>()
  receipts = new Map<string, Stored<RemoteReceiptRow>>()
  /** Receipt files, keyed by "<trip id>/<receipt id>". */
  files = new Map<string, Blob>()

  /** Strictly increasing server clock. */
  now() {
    this.tick += 1000
    return new Date(this.tick).toISOString()
  }

  /** A device signed in as `userId`. Anonymous users have no email and cannot create trips. */
  device(userId: string | null, options: { anonymous?: boolean; email?: string } = {}) {
    if (userId && options.anonymous) this.anonymousUsers.add(userId)
    const email = options.anonymous ? null : (options.email ?? `${userId}@example.test`)
    return new FakeRemote(this, userId, email)
  }
}

const clone = <T>(v: T): T => structuredClone(v)

export class FakeRemote implements Remote {
  constructor(
    private server: FakeServer,
    public userId: string | null,
    private email: string | null,
  ) {}

  currentUserId() {
    return this.userId
  }

  private table<T extends ChildTable>(table: T) {
    const map =
      table === 'travellers'
        ? this.server.travellers
        : table === 'settlements'
          ? this.server.settlements
          : table === 'receipts'
            ? this.server.receipts
            : this.server.expenses
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
    if (this.server.anonymousUsers.has(me) || row.owner_id !== me || this.server.trips.has(row.id)) {
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
      if (table === 'receipts') {
        const r = row as RemoteReceiptRow
        if (this.server.expenses.get(r.expense_id)?.trip_id !== r.trip_id) throw new RemoteError('rejected', 'The expense must be on this trip')
        if (!r.deleted_at) {
          const live = [...this.server.receipts.values()].filter((x) => x.expense_id === r.expense_id && !x.deleted_at && x.id !== r.id)
          if (live.length >= 3) throw new RemoteError('rejected', 'An expense can have at most 3 receipt photos')
        }
        if (!this.server.files.has(`${r.trip_id}/${r.id}`)) throw new RemoteError('rejected', 'The photo file is missing')
      }
      if (table === 'settlements') {
        const s = row as RemoteSettlementRow
        if (s.from_traveller_id === s.to_traveller_id) throw new RemoteError('rejected', 'Someone cannot pay themselves')
        const onTrip = (id: string) => this.server.travellers.get(id)?.trip_id === s.trip_id
        if (!onTrip(s.from_traveller_id) || !onTrip(s.to_traveller_id)) {
          throw new RemoteError('rejected', 'Both people must be on this trip')
        }
        if (!Number.isInteger(s.amount_minor) || s.amount_minor < 1) {
          throw new RemoteError('rejected', 'violates check constraint "settlements_amount_minor_check"')
        }
      }
      if (table === 'expenses') {
        if (this.server.trips.get(row.trip_id)?.status === 'completed') {
          throw new RemoteError('rejected', 'This trip is completed. Reopen it to change expenses')
        }
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
      const author = table === 'travellers' ? {} : { created_by: (existing as { created_by?: string | null } | undefined)?.created_by ?? this.userId }
      target.set(row.id, {
        ...clone(row),
        ...author,
        ...(table === 'expenses' ? { updated_by: this.userId } : {}),
        created_at: existing?.created_at ?? row.created_at,
        updated_at: this.server.now(),
        deleted_at: existing?.deleted_at ?? null,
      } as Stored<ChildRow<T>>)
    }
  }

  async softDelete(table: 'trips' | ChildTable, ids: string[]) {
    const me = this.check()
    const target =
      table === 'trips'
        ? this.server.trips
        : table === 'travellers'
          ? this.server.travellers
          : table === 'settlements'
            ? this.server.settlements
            : table === 'receipts'
              ? this.server.receipts
              : this.server.expenses
    if (table === 'expenses') {
      for (const id of ids) {
        const tripId = this.server.expenses.get(id)?.trip_id
        if (tripId && this.isMember(tripId) && this.server.trips.get(tripId)?.status === 'completed') {
          throw new RemoteError('rejected', 'This trip is completed. Reopen it to change expenses')
        }
      }
    }
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

  async uploadReceipt(tripId: string, receiptId: string, blob: Blob) {
    this.check()
    if (!this.isMember(tripId)) throw new RemoteError('rejected', 'new row violates row-level security policy')
    if (blob.size > 2 * 1024 * 1024) throw new RemoteError('rejected', 'The object exceeded the maximum allowed size')
    this.server.files.set(`${tripId}/${receiptId}`, blob)
  }

  async downloadReceipt(tripId: string, receiptId: string) {
    this.check()
    const file = this.isMember(tripId) ? this.server.files.get(`${tripId}/${receiptId}`) : undefined
    if (!file) throw new RemoteError('rejected', 'Object not found')
    return file
  }

  async removeReceiptFiles(files: { tripId: string; receiptId: string }[]) {
    this.check()
    for (const f of files) if (this.isMember(f.tripId)) this.server.files.delete(`${f.tripId}/${f.receiptId}`)
  }

  async getActiveInvite(tripId: string): Promise<Invite | null> {
    this.check()
    if (!this.isMember(tripId)) return null
    const active = [...this.server.invites.entries()]
      .filter(([, inv]) => inv.tripId === tripId && !inv.revoked)
      .sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))[0]
    return active ? { token: active[0], expiresAt: active[1].expiresAt } : null
  }

  async createInvite(tripId: string): Promise<Invite> {
    this.check()
    this.assertMember(tripId)
    const token = crypto.randomUUID().replace(/-/g, '')
    const createdAt = this.server.now()
    const expiresAt = new Date(Date.parse(createdAt) + 14 * 86_400_000).toISOString()
    this.server.invites.set(token, { tripId, revoked: false, createdAt, expiresAt })
    return { token, expiresAt }
  }

  async revokeInvites(tripId: string) {
    this.check()
    if (!this.isMember(tripId)) return // RLS: no rows updated
    for (const inv of this.server.invites.values()) if (inv.tripId === tripId) inv.revoked = true
  }

  async previewInvite(token: string): Promise<InvitePreview | null> {
    if (!this.server.online) throw new RemoteError('network', 'Failed to fetch')
    const inv = this.server.invites.get(token)
    const trip = inv && this.server.trips.get(inv.tripId)
    if (!inv || inv.revoked || !trip || trip.deleted_at) return null
    return {
      tripId: trip.id,
      tripName: trip.name,
      memberCount: this.server.members.filter((m) => m.trip_id === trip.id).length,
      alreadyMember: this.isMember(trip.id),
      travellers: [...this.server.travellers.values()]
        .filter((t) => t.trip_id === trip.id && !t.deleted_at)
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        .map((t) => ({ id: t.id, name: t.display_name, claimed: !!t.user_id, isOwner: !!t.user_id && t.user_id === trip.owner_id })),
    }
  }

  async acceptInvite(token: string, pick: JoinPick = {}) {
    const me = this.check()
    const preview = await this.previewInvite(token)
    if (!preview) throw new RemoteError('rejected', 'This invite link is invalid, expired or was revoked')
    const trip = this.server.trips.get(preview.tripId)!
    const picked = pick.travellerId ? this.server.travellers.get(pick.travellerId) : undefined
    if (pick.travellerId) {
      if (!picked || picked.trip_id !== trip.id || picked.deleted_at) {
        throw new RemoteError('rejected', 'That name is no longer on this trip. Go back and pick again')
      }
      if (picked.user_id && picked.user_id === trip.owner_id && picked.user_id !== me) {
        throw new RemoteError('rejected', 'That name belongs to the person who owns this trip')
      }
    }
    if (!preview.alreadyMember) {
      this.server.members.push({ trip_id: trip.id, user_id: me, role: 'member', email: this.email, joined_at: this.server.now() })
    }
    const mine = () => [...this.server.travellers.values()].filter((t) => t.trip_id === trip.id && t.user_id === me)
    const touch = (t: Stored<RemoteTravellerRow>) => {
      t.updated_at = this.server.now()
    }
    if (picked) {
      for (const t of mine()) if (t.id !== picked.id) { t.user_id = null; touch(t) }
      const previous = picked.user_id
      picked.user_id = me
      touch(picked)
      if (previous && previous !== me && this.server.anonymousUsers.has(previous)) {
        this.server.members = this.server.members.filter((m) => !(m.trip_id === trip.id && m.user_id === previous && m.role !== 'owner'))
      }
    } else if (pick.newName?.trim()) {
      for (const t of mine()) { t.user_id = null; touch(t) }
      const now = this.server.now()
      const id = crypto.randomUUID()
      this.server.travellers.set(id, {
        id, trip_id: trip.id, display_name: pick.newName.trim(), user_id: me, created_at: now, updated_at: now, deleted_at: null,
      })
    }
    return trip.id
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
