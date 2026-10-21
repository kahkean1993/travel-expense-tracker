/**
 * Local-first sync for shared (cloud) trips.
 *
 * The app always reads and writes the local IndexedDB copy, so it works
 * offline. A sync run then:
 *   1. Push: uploads queued local changes (the outbox) in dependency order
 *      (trips → travellers → expenses, deletions last).
 *   2. Pull: for each trip the user belongs to, downloads rows the server
 *      changed since the last pull, and removes local copies of trips the
 *      user is no longer a member of.
 *
 * Conflicts are resolved per record, last write wins: the server keeps
 * whichever version of an expense (amounts + split together) was uploaded
 * last. A local change that has not been uploaded yet is never overwritten
 * by a pull.
 */
import type { TravelDb } from '../db/schema'
import { createRepositories, isCloudTrip, type Repositories } from '../db/repositories'
import type { OutboxEntry, SyncTable } from '../types/domain'
import {
  expenseFromRemote,
  expenseToRemote,
  travellerFromRemote,
  travellerToRemote,
  tripFromRemote,
  tripToRemote,
} from './mapping'
import {
  RemoteError,
  type ChildTable,
  type Invite,
  type JoinPick,
  type Remote,
  type RemoteExpenseRow,
  type RemoteTravellerRow,
} from './remote'

/** Re-download rows this close to the last cursor, in case of slow commits on the server. */
const PULL_OVERLAP_MS = 60_000
const PUSH_BATCH = 100

export type SyncPhase = 'signedOut' | 'idle' | 'syncing' | 'offline' | 'error'

export interface SyncStatus {
  phase: SyncPhase
  lastSyncedAt: string | null
  message: string | null
}

const PUSH_ORDER: { table: SyncTable; op: OutboxEntry['op'] }[] = [
  { table: 'trips', op: 'upsert' },
  { table: 'travellers', op: 'upsert' },
  { table: 'expenses', op: 'upsert' },
  { table: 'expenses', op: 'delete' },
  { table: 'travellers', op: 'delete' },
  { table: 'trips', op: 'delete' },
]

export class SyncEngine {
  private status: SyncStatus = { phase: 'signedOut', lastSyncedAt: null, message: null }
  private listeners = new Set<() => void>()
  private running: Promise<void> | null = null
  private rerun = false
  readonly repos: Repositories

  constructor(
    private db: TravelDb,
    readonly remote: Remote,
  ) {
    this.repos = createRepositories(db)
  }

  // ---------- Status ----------

