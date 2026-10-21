import { afterEach, describe, expect, it } from 'vitest'
import { TravelDb } from '../db/schema'
import { evaluateExpenseForm, emptyExpenseForm, type ExpenseFormValues } from '../features/expenses/expenseDraft'
import { computeBalances } from '../features/splitting/allocate'
import { FakeServer } from '../test/fakeServer'
import { tripInput } from '../test/fixtures'
import { SyncEngine } from './engine'

const opened: TravelDb[] = []
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete()
})

function device(server: FakeServer, userId: string) {
  const db = new TravelDb(`device-${userId}-${Math.random()}`)
  opened.push(db)
  const engine = new SyncEngine(db, server.device(userId))
  const { tripsRepo, travellersRepo, expensesRepo, categoriesRepo } = engine.repos
  return {
    db,
    engine,
    tripsRepo,
    travellersRepo,
    expensesRepo,
    categoriesRepo,
    async addExpense(tripId: string, over: Partial<ExpenseFormValues>) {
      const trip = (await tripsRepo.get(tripId))!
      const travellers = await travellersRepo.listByTrip(tripId)
      const ev = evaluateExpenseForm(
        { ...emptyExpenseForm(trip, travellers, '2026-03-02'), description: 'Item', categoryId: 'cat-food', ...over },
        trip,
        travellers,
      )
      if (!ev.result) throw new Error(JSON.stringify(ev.errors))
      return expensesRepo.save(undefined, ev.result.record, ev.result.shares)
    },
    async snapshot(tripId: string) {
      const strip = <T extends object>(rows: T[]) =>
        rows.map(({ updatedAt: _u, ...r }: T & { updatedAt?: string }) => r).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      return {
        travellers: strip(await db.travellers.where('tripId').equals(tripId).toArray()),
        expenses: strip(await db.expenses.where('tripId').equals(tripId).toArray()),
        shares: (await db.expenseShares.where('tripId').equals(tripId).toArray())
          .map(({ id: _id, ...s }) => s)
          .sort((a, b) => (a.expenseId + a.travellerId).localeCompare(b.expenseId + b.travellerId)),
      }
    },
  }
}

/** Alice creates and shares a trip; Bob joins through an invite. */
async function sharedTrip() {
  const server = new FakeServer()
  const alice = device(server, 'alice')
  const bob = device(server, 'bob')
  await alice.db.open()
  await bob.db.open()
  const trip = await alice.tripsRepo.create(tripInput(), ['Alice', 'Bob'])
  const [aliceT, bobT] = await alice.travellersRepo.listByTrip(trip.id)
  await alice.addExpense(trip.id, { amount: '90' })
  await alice.engine.shareTrip(trip.id, aliceT!.id)
  const { token } = await alice.engine.createInvite(trip.id)
  await bob.engine.joinWithInvite(token)
  await bob.travellersRepo.linkUser(bobT!.id, 'bob')
  await bob.engine.sync()
  await alice.engine.sync()
  return { server, alice, bob, tripId: trip.id, aliceT: aliceT!, bobT: bobT! }
}

