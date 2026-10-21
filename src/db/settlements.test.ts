import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './schema'
import { expensesRepo, settlementsRepo, travellersRepo, tripsRepo, TRIP_LOCKED } from './repositories'
import { addExpense, makeTrip } from '../test/fixtures'
import { settlementFor } from '../features/splitting/settlement'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function tripWithDinner() {
  const made = await makeTrip(['Me', 'Alex', 'Sam'])
  // Me pays 90.00 split equally: Alex and Sam each owe 30.00.
  const dinner = await addExpense(made.trip, made.travellers, { amount: '90' })
  const [me, alex, sam] = made.travellers.map((t) => t.id) as [string, string, string]
  return { ...made, dinner, me, alex, sam }
}
const reload = async (tripId: string) => ({
  travellers: await travellersRepo.listByTrip(tripId),
  expenses: await expensesRepo.listByTrip(tripId),
  shares: await expensesRepo.sharesByTrip(tripId),
  settlements: await settlementsRepo.listByTrip(tripId),
})

describe('settlement payments', () => {
  it('records a payment, which changes balances and the suggestions', async () => {
    const { trip, me, alex, sam } = await tripWithDinner()
    await settlementsRepo.add(trip.id, { fromTravellerId: alex, toTravellerId: me, amountMinorUnits: 3000, paidOn: '2026-03-05' })
    const { balances, transfers } = settlementFor(await reload(trip.id))
    expect(balances.find((b) => b.travellerId === alex)).toMatchObject({ sent: 3000, net: 0 })
    expect(balances.find((b) => b.travellerId === me)).toMatchObject({ received: 3000, net: 3000 })
    expect(transfers).toEqual([{ fromTravellerId: sam, toTravellerId: me, amount: 3000 }])
  })

  it('supports partial payments and undoing a payment', async () => {
    const { trip, me, alex } = await tripWithDinner()
    const part = await settlementsRepo.add(trip.id, { fromTravellerId: alex, toTravellerId: me, amountMinorUnits: 1000, paidOn: '2026-03-05', note: '  cash  ' })
    expect(part.note).toBe('cash')
    expect(settlementFor(await reload(trip.id)).transfers.find((t) => t.fromTravellerId === alex)?.amount).toBe(2000)
    await settlementsRepo.remove(part.id)
    expect(settlementFor(await reload(trip.id)).transfers.find((t) => t.fromTravellerId === alex)?.amount).toBe(3000)
  })

  it('rejects nonsense payments', async () => {
    const { trip, me, alex } = await tripWithDinner()
    const other = await makeTrip(['Zed', 'Yan'], { name: 'Other' })
    const ok = { fromTravellerId: alex, toTravellerId: me, amountMinorUnits: 100, paidOn: '2026-03-05' }
    await expect(settlementsRepo.add(trip.id, { ...ok, amountMinorUnits: 0 })).rejects.toThrow(/greater than zero/)
    await expect(settlementsRepo.add(trip.id, { ...ok, amountMinorUnits: 1.5 })).rejects.toThrow(/greater than zero/)
    await expect(settlementsRepo.add(trip.id, { ...ok, toTravellerId: alex })).rejects.toThrow(/themselves/)
    await expect(settlementsRepo.add(trip.id, { ...ok, toTravellerId: other.travellers[0]!.id })).rejects.toThrow(/on this trip/)
    expect(await db.settlements.count()).toBe(0)
  })

  it('stops a person with payments from being removed', async () => {
    const { trip, me, alex } = await tripWithDinner()
    const extra = await travellersRepo.add(trip.id, 'Kim')
    await settlementsRepo.add(trip.id, { fromTravellerId: extra.id, toTravellerId: me, amountMinorUnits: 100, paidOn: '2026-03-05' })
    await expect(travellersRepo.remove(extra.id)).rejects.toThrow(/expenses or payments/)
    expect(await travellersRepo.usageCount(alex)).toBe(1)
  })

  it('is deleted with its trip and leaves other trips alone', async () => {
    const one = await tripWithDinner()
    const two = await tripWithDinner()
    await settlementsRepo.add(one.trip.id, { fromTravellerId: one.alex, toTravellerId: one.me, amountMinorUnits: 100, paidOn: '2026-03-05' })
    await settlementsRepo.add(two.trip.id, { fromTravellerId: two.alex, toTravellerId: two.me, amountMinorUnits: 200, paidOn: '2026-03-05' })
    await tripsRepo.delete(one.trip.id)
    expect((await db.settlements.toArray()).map((s) => s.amountMinorUnits)).toEqual([200])
  })
})