  getStatus = () => this.status
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch }
    this.listeners.forEach((l) => l())
  }

  private requireUser(): string {
    const userId = this.remote.currentUserId()
    if (!userId) throw new RemoteError('auth', 'Sign in to use shared trips.')
    return userId
  }

  // ---------- Sync run ----------

  /** Runs one push + pull. Concurrent calls share a run and trigger one follow-up. */
  sync(): Promise<void> {
    if (this.running) {
      this.rerun = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false
          await this.runOnce()
        } while (this.rerun)
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  private async runOnce() {
    if (!this.remote.currentUserId()) {
      this.setStatus({ phase: 'signedOut', message: null })
      return
    }
    this.setStatus({ phase: 'syncing', message: null })
    try {
      await this.push()
      await this.pull()
      const failed = await this.db.outbox.filter((e) => !!e.error).count()
      this.setStatus({
        phase: failed ? 'error' : 'idle',
        lastSyncedAt: new Date().toISOString(),
        message: failed ? `${failed} change${failed === 1 ? ' was' : 's were'} rejected by the server.` : null,
      })
    } catch (error) {
      if (error instanceof RemoteError && error.kind === 'network') {
        this.setStatus({ phase: 'offline', message: 'Offline. Changes are saved on this device and will upload later.' })
      } else if (error instanceof RemoteError && error.kind === 'auth') {
        this.setStatus({ phase: 'error', message: 'Your sign-in has expired. Sign in again to keep syncing.' })
      } else {
        this.setStatus({ phase: 'error', message: error instanceof Error ? error.message : 'Sync failed.' })
      }
    }
  }

  // ---------- Push ----------

  async push() {
    const userId = this.requireUser()
    const entries = (await this.db.outbox.toArray()).filter((e) => !e.error)
    for (const step of PUSH_ORDER) {
      const group = entries
        .filter((e) => e.table === step.table && e.op === step.op)
        .sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))
      for (let i = 0; i < group.length; i += PUSH_BATCH) {
        await this.pushBatch(step.table, step.op, group.slice(i, i + PUSH_BATCH), userId)
      }
    }
  }

  private async pushBatch(table: SyncTable, op: OutboxEntry['op'], batch: OutboxEntry[], userId: string) {
    try {
      const sent = await this.send(table, op, batch, userId)
      await this.markDone(sent)
    } catch (error) {
      if (!(error instanceof RemoteError) || error.kind !== 'rejected') throw error
      if (batch.length > 1) {
        // Find the offending change(s) by sending one at a time.
        for (const entry of batch) await this.pushBatch(table, op, [entry], userId)
        return
      }
      await this.db.outbox.update(batch[0]!.key, { error: error.message })
    }
  }

  /** Uploads a batch; returns the entries that are now handled. */
  private async send(table: SyncTable, op: OutboxEntry['op'], batch: OutboxEntry[], userId: string) {
    const ids = batch.map((e) => e.recordId)
    if (op === 'delete') {
      await this.remote.softDelete(table, ids)
      return batch
    }
    if (table === 'trips') {
      for (const entry of batch) {
        const trip = await this.db.trips.get(entry.recordId)
        if (trip) await this.remote.updateTrip(tripToRemote(trip, trip.ownerId ?? userId))
      }
      return batch
    }
    if (table === 'travellers') {
      const rows = (await this.db.travellers.bulkGet(ids)).filter((t) => !!t).map(travellerToRemote)
      if (rows.length) await this.remote.upsert('travellers', rows)
      return batch
    }
    const expenses = (await this.db.expenses.bulkGet(ids)).filter((e) => !!e)
    const categories = new Map((await this.db.categories.toArray()).map((c) => [c.id, c.name]))
    const rows: RemoteExpenseRow[] = []
    for (const e of expenses) {
      const shares = await this.db.expenseShares.where('expenseId').equals(e.id).toArray()
      rows.push(expenseToRemote(e, shares, categories.get(e.categoryId) ?? ''))
    }
    if (rows.length) await this.remote.upsert('expenses', rows)
    return batch
  }

  /** Removes uploaded entries, unless the record was edited again meanwhile. */
  private markDone(entries: OutboxEntry[]) {
    return this.db.transaction('rw', this.db.outbox, async () => {
      for (const sent of entries) {
        const current = await this.db.outbox.get(sent.key)
        if (current && current.queuedAt === sent.queuedAt && current.op === sent.op) {
          await this.db.outbox.delete(sent.key)
        }
      }
    })
  }

  // ---------- Pull ----------

  async pull() {
    this.requireUser()
    const memberOf = new Set(await this.remote.listMyTripIds())

    // Trips this user left, was removed from, or never had on this account.
    const localCloud = (await this.db.trips.toArray()).filter(isCloudTrip)
    for (const trip of localCloud) {
      if (memberOf.has(trip.id)) continue
      const pending = await this.db.outbox.where('tripId').equals(trip.id).count()
      if (pending === 0) await this.repos.tripsRepo.removeLocalCopy(trip.id)
    }

    for (const tripId of memberOf) await this.pullTrip(tripId)
  }

  async pullTrip(tripId: string) {
    const cursor = (await this.db.syncCursors.get(tripId))?.pulledUntil ?? null
    const since = cursor ? new Date(Date.parse(cursor) - PULL_OVERLAP_MS).toISOString() : null

    const tripRow = await this.remote.fetchTrip(tripId)
    if (!tripRow) return
    if (tripRow.deleted_at) {
      await this.repos.tripsRepo.removeLocalCopy(tripId)
      return
    }
    const [travellers, expenses, members] = await Promise.all([
      this.remote.fetchChanged('travellers', tripId, since),
      this.remote.fetchChanged('expenses', tripId, since),
      this.remote.fetchMembers(tripId),
    ])

    const db = this.db
    await db.transaction(
      'rw',
      [db.trips, db.travellers, db.expenses, db.expenseShares, db.categories, db.members, db.syncCursors, db.outbox],
      async () => {
        const pending = new Set(
          (await db.outbox.where('tripId').equals(tripId).toArray()).map((e) => e.key),
        )
        if (!pending.has(`trips:${tripId}`)) await db.trips.put(tripFromRemote(tripRow))

        for (const row of travellers as RemoteTravellerRow[]) {
          if (pending.has(`travellers:${row.id}`)) continue
          if (row.deleted_at) await db.travellers.delete(row.id)
          else await db.travellers.put(travellerFromRemote(row))
        }

        for (const row of expenses as RemoteExpenseRow[]) {
          if (pending.has(`expenses:${row.id}`)) continue
          await db.expenseShares.where('expenseId').equals(row.id).delete()
          if (row.deleted_at) {
            await db.expenses.delete(row.id)
            continue
          }
          const { expense, shares } = expenseFromRemote(row)
          await db.expenses.put(expense)
          await db.expenseShares.bulkPut(shares)
          // Recreate custom categories this device doesn't know yet.
          if (!(await db.categories.get(expense.categoryId))) {
            await db.categories.put({
              id: expense.categoryId,
              tripId,
              name: row.category_name || 'Other',
              isCustom: true,
              createdAt: expense.createdAt,
            })
          }
        }

        await db.members.where('tripId').equals(tripId).delete()
        await db.members.bulkPut(
          members.map((m) => ({ tripId, userId: m.user_id, role: m.role, email: m.email, joinedAt: m.joined_at })),
        )

        const newest = [tripRow, ...travellers, ...expenses]
          .map((r) => r.updated_at ?? '')
          .reduce((a, b) => (b > a ? b : a), cursor ?? '')
        await db.syncCursors.put({ tripId, pulledUntil: newest || null })
      },
    )
  }

  // ---------- Sharing ----------

  /**
   * Uploads a local trip and turns it into a shared trip owned by the
   * signed-in user, with its invite link ready to send. Needs a connection.
   * `meTravellerId` marks which traveller is the owner. Safe to repeat if an
   * earlier attempt stopped halfway.
   */
  async shareTrip(tripId: string, meTravellerId?: string): Promise<Invite | null> {
    const userId = this.requireUser()
    const trip = await this.db.trips.get(tripId)
    if (!trip) throw new Error('Trip not found.')
    if (isCloudTrip(trip)) return this.remote.getActiveInvite(tripId)
    if (trip.isSample) throw new Error('Sample trips cannot be shared. Create your own trip first.')

    try {
      await this.remote.insertTrip(tripToRemote(trip, userId))
    } catch (error) {
      // An earlier attempt may have created the trip online before stopping.
      if (!(error instanceof RemoteError) || error.kind !== 'rejected') throw error
      const existing = await this.remote.fetchTrip(tripId)
      if (!existing || existing.owner_id !== userId) throw error
    }
    // Create the invite link before the trip flips to "shared" on this device,
    // so the screen that appears next already has it.
    const invite = (await this.remote.getActiveInvite(tripId)) ?? (await this.remote.createInvite(tripId))
    const db = this.db
    await db.transaction('rw', [db.trips, db.travellers, db.expenses, db.outbox], async () => {
      const ts = new Date().toISOString()
      await db.trips.update(tripId, { syncMode: 'cloud', ownerId: userId })
      if (meTravellerId) await db.travellers.update(meTravellerId, { userId })
      const queueAll = async (table: ChildTable, ids: string[]) =>
        db.outbox.bulkPut(ids.map((id) => ({ key: `${table}:${id}`, table, recordId: id, tripId, op: 'upsert' as const, queuedAt: ts })))
      await queueAll('travellers', await db.travellers.where('tripId').equals(tripId).primaryKeys())
      await queueAll('expenses', await db.expenses.where('tripId').equals(tripId).primaryKeys())
    })
    await this.sync()
    return invite
  }

  /** Joins a trip with an invite token, links who the person is, and downloads the trip. Returns the trip id. */
  async joinWithInvite(token: string, pick: JoinPick = {}) {
    this.requireUser()
    const tripId = await this.remote.acceptInvite(token, pick)
    await this.pullTrip(tripId)
    return tripId
  }

  /** The invite link that is currently switched on, if any. */
  getInvite(tripId: string): Promise<Invite | null> {
    this.requireUser()
    return this.remote.getActiveInvite(tripId)
  }

  /** Returns the working invite link, creating one if there is none. One link serves everyone. */
  async getOrCreateInvite(tripId: string): Promise<Invite> {
    this.requireUser()
    return (await this.remote.getActiveInvite(tripId)) ?? (await this.remote.createInvite(tripId))
  }

  /** Switches the invite link off. */
  switchOffInvites(tripId: string) {
    this.requireUser()
    return this.remote.revokeInvites(tripId)
  }

  /** Leaves a shared trip (members only) and removes this device's copy. */
  async leaveTrip(tripId: string) {
    const userId = this.requireUser()
    await this.remote.removeMember(tripId, userId)
    await this.repos.tripsRepo.removeLocalCopy(tripId)
  }

  /**
   * Owner removes another member. Existing invite links are switched off as
   * well, so the removed person can't simply rejoin with the link they have.
   */
  async removeMember(tripId: string, userId: string) {
    this.requireUser()
    await this.remote.removeMember(tripId, userId)
    await this.remote.revokeInvites(tripId)
    await this.pullTrip(tripId)
  }

  // ---------- Rejected changes ----------

  /** Tries rejected changes again on the next sync. */
  async retryFailed() {
    await this.db.outbox.filter((e) => !!e.error).modify((e) => {
      delete e.error
    })
    await this.sync()
  }

  /** Drops rejected changes and re-downloads the affected trips, restoring the server's version. */
  async discardFailed() {
    const failed = await this.db.outbox.filter((e) => !!e.error).toArray()
    await this.db.transaction('rw', [this.db.outbox, this.db.syncCursors], async () => {
      await this.db.outbox.bulkDelete(failed.map((e) => e.key))
      await this.db.syncCursors.bulkDelete([...new Set(failed.map((e) => e.tripId))])
    })
    await this.sync()
  }

  /** Removes all shared trips from this device, e.g. on sign-out. */
  async removeAllCloudTrips() {
    const cloud = (await this.db.trips.toArray()).filter(isCloudTrip)
    for (const t of cloud) await this.repos.tripsRepo.removeLocalCopy(t.id)
    await this.db.outbox.clear()
    this.setStatus({ phase: 'signedOut', lastSyncedAt: null, message: null })
  }
}