describe('sync engine', () => {
  it('shares a trip and gives a joining member an identical copy', async () => {
    const { alice, bob, tripId } = await sharedTrip()
    expect(await alice.db.outbox.count()).toBe(0)
    expect(await bob.snapshot(tripId)).toEqual(await alice.snapshot(tripId))
    expect((await bob.tripsRepo.get(tripId))).toMatchObject({ syncMode: 'cloud', ownerId: 'alice', name: 'Test Trip' })
    expect((await bob.db.members.where('tripId').equals(tripId).toArray()).map((m) => m.userId).sort()).toEqual(['alice', 'bob'])
    expect((await alice.travellersRepo.listByTrip(tripId)).map((t) => t.userId)).toEqual(['alice', 'bob'])
    expect(bob.engine.getStatus().phase).toBe('idle')
  })

  it('syncs changes both ways and keeps balances identical', async () => {
    const { alice, bob, tripId, bobT } = await sharedTrip()
    await bob.addExpense(tripId, { amount: '1000', currency: 'JPY', rate: '0.0305', payerId: bobT.id })
    await alice.addExpense(tripId, { amount: '12.34', splitMode: 'personal', participantIds: [bobT.id] })
    await bob.engine.sync()
    await alice.engine.sync()
    await bob.engine.sync()
    const a = await alice.snapshot(tripId)
    expect(await bob.snapshot(tripId)).toEqual(a)
    expect(a.expenses).toHaveLength(3)
    const balances = async (d: typeof alice) =>
      computeBalances(
        (await d.travellersRepo.listByTrip(tripId)).map((t) => t.id),
        await d.expensesRepo.listByTrip(tripId),
        await d.expensesRepo.sharesByTrip(tripId),
      )
    expect(await balances(bob)).toEqual(await balances(alice))
    expect((await balances(alice)).reduce((s, b) => s + b.net, 0)).toBe(0)
  })

  it('keeps offline changes and uploads them when back online', async () => {
    const { server, alice, bob, tripId } = await sharedTrip()
    server.online = false
    await bob.addExpense(tripId, { amount: '7.50', description: 'Offline coffee' })
    await bob.engine.sync()
    expect(bob.engine.getStatus().phase).toBe('offline')
    expect(await bob.db.outbox.count()).toBe(1)

    server.online = true
    await bob.engine.sync()
    expect(await bob.db.outbox.count()).toBe(0)
    await alice.engine.sync()
    expect((await alice.expensesRepo.listByTrip(tripId)).map((e) => e.description)).toContain('Offline coffee')
  })

  it('never overwrites an unsent local edit with an older server version', async () => {
    const { server, alice, bob, tripId } = await sharedTrip()
    const [expense] = await bob.expensesRepo.listByTrip(tripId)
    const shares = await bob.expensesRepo.sharesByExpense(expense!.id)

    // Bob edits offline; meanwhile Alice edits the same expense online.
    server.online = false
    await bob.expensesRepo.save(expense!.id, { ...expense!, description: 'Bob edit' }, shares)
    server.online = true
    const aShares = await alice.expensesRepo.sharesByExpense(expense!.id)
    await alice.expensesRepo.save(expense!.id, { ...expense!, description: 'Alice edit' }, aShares)
    await alice.engine.sync()

    // Pulling alone must not clobber Bob's pending edit.
    await bob.engine.pull()
    expect((await bob.expensesRepo.get(expense!.id))?.description).toBe('Bob edit')

    // After Bob's push, last write wins everywhere.
    await bob.engine.sync()
    await alice.engine.sync()
    expect((await alice.expensesRepo.get(expense!.id))?.description).toBe('Bob edit')
  })

  it('propagates deletions of expenses and travellers', async () => {
    const { alice, bob, tripId } = await sharedTrip()
    const sam = await alice.travellersRepo.add(tripId, 'Sam')
    const [expense] = await alice.expensesRepo.listByTrip(tripId)
    await alice.engine.sync()
    await bob.engine.sync()
    expect(await bob.db.travellers.get(sam.id)).toBeTruthy()

    await alice.expensesRepo.delete(expense!.id)
    await alice.travellersRepo.remove(sam.id)
    await alice.engine.sync()
    await bob.engine.sync()
    expect(await bob.expensesRepo.listByTrip(tripId)).toEqual([])
    expect(await bob.db.expenseShares.count()).toBe(0)
    expect(await bob.db.travellers.get(sam.id)).toBeUndefined()
  })

  it('recreates custom categories on other devices', async () => {
    const { alice, bob, tripId } = await sharedTrip()
    const gifts = await alice.categoriesRepo.add('Gifts')
    await alice.addExpense(tripId, { amount: '20', categoryId: gifts.id })
    await alice.engine.sync()
    await bob.engine.sync()
    const cats = await bob.categoriesRepo.list(tripId)
    expect(cats.find((c) => c.id === gifts.id)).toMatchObject({ name: 'Gifts', tripId })
  })

  it('marks a rejected change and still uploads the rest', async () => {
    const { alice, bob, tripId } = await sharedTrip()
    const good = await bob.addExpense(tripId, { amount: '3', description: 'Good' })
    const bad = await bob.addExpense(tripId, { amount: '4', description: 'Bad' })
    // Corrupt one expense locally so the server rejects it.
    await bob.db.expenseShares.where('expenseId').equals(bad.id).modify((s) => {
      s.allocatedBaseAmountMinorUnits += 1
    })
    await bob.engine.sync()
    expect(bob.engine.getStatus()).toMatchObject({ phase: 'error', message: '1 change was rejected by the server.' })
    const [failed] = await bob.db.outbox.toArray()
    expect(failed).toMatchObject({ recordId: bad.id, error: expect.stringMatching(/check constraint/) })
    await alice.engine.sync()
    expect((await alice.expensesRepo.listByTrip(tripId)).map((e) => e.id)).toContain(good.id)
  })

  it('discarding a rejected change restores the server version', async () => {
    const { bob, tripId } = await sharedTrip()
    const [expense] = await bob.expensesRepo.listByTrip(tripId)
    const shares = await bob.expensesRepo.sharesByExpense(expense!.id)
    await bob.expensesRepo.save(expense!.id, { ...expense!, description: 'Broken edit' }, shares)
    await bob.db.expenseShares.where('expenseId').equals(expense!.id).modify((x) => {
      x.allocatedBaseAmountMinorUnits += 1
    })
    await bob.engine.sync()
    expect(bob.engine.getStatus().phase).toBe('error')

    await bob.engine.retryFailed()
    expect(await bob.db.outbox.filter((e) => !!e.error).count()).toBe(1)

    await bob.engine.discardFailed()
    expect(bob.engine.getStatus().phase).toBe('idle')
    expect((await bob.expensesRepo.get(expense!.id))?.description).toBe('Item')
    const restored = await bob.expensesRepo.sharesByExpense(expense!.id)
    expect(restored.reduce((s, x) => s + x.allocatedBaseAmountMinorUnits, 0)).toBe(expense!.baseAmountMinorUnits)
  })

  it('only the owner can delete a shared trip; it disappears for everyone', async () => {
    const { alice, bob, tripId } = await sharedTrip()
    await bob.tripsRepo.delete(tripId) // a member's delete is rejected by the server
    await bob.engine.sync()
    expect(bob.engine.getStatus().phase).toBe('error')
    await bob.db.outbox.clear()

    await alice.tripsRepo.delete(tripId)
    await alice.engine.sync()
    await bob.engine.sync()
    expect(await bob.tripsRepo.get(tripId)).toBeUndefined()
    expect(await alice.tripsRepo.get(tripId)).toBeUndefined()
    expect(await alice.db.outbox.count()).toBe(0)
  })

  it('removes the local copy when a member leaves or is removed', async () => {
    const { server, alice, bob, tripId } = await sharedTrip()
    await bob.engine.leaveTrip(tripId)
    expect(await bob.tripsRepo.get(tripId)).toBeUndefined()
    await alice.engine.sync()
    expect((await alice.db.members.where('tripId').equals(tripId).toArray()).map((m) => m.userId)).toEqual(['alice'])

    // Rejoin, then the owner removes Bob.
    const { token } = await alice.engine.createInvite(tripId)
    await bob.engine.joinWithInvite(token)
    await alice.engine.removeMember(tripId, 'bob')
    await bob.engine.sync()
    expect(await bob.tripsRepo.get(tripId)).toBeUndefined()
    expect(server.members.filter((m) => m.trip_id === tripId)).toHaveLength(1)
  })

  it('does not drop a trip that still has unsent changes', async () => {
    const { server, bob, tripId } = await sharedTrip()
    server.members = server.members.filter((m) => m.user_id !== 'bob')
    await bob.addExpense(tripId, { amount: '1' })
    await bob.engine.pull()
    expect(await bob.tripsRepo.get(tripId)).toBeTruthy()
  })

  it('never uploads local-only trips', async () => {
    const server = new FakeServer()
    const solo = device(server, 'solo')
    const trip = await solo.tripsRepo.create(tripInput(), ['Me'])
    await solo.addExpense(trip.id, { amount: '5' })
    await solo.engine.sync()
    expect(server.trips.size).toBe(0)
    expect(await solo.tripsRepo.get(trip.id)).toMatchObject({ syncMode: 'local' })
  })

  it('refuses to share sample trips and reports signed-out state', async () => {
    const server = new FakeServer()
    const d = device(server, 'x')
    const sample = await d.tripsRepo.create(tripInput(), ['Me'], { isSample: true })
    await expect(d.engine.shareTrip(sample.id)).rejects.toThrow(/Sample trips/)

    const signedOut = new SyncEngine(d.db, server.device(null))
    await signedOut.sync()
    expect(signedOut.getStatus().phase).toBe('signedOut')
  })

  it('removes shared trips from the device on sign-out but keeps local ones', async () => {
    const { alice, tripId } = await sharedTrip()
    const local = await alice.tripsRepo.create(tripInput({ name: 'Private' }), ['Me'])
    await alice.engine.removeAllCloudTrips()
    expect(await alice.tripsRepo.get(tripId)).toBeUndefined()
    expect(await alice.tripsRepo.get(local.id)).toBeTruthy()
  })

  it('handles large trips in batches', async () => {
    const server = new FakeServer()
    const a = device(server, 'alice')
    const trip = await a.tripsRepo.create(tripInput(), ['Alice'])
    for (let i = 0; i < 230; i++) await a.addExpense(trip.id, { amount: String(i + 1) })
    await a.engine.shareTrip(trip.id)
    expect(server.expenses.size).toBe(230)
    expect(await a.db.outbox.count()).toBe(0)
  })
})