describe('completed trips', () => {
  it('lock expenses but still allow settling up', async () => {
    const { trip, travellers, dinner, me, alex } = await tripWithDinner()
    await tripsRepo.setStatus(trip.id, 'completed')
    const completed = (await tripsRepo.get(trip.id))!

    await expect(addExpense(completed, travellers, { amount: '5' })).rejects.toThrow(TRIP_LOCKED)
    await expect(expensesRepo.delete(dinner.id)).rejects.toThrow(TRIP_LOCKED)
    const shares = await expensesRepo.sharesByExpense(dinner.id)
    await expect(expensesRepo.save(dinner.id, { ...dinner, description: 'Changed' }, shares)).rejects.toThrow(TRIP_LOCKED)
    expect((await expensesRepo.get(dinner.id))?.description).not.toBe('Changed')

    await settlementsRepo.add(trip.id, { fromTravellerId: alex, toTravellerId: me, amountMinorUnits: 3000, paidOn: '2026-03-05' })
    await tripsRepo.setStatus(trip.id, 'active')
    await expensesRepo.delete(dinner.id)
  })
})

describe('settlements on shared trips', () => {
  it('are queued for upload and for deletion', async () => {
    const { trip, me, alex } = await tripWithDinner()
    await db.trips.update(trip.id, { syncMode: 'cloud', ownerId: 'u1' })
    await db.outbox.clear()
    const payment = await settlementsRepo.add(trip.id, { fromTravellerId: alex, toTravellerId: me, amountMinorUnits: 3000, paidOn: '2026-03-05' })
    expect(await db.outbox.toArray()).toEqual([expect.objectContaining({ key: `settlements:${payment.id}`, table: 'settlements', op: 'upsert', tripId: trip.id })])
    await settlementsRepo.remove(payment.id)
    expect(await db.outbox.toArray()).toEqual([expect.objectContaining({ key: `settlements:${payment.id}`, op: 'delete' })])
  })
})

describe('payments in another currency', () => {
  it('keeps the original amount and rate next to the trip-currency amount', async () => {
    const { trip, me, alex } = await tripWithDinner()
    const p = await settlementsRepo.add(trip.id, {
      fromTravellerId: alex, toTravellerId: me, amountMinorUnits: 3000, paidOn: '2026-03-05',
      originalAmountMinorUnits: 100000, originalCurrency: 'JPY', exchangeRate: '0.03',
    })
    expect(p).toMatchObject({ originalAmountMinorUnits: 100000, originalCurrency: 'JPY', exchangeRate: '0.03' })
    const [stored] = await settlementsRepo.listByTrip(trip.id)
    expect(stored).toMatchObject({ amountMinorUnits: 3000, originalCurrency: 'JPY' })
  })

  it('rejects incomplete or invalid currency details', async () => {
    const { trip, me, alex } = await tripWithDinner()
    const base = { fromTravellerId: alex, toTravellerId: me, amountMinorUnits: 3000, paidOn: '2026-03-05' }
    await expect(settlementsRepo.add(trip.id, { ...base, originalCurrency: 'JPY' })).rejects.toThrow(/currency details/)
    await expect(settlementsRepo.add(trip.id, { ...base, originalAmountMinorUnits: 5, originalCurrency: 'jp', exchangeRate: '0.03' })).rejects.toThrow(/currency details/)
    expect(await settlementsRepo.listByTrip(trip.id)).toEqual([])
  })
})
