import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/schema'
import { categoriesRepo, settlementsRepo } from '../../db/repositories'
import { addExpense, makeTrip } from '../../test/fixtures'
import { createBackup, importMerge, importReplace, parseBackup, previewImport } from './backup'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

async function snapshot() {
  const b = await createBackup()
  return b.data
}

describe('backup and restore', () => {
  it('round-trips trips, expenses, rates, shares and settings', async () => {
    const { trip, travellers } = await makeTrip()
    await categoriesRepo.add('Gifts')
    await addExpense(trip, travellers, { amount: '1500', currency: 'JPY', rate: '0.0312', notes: 'line1\nline2, "quoted"' })
    await addExpense(trip, travellers, {
      amount: '10.01',
      splitMode: 'custom_weight',
      weights: { [travellers[0]!.id]: '2' },
    })
    await db.settings.update('app', { defaultBaseCurrency: 'SGD' })
    const before = await snapshot()
    const text = JSON.stringify(await createBackup())

    await db.delete()
    await db.open()
    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    await importReplace(parsed.backup)
    const after = await snapshot()
    expect(after.trips).toEqual(before.trips.map((t) => ({ ...t, syncMode: 'local' })))
    expect(after.travellers).toEqual(before.travellers)
    expect(after.expenses).toEqual(before.expenses)
    expect(after.expenseShares.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      before.expenseShares.sort((a, b) => a.id.localeCompare(b.id)),
    )
    expect(after.categories.sort((a, b) => a.id.localeCompare(b.id))).toEqual(
      before.categories.sort((a, b) => a.id.localeCompare(b.id)),
    )
    expect(after.settings?.defaultBaseCurrency).toBe('SGD')
    expect(after.expenses.find((e) => e.originalCurrency === 'JPY')?.exchangeRate).toBe('0.0312')
  })

  it('merge adds new trips and never overwrites existing ones', async () => {
    const a = await makeTrip(['Me'], { name: 'A' })
    await addExpense(a.trip, a.travellers, { amount: '5', splitMode: 'personal' })
    const backupText = JSON.stringify(await createBackup())
    // Change existing trip locally after backup; merge must not revert it.
    await db.trips.update(a.trip.id, { name: 'A renamed' })
    await db.delete()
    await db.open()
    const b = await makeTrip(['Me'], { name: 'B' })
    const parsed = parseBackup(backupText)
    if (!parsed.ok) throw new Error(parsed.error)
    const preview = await previewImport(parsed.backup)
    expect(preview.newTrips).toBe(1)
    const result = await importMerge(parsed.backup)
    expect(result).toEqual({ addedTrips: 1, skippedTrips: 0 })
    expect((await db.trips.toArray()).map((t) => t.name).sort()).toEqual(['A', 'B'])

    // Merging the same backup again skips the existing trip.
    const again = await importMerge(parsed.backup)
    expect(again).toEqual({ addedTrips: 0, skippedTrips: 1 })
    expect(await db.expenses.count()).toBe(1)
    expect(await db.trips.get(b.trip.id)).toBeTruthy()
  })

  it('merge reuses an existing category with the same name instead of duplicating it', async () => {
    const gifts = await categoriesRepo.add('Gifts')
    const a = await makeTrip(['Me'], { name: 'A' })
    await addExpense(a.trip, a.travellers, { amount: '5', splitMode: 'personal', categoryId: gifts.id })
    const backupText = JSON.stringify(await createBackup())
    await db.delete()
    await db.open()
    const localGifts = await categoriesRepo.add('gifts')
    const parsed = parseBackup(backupText)
    if (!parsed.ok) throw new Error(parsed.error)
    await importMerge(parsed.backup)
    const cats = (await db.categories.toArray()).filter((c) => c.name.toLowerCase() === 'gifts')
    expect(cats).toHaveLength(1)
    expect((await db.expenses.toArray())[0]?.categoryId).toBe(localGifts.id)
  })

  it('rejects invalid files with a helpful message and leaves data untouched', async () => {
    const { trip, travellers } = await makeTrip()
    await addExpense(trip, travellers, { amount: '5' })
    const before = await snapshot()

    expect(parseBackup('not json')).toEqual({ ok: false, error: expect.stringMatching(/not valid JSON/) })
    expect(parseBackup('{"hello":1}')).toEqual({ ok: false, error: expect.stringMatching(/not a Travel Expense Tracker backup/) })

    const good = await createBackup()
    const newer = { ...good, formatVersion: 99 }
    expect(parseBackup(JSON.stringify(newer))).toEqual({ ok: false, error: expect.stringMatching(/newer version/) })

    const badAmount = structuredClone(good)
    badAmount.data.expenses[0]!.baseAmountMinorUnits = 12.5
    expect(parseBackup(JSON.stringify(badAmount)).ok).toBe(false)

    const badShares = structuredClone(good)
    badShares.data.expenseShares[0]!.allocatedBaseAmountMinorUnits += 1
    expect(parseBackup(JSON.stringify(badShares))).toEqual({ ok: false, error: expect.stringMatching(/do not add up/) })

    const badRate = structuredClone(good)
    badRate.data.expenses[0]!.originalCurrency = 'JPY'
    expect(parseBackup(JSON.stringify(badRate)).ok).toBe(false)

    const badCurrency = structuredClone(good)
    badCurrency.data.trips[0]!.baseCurrency = 'RM'
    expect(parseBackup(JSON.stringify(badCurrency))).toEqual({ ok: false, error: expect.stringMatching(/currency code/) })

    const orphan = structuredClone(good)
    orphan.data.expenses[0]!.tripId = 'missing'
    expect(parseBackup(JSON.stringify(orphan)).ok).toBe(false)

    expect(await snapshot()).toEqual(before)
  })
})

describe('payments in backups', () => {
  it('round-trips recorded payments', async () => {
    const { trip, travellers } = await makeTrip(['Me', 'Alex'])
    await addExpense(trip, travellers, { amount: '40' })
    await settlementsRepo.add(trip.id, { fromTravellerId: travellers[1]!.id, toTravellerId: travellers[0]!.id, amountMinorUnits: 1500, paidOn: '2026-03-05' })
    const before = (await createBackup()).data.settlements
    expect(before).toHaveLength(1)
    const parsed = parseBackup(JSON.stringify(await createBackup()))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect((await previewImport(parsed.backup)).totalPayments).toBe(1)
    await importReplace(parsed.backup)
    expect((await createBackup()).data.settlements).toEqual(before)
  })

  it('still restores version 1 backups, which have no payments', async () => {
    const { trip, travellers } = await makeTrip(['Me', 'Alex'])
    await addExpense(trip, travellers, { amount: '40' })
    const file = JSON.parse(JSON.stringify(await createBackup()))
    delete file.data.settlements
    file.formatVersion = 1
    const parsed = parseBackup(JSON.stringify(file))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.backup.data.settlements).toEqual([])
  })

  it('rejects payments that point at unknown people or pay themselves', async () => {
    const { trip, travellers } = await makeTrip(['Me', 'Alex'])
    await settlementsRepo.add(trip.id, { fromTravellerId: travellers[1]!.id, toTravellerId: travellers[0]!.id, amountMinorUnits: 100, paidOn: '2026-03-05' })
    const file = JSON.parse(JSON.stringify(await createBackup()))
    file.data.settlements[0].toTravellerId = 'ghost'
    expect(parseBackup(JSON.stringify(file)).ok).toBe(false)
    file.data.settlements[0].toTravellerId = file.data.settlements[0].fromTravellerId
    expect(parseBackup(JSON.stringify(file)).ok).toBe(false)
  })
})
