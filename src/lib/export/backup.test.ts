import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../db/schema'
import { categoriesRepo } from '../../db/repositories'
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
    expect(after.trips).toEqual(before.trips)
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
    badCurrency.data.trips[0]!.baseCurrency = 'ZZZ'
    expect(parseBackup(JSON.stringify(badCurrency))).toEqual({ ok: false, error: expect.stringMatching(/currency code/) })

    const orphan = structuredClone(good)
    orphan.data.expenses[0]!.tripId = 'missing'
    expect(parseBackup(JSON.stringify(orphan)).ok).toBe(false)

    expect(await snapshot()).toEqual(before)
  })
})
