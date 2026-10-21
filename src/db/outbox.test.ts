import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import { db, TravelDb } from './schema'
import { expensesRepo, travellersRepo, tripsRepo } from './repositories'
import { addExpense, makeTrip } from '../test/fixtures'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function makeCloudTrip() {
  const made = await makeTrip(['Me', 'Alex'])
  await db.trips.update(made.trip.id, { syncMode: 'cloud', ownerId: 'user-1' })
  await db.outbox.clear()
  return { ...made, trip: (await db.trips.get(made.trip.id))! }
}

describe('schema v2 upgrade', () => {
  it('keeps v1 data and marks existing trips as local', async () => {
    const name = 'upgrade-test-' + Math.random()
    const v1 = new Dexie(name)
    v1.version(1).stores({
      trips: 'id, status, updatedAt',
      travellers: 'id, tripId',
      expenses: 'id, tripId, [tripId+date], categoryId, payerTravellerId',
      expenseShares: 'id, expenseId, tripId, travellerId',
      categories: 'id, tripId',
      settings: 'id',
    })
    await v1.open()
    await v1.table('trips').add({ id: 't1', name: 'Old trip', status: 'active' })
    await v1.table('settings').add({ id: 'app', schemaVersion: 1 })
    v1.close()

    const v2 = new TravelDb(name)
    await v2.open()
    expect(await v2.trips.get('t1')).toMatchObject({ name: 'Old trip', syncMode: 'local' })
    expect((await v2.settings.get('app'))?.schemaVersion).toBe(3)
    expect(await v2.outbox.count()).toBe(0)
    await v2.delete()
  })
})

describe('outbox', () => {
  it('never queues changes to local trips', async () => {
    const { trip, travellers } = await makeTrip()
    await addExpense(trip, travellers, { amount: '5' })
    await tripsRepo.setStatus(trip.id, 'completed')
    expect(await db.outbox.count()).toBe(0)
  })

  it('queues each changed record of a shared trip once', async () => {
    const { trip, travellers } = await makeCloudTrip()
    const e = await addExpense(trip, travellers, { amount: '5' })
    await addExpense(trip, travellers, { amount: '6' })
    const sam = await travellersRepo.add(trip.id, 'Sam')
    await travellersRepo.rename(sam.id, 'Samantha')
    await expensesRepo.delete(e.id)
    await tripsRepo.setStatus(trip.id, 'completed')

    const entries = await db.outbox.toArray()
    expect(entries.map((x) => `${x.table}:${x.op}`).sort()).toEqual([
      'expenses:delete',
      'expenses:upsert',
      'travellers:upsert',
      'trips:upsert',
    ])
    expect(entries.every((x) => x.tripId === trip.id)).toBe(true)
  })

  it('links one traveller per signed-in user', async () => {
    const { trip, travellers } = await makeCloudTrip()
    await travellersRepo.linkUser(travellers[0]!.id, 'user-1')
    await travellersRepo.linkUser(travellers[1]!.id, 'user-1')
    const after = await travellersRepo.listByTrip(trip.id)
    expect(after.map((t) => t.userId ?? null)).toEqual([null, 'user-1'])
  })

  it('deleting a shared trip queues a single trip deletion and removes local data', async () => {
    const { trip, travellers } = await makeCloudTrip()
    await addExpense(trip, travellers, { amount: '5' })
    await tripsRepo.delete(trip.id)
    expect(await db.outbox.toArray()).toEqual([
      expect.objectContaining({ key: `trips:${trip.id}`, op: 'delete', table: 'trips' }),
    ])
    expect(await db.expenses.count()).toBe(0)
    expect(await db.travellers.count()).toBe(0)
  })

  it('removeLocalCopy leaves nothing behind, including queued changes', async () => {
    const { trip, travellers } = await makeCloudTrip()
    await addExpense(trip, travellers, { amount: '5' })
    await tripsRepo.removeLocalCopy(trip.id)
    for (const t of [db.trips, db.travellers, db.expenses, db.expenseShares, db.outbox]) {
      expect(await t.count()).toBe(0)
    }
  })
})
