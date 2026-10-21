import { beforeEach, describe, expect, it } from 'vitest'
import { db, TravelDb, DB_NAME } from './schema'
import { categoriesRepo, expensesRepo, settingsRepo, travellersRepo, tripsRepo } from './repositories'
import { addExpense, makeTrip, tripInput } from '../test/fixtures'
import { summariseTrip } from '../features/dashboard/stats'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('repositories', () => {
  it('seeds the built-in categories and settings', async () => {
    const cats = await categoriesRepo.list()
    expect(cats.map((c) => c.name)).toContain('Food & Drinks')
    expect(cats).toHaveLength(9)
    expect((await settingsRepo.get()).defaultBaseCurrency).toBe('MYR')
  })

  it('keeps records after the database is closed and reopened', async () => {
    const { trip, travellers } = await makeTrip()
    await addExpense(trip, travellers, { amount: '12.30' })
    db.close()
    const reopened = new TravelDb(DB_NAME)
    await reopened.open()
    expect(await reopened.trips.count()).toBe(1)
    expect((await reopened.expenses.toArray())[0]?.baseAmountMinorUnits).toBe(1230)
    reopened.close()
    await db.open()
  })

  it('updates totals and remaining budget after add, edit and delete', async () => {
    const { trip, travellers } = await makeTrip()
    const a = await addExpense(trip, travellers, { amount: '100' })
    await addExpense(trip, travellers, { amount: '1000', currency: 'JPY', rate: '0.0312' })
    let s = summariseTrip(trip, await expensesRepo.listByTrip(trip.id), '2026-03-03')
    expect(s.spent).toBe(10000 + 3120)
    expect(s.remaining).toBe(100000 - 13120)

    const shares = await expensesRepo.sharesByExpense(a.id)
    const edited = { ...a, originalAmountMinorUnits: 5000, baseAmountMinorUnits: 5000 }
    await expensesRepo.save(
      a.id,
      edited,
      shares.map((x, i) => ({ ...x, allocatedBaseAmountMinorUnits: i === 0 ? 5000 - 2 * Math.floor(5000 / 3) : Math.floor(5000 / 3) })),
    )
    s = summariseTrip(trip, await expensesRepo.listByTrip(trip.id), '2026-03-03')
    expect(s.spent).toBe(5000 + 3120)
    expect(await expensesRepo.sharesByExpense(a.id)).toHaveLength(3)

    await expensesRepo.delete(a.id)
    s = summariseTrip(trip, await expensesRepo.listByTrip(trip.id), '2026-03-03')
    expect(s.spent).toBe(3120)
    expect(await db.expenseShares.where('expenseId').equals(a.id).count()).toBe(0)
  })

  it('refuses shares that do not add up', async () => {
    const { trip, travellers } = await makeTrip()
    const e = await addExpense(trip, travellers, { amount: '10' })
    await expect(
      expensesRepo.save(e.id, e, [{ travellerId: travellers[0]!.id, travellerNameSnapshot: 'Me', allocatedBaseAmountMinorUnits: 1 }]),
    ).rejects.toThrow()
    expect(await expensesRepo.sharesByExpense(e.id)).toHaveLength(3)
  })

  it('deleting one trip does not alter other trips', async () => {
    const one = await makeTrip()
    const two = await makeTrip(['Me'], { name: 'Other' })
    await addExpense(one.trip, one.travellers, { amount: '5' })
    await addExpense(two.trip, two.travellers, { amount: '7', splitMode: 'personal' })
    const before = await db.expenses.where('tripId').equals(two.trip.id).toArray()
    await tripsRepo.delete(one.trip.id)
    expect(await db.trips.count()).toBe(1)
    expect(await db.expenses.where('tripId').equals(one.trip.id).count()).toBe(0)
    expect(await db.expenseShares.where('tripId').equals(one.trip.id).count()).toBe(0)
    expect(await db.travellers.where('tripId').equals(one.trip.id).count()).toBe(0)
    expect(await db.expenses.where('tripId').equals(two.trip.id).toArray()).toEqual(before)
    expect(await db.travellers.where('tripId').equals(two.trip.id).count()).toBe(1)
  })

  it('protects travellers that are referenced by expenses', async () => {
    const { trip, travellers } = await makeTrip()
    await addExpense(trip, travellers, { amount: '9' })
    await expect(travellersRepo.remove(travellers[1]!.id)).rejects.toThrow(/part of saved expenses/)
    const extra = await travellersRepo.add(trip.id, 'Kim')
    await travellersRepo.remove(extra.id)
    expect(await travellersRepo.listByTrip(trip.id)).toHaveLength(3)
  })

  it('blocks base currency changes once a trip has expenses', async () => {
    const { trip, travellers } = await makeTrip()
    await tripsRepo.update(trip.id, tripInput({ baseCurrency: 'SGD' }))
    const updated = (await tripsRepo.get(trip.id))!
    await addExpense(updated, travellers, { amount: '1', currency: 'SGD' })
    await expect(tripsRepo.update(trip.id, tripInput({ baseCurrency: 'MYR' }))).rejects.toThrow(/base currency/)
  })

  it('manages custom categories', async () => {
    const c = await categoriesRepo.add('Gifts')
    await expect(categoriesRepo.add('gifts')).rejects.toThrow()
    await categoriesRepo.rename(c.id, 'Souvenirs')
    await expect(categoriesRepo.remove('cat-food')).rejects.toThrow()
    await categoriesRepo.remove(c.id)
    expect(await categoriesRepo.list()).toHaveLength(9)
  })

  it('counts changes for the backup reminder', async () => {
    await makeTrip()
    expect((await settingsRepo.get()).changesSinceBackup).toBe(1)
    await settingsRepo.markBackedUp()
    expect((await settingsRepo.get()).changesSinceBackup).toBe(0)
  })
})

describe('traveller order', () => {
  it('keeps the entered order so the first traveller is the default payer', async () => {
    await db.delete()
    await db.open()
    for (let i = 0; i < 10; i++) {
      const { travellers } = await makeTrip(['Me', 'Alex', 'Sam', 'Kim'])
      expect(travellers.map((t) => t.displayName)).toEqual(['Me', 'Alex', 'Sam', 'Kim'])
    }
  })
})
