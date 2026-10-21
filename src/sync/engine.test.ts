import { afterEach, describe, expect, it } from 'vitest'
import { TravelDb } from '../db/schema'
import { evaluateExpenseForm, emptyExpenseForm, type ExpenseFormValues } from '../features/expenses/expenseDraft'
import { computeBalances } from '../features/splitting/allocate'
import { FakeServer } from '../test/fakeServer'
import { tripInput } from '../test/fixtures'
import { SyncEngine } from './engine'
import { tripToRemote } from './mapping'

const opened: TravelDb[] = []
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete()
})

function device(server: FakeServer, userId: string, options: { anonymous?: boolean } = {}) {
  const db = new TravelDb(`device-${userId}-${Math.random()}`)
  opened.push(db)
  const engine = new SyncEngine(db, server.device(userId, options))
  const { tripsRepo, travellersRepo, expensesRepo, categoriesRepo, settlementsRepo, receiptsRepo } = engine.repos
  return {
    db,
    engine,
    tripsRepo,
    travellersRepo,
    expensesRepo,
    categoriesRepo,
    settlementsRepo,
    receiptsRepo,
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

/** Alice creates and shares a trip; Bob (no email) joins through an invite by picking his name. */
async function sharedTrip() {
  const server = new FakeServer()
  const alice = device(server, 'alice')
  const bob = device(server, 'bob', { anonymous: true })
  await alice.db.open()
  await bob.db.open()
  const trip = await alice.tripsRepo.create(tripInput(), ['Alice', 'Bob'])
  const [aliceT, bobT] = await alice.travellersRepo.listByTrip(trip.id)
  await alice.addExpense(trip.id, { amount: '90' })
  await alice.engine.shareTrip(trip.id, aliceT!.id)
  const { token } = await alice.engine.getOrCreateInvite(trip.id)
  await bob.engine.joinWithInvite(token, { travellerId: bobT!.id })
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
    const { token } = await alice.engine.getOrCreateInvite(tripId)
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

  it('can finish sharing after an earlier attempt stopped halfway', async () => {
    const server = new FakeServer()
    const alice = device(server, 'alice')
    const trip = await alice.tripsRepo.create(tripInput(), ['Alice'])
    // The trip reached the server, but the app stopped before marking it shared locally.
    await alice.engine.remote.insertTrip(tripToRemote(trip, 'alice'))
    const invite = await alice.engine.shareTrip(trip.id)
    expect(invite?.token).toMatch(/^[0-9a-f]{32}$/)
    expect(await alice.tripsRepo.get(trip.id)).toMatchObject({ syncMode: 'cloud' })
    expect(server.members.filter((m) => m.trip_id === trip.id)).toHaveLength(1)
    // Someone else's trip id can't be claimed this way.
    const mallory = device(server, 'mallory')
    await mallory.db.trips.add({ ...trip, syncMode: 'local' })
    await expect(mallory.engine.shareTrip(trip.id)).rejects.toThrow(/row-level security/)
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

  it('links the picked name at join time, so the friend is "you" immediately', async () => {
    const { bob, tripId, bobT } = await sharedTrip()
    const mine = (await bob.travellersRepo.listByTrip(tripId)).filter((t) => t.userId === 'bob')
    expect(mine.map((t) => t.id)).toEqual([bobT.id])
  })

  it('shows a friend who has not signed in the trip and who they can be', async () => {
    const { server, alice, tripId, aliceT } = await sharedTrip()
    const { token } = await alice.engine.getOrCreateInvite(tripId)
    const visitor = server.device(null)
    const preview = await visitor.previewInvite(token)
    expect(preview).toMatchObject({ tripName: 'Test Trip', memberCount: 2 })
    expect(preview!.travellers.map((t) => [t.name, t.isOwner])).toEqual([
      ['Alice', true],
      ['Bob', false],
    ])
    expect(aliceT.displayName).toBe('Alice')
    expect(await visitor.previewInvite('wrong')).toBeNull()
  })

  it('lets a friend join with a new name and not be linked to anyone else', async () => {
    const { server, alice, tripId } = await sharedTrip()
    const kim = device(server, 'kim', { anonymous: true })
    const { token } = await alice.engine.getOrCreateInvite(tripId)
    await kim.engine.joinWithInvite(token, { newName: 'Kim' })
    await alice.engine.sync()
    const names = (await alice.travellersRepo.listByTrip(tripId)).map((t) => `${t.displayName}:${t.userId}`).sort()
    expect(names).toEqual(['Alice:alice', 'Bob:bob', 'Kim:kim'])
    expect(await kim.snapshot(tripId)).toEqual(await alice.snapshot(tripId))
  })

  it('moves a name to a new phone when the same person joins again', async () => {
    const { server, alice, bob, tripId, bobT } = await sharedTrip()
    const newPhone = device(server, 'bob-new-phone', { anonymous: true })
    const { token } = await alice.engine.getOrCreateInvite(tripId)
    await newPhone.engine.joinWithInvite(token, { travellerId: bobT.id })
    expect((await newPhone.travellersRepo.listByTrip(tripId)).find((t) => t.id === bobT.id)?.userId).toBe('bob-new-phone')
    // The old phone loses access at its next sync; the name now belongs to the new phone.
    await bob.engine.sync()
    expect(await bob.tripsRepo.get(tripId)).toBeUndefined()
    await alice.engine.sync()
    expect((await alice.db.members.where('tripId').equals(tripId).toArray()).map((m) => m.userId).sort()).toEqual(['alice', 'bob-new-phone'])
  })

  it("does not let a friend take the owner's name", async () => {
    const { server, alice, tripId, aliceT } = await sharedTrip()
    const mallory = device(server, 'mallory', { anonymous: true })
    const { token } = await alice.engine.getOrCreateInvite(tripId)
    await expect(mallory.engine.joinWithInvite(token, { travellerId: aliceT.id })).rejects.toThrow(/owns this trip/)
  })

  it('does not let a friend without an email share trips of their own', async () => {
    const server = new FakeServer()
    const guest = device(server, 'guest', { anonymous: true })
    const trip = await guest.tripsRepo.create(tripInput(), ['Me'])
    await expect(guest.engine.shareTrip(trip.id)).rejects.toThrow(/row-level security/)
    expect(server.trips.size).toBe(0)
  })

  it('reuses one invite link for everyone until it is switched off', async () => {
    const { server, alice, bob, tripId } = await sharedTrip()
    const first = await alice.engine.getOrCreateInvite(tripId)
    expect(await bob.engine.getOrCreateInvite(tripId)).toEqual(first)
    expect(await alice.engine.getInvite(tripId)).toEqual(first)

    await alice.engine.switchOffInvites(tripId)
    expect(await alice.engine.getInvite(tripId)).toBeNull()
    const late = device(server, 'late', { anonymous: true })
    await expect(late.engine.joinWithInvite(first.token, { newName: 'Late' })).rejects.toThrow(/invalid, expired/)
    expect((await alice.engine.getOrCreateInvite(tripId)).token).not.toBe(first.token)
  })

  it('switches the link off when the owner removes someone, so they cannot rejoin', async () => {
    const { server, alice, tripId } = await sharedTrip()
    const { token } = await alice.engine.getOrCreateInvite(tripId)
    await alice.engine.removeMember(tripId, 'bob')
    expect(await alice.engine.getInvite(tripId)).toBeNull()
    const bobAgain = device(server, 'bob', { anonymous: true })
    await expect(bobAgain.engine.joinWithInvite(token, { newName: 'Bob' })).rejects.toThrow(/invalid, expired/)
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

describe('settlement payments over sync', () => {
  it('a payment recorded on one phone appears on the other, and undo removes it', async () => {
    const { alice, bob, server, tripId, aliceT, bobT } = await sharedTrip()
    const payment = await bob.settlementsRepo.add(tripId, {
      fromTravellerId: bobT.id,
      toTravellerId: aliceT.id,
      amountMinorUnits: 1500,
      paidOn: '2026-03-05',
    })
    await bob.engine.sync()
    expect(server.settlements.get(payment.id)).toMatchObject({ amount_minor: 1500, created_by: 'bob' })
    await alice.engine.sync()
    expect(await alice.settlementsRepo.listByTrip(tripId)).toMatchObject([{ id: payment.id, createdBy: 'bob', amountMinorUnits: 1500 }])

    await alice.settlementsRepo.remove(payment.id)
    await alice.engine.sync()
    await bob.engine.sync()
    expect(await bob.settlementsRepo.listByTrip(tripId)).toEqual([])
    expect(await bob.db.outbox.count()).toBe(0)
  })

  it('records who added an expense', async () => {
    const { alice, bob, tripId, bobT } = await sharedTrip()
    await bob.addExpense(tripId, { amount: '20', payerId: bobT.id, description: 'Snacks' })
    await bob.engine.sync()
    await alice.engine.sync()
    const snacks = (await alice.expensesRepo.listByTrip(tripId)).find((e) => e.description === 'Snacks')
    expect(snacks).toMatchObject({ createdBy: 'bob', updatedBy: 'bob' })
  })

  it('refuses expense changes while the trip is completed, but still takes payments', async () => {
    const { alice, bob, tripId, aliceT, bobT } = await sharedTrip()
    await alice.tripsRepo.setStatus(tripId, 'completed')
    await alice.engine.sync()
    await bob.engine.sync()
    // Bob's phone is out of date about nothing: it also locks locally.
    await expect(bob.addExpense(tripId, { amount: '5' })).rejects.toThrow(/completed/)
    await bob.settlementsRepo.add(tripId, { fromTravellerId: bobT.id, toTravellerId: aliceT.id, amountMinorUnits: 100, paidOn: '2026-03-06' })
    await bob.engine.sync()
    expect(bob.engine.getStatus().phase).toBe('idle')
  })

  it('the server rejects an expense that was queued before the trip was completed', async () => {
    const { alice, bob, server, tripId } = await sharedTrip()
    // Bob adds an expense offline; meanwhile Alice completes the trip.
    server.online = false
    await bob.addExpense(tripId, { amount: '5', description: 'Late' })
    server.online = true
    await alice.tripsRepo.setStatus(tripId, 'completed')
    await alice.engine.sync()
    await bob.engine.push()
    const failed = await bob.db.outbox.filter((e) => !!e.error).toArray()
    expect(failed.map((f) => f.table)).toEqual(['expenses'])
    expect(failed[0]!.error).toMatch(/completed/)
  })
})

describe('receipt photos over sync', () => {
  const photo = (text = 'photo') => new Blob([text], { type: 'image/jpeg' })

  it('uploads a photo, lets the other phone download it, and removes it for both', async () => {
    const { alice, bob, server, tripId } = await sharedTrip()
    const [expense] = await alice.expensesRepo.listByTrip(tripId)
    const receipt = await alice.receiptsRepo.add(expense!.id, photo('receipt-1'))
    await alice.engine.sync()
    expect(server.files.has(`${tripId}/${receipt.id}`)).toBe(true)
    expect(server.receipts.get(receipt.id)).toMatchObject({ expense_id: expense!.id, created_by: 'alice' })

    await bob.engine.sync()
    const [seen] = await bob.receiptsRepo.listByExpense(expense!.id)
    expect(seen).toMatchObject({ id: receipt.id, createdBy: 'alice' })
    expect(seen!.blob).toBeUndefined() // not downloaded yet
    const blob = await bob.engine.receiptBlob(seen!)
    expect(await blob!.text()).toBe('receipt-1')
    expect((await bob.db.receipts.get(receipt.id))!.blob).toBeDefined() // kept for offline use

    await bob.receiptsRepo.remove(receipt.id)
    await bob.engine.sync()
    expect(server.files.has(`${tripId}/${receipt.id}`)).toBe(false)
    await alice.engine.sync()
    expect(await alice.receiptsRepo.listByExpense(expense!.id)).toEqual([])
  })

  it('keeps at most 3 photos per expense', async () => {
    const { alice, tripId } = await sharedTrip()
    const [expense] = await alice.expensesRepo.listByTrip(tripId)
    for (let i = 0; i < 3; i++) await alice.receiptsRepo.add(expense!.id, photo(`p${i}`))
    await expect(alice.receiptsRepo.add(expense!.id, photo('p4'))).rejects.toThrow(/up to 3/)
    await expect(alice.receiptsRepo.add(expense!.id, new Blob(['x'], { type: 'application/pdf' }))).rejects.toThrow(/JPEG/)
    await expect(alice.receiptsRepo.add(expense!.id, new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/jpeg' }))).rejects.toThrow(/too large/)
  })

  it('removing an expense removes its photos', async () => {
    const { alice, server, tripId } = await sharedTrip()
    const [expense] = await alice.expensesRepo.listByTrip(tripId)
    const receipt = await alice.receiptsRepo.add(expense!.id, photo())
    await alice.engine.sync()
    await alice.expensesRepo.delete(expense!.id)
    await alice.engine.sync()
    expect(server.files.has(`${tripId}/${receipt.id}`)).toBe(false)
    expect(server.receipts.get(receipt.id)!.deleted_at).toBeTruthy()
  })

  it('does not hand photos to people outside the trip', async () => {
    const { alice, server, tripId } = await sharedTrip()
    const [expense] = await alice.expensesRepo.listByTrip(tripId)
    const receipt = await alice.receiptsRepo.add(expense!.id, photo())
    await alice.engine.sync()
    const outsider = server.device('mallory')
    await expect(outsider.downloadReceipt(tripId, receipt.id)).rejects.toThrow()
  })

  it('keeps local photos for local-only trips and never uploads them', async () => {
    const server = new FakeServer()
    const solo = device(server, 'solo')
    await solo.db.open()
    const trip = await solo.tripsRepo.create(tripInput(), ['Me'])
    const [me] = await solo.travellersRepo.listByTrip(trip.id)
    const e = await solo.addExpense(trip.id, { amount: '5', payerId: me!.id })
    await solo.receiptsRepo.add(e.id, photo())
    expect(await solo.db.outbox.count()).toBe(0)
    expect(server.files.size).toBe(0)
  })
})
