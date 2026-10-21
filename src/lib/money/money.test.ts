import { describe, expect, it } from 'vitest'
import {
  convertMinorUnits,
  currencyFractionDigits,
  formatMoney,
  isValidCurrencyCode,
  minorToDecimalString,
  parseAmountToMinor,
  parseExchangeRate,
  percentUsed,
  sumMinor,
  describeRate,
} from './money'

describe('currency precision', () => {
  it('uses ISO fraction digits', () => {
    expect(currencyFractionDigits('MYR')).toBe(2)
    expect(currencyFractionDigits('JPY')).toBe(0)
    expect(currencyFractionDigits('KRW')).toBe(0)
    expect(currencyFractionDigits('KWD')).toBe(3)
  })

  it('does not depend on the browser\'s Intl data', () => {
    // Intl reports 0 or 2 for IDR depending on the ICU version; storage must not change.
    expect(currencyFractionDigits('IDR')).toBe(2)
    expect(currencyFractionDigits('HUF')).toBe(2)
    expect(currencyFractionDigits('TWD')).toBe(2)
    expect(currencyFractionDigits('VND')).toBe(0)
    expect(currencyFractionDigits('CLF')).toBe(4)
  })

  it('formats with exactly the stored precision', () => {
    expect(formatMoney(5000050, 'IDR', 'en-US')).toMatch(/50,000\.50$/)
    expect(formatMoney(1234, 'KWD', 'en-US')).toMatch(/1\.234$/)
  })

  it('validates currency codes', () => {
    expect(isValidCurrencyCode('MYR')).toBe(true)
    expect(isValidCurrencyCode('TWD')).toBe(true)
    expect(isValidCurrencyCode('myr')).toBe(false)
    expect(isValidCurrencyCode('XYZ')).toBe(false)
    expect(isValidCurrencyCode('RM')).toBe(false)
  })
})

describe('parseAmountToMinor', () => {
  it('parses decimals into minor units without float error', () => {
    expect(parseAmountToMinor('12.50', 'MYR')).toEqual({ ok: true, value: 1250 })
    expect(parseAmountToMinor('0.1', 'MYR')).toEqual({ ok: true, value: 10 })
    expect(parseAmountToMinor('1,234.56', 'MYR')).toEqual({ ok: true, value: 123456 })
    expect(parseAmountToMinor('1500', 'JPY')).toEqual({ ok: true, value: 1500 })
    expect(parseAmountToMinor('.5', 'USD')).toEqual({ ok: true, value: 50 })
  })

  it('rejects invalid amounts', () => {
    for (const bad of ['', 'abc', '-5', '1e5', 'NaN', 'Infinity', '1.2.3', '0', '0.00', '12,5']) {
      expect(parseAmountToMinor(bad, 'MYR').ok, bad).toBe(false)
    }
    expect(parseAmountToMinor('10.5', 'JPY').ok).toBe(false)
    expect(parseAmountToMinor('1.234', 'MYR').ok).toBe(false)
    expect(parseAmountToMinor('99999999999999', 'MYR').ok).toBe(false)
  })

  it('allows zero when asked (budgets)', () => {
    expect(parseAmountToMinor('0', 'MYR', { allowZero: true })).toEqual({ ok: true, value: 0 })
  })
})

describe('parseExchangeRate', () => {
  it('normalises rates', () => {
    expect(parseExchangeRate('0.03120')).toEqual({ ok: true, value: '0.0312' })
    expect(parseExchangeRate('004.70')).toEqual({ ok: true, value: '4.7' })
    expect(parseExchangeRate('1')).toEqual({ ok: true, value: '1' })
  })
  it('rejects zero, negative and junk', () => {
    for (const bad of ['', '0', '0.000', '-1', 'abc', '1e-3', '0.12345678901']) {
      expect(parseExchangeRate(bad).ok, bad).toBe(false)
    }
  })
})

describe('convertMinorUnits', () => {
  it('same currency returns the amount unchanged, ignoring the rate', () => {
    expect(convertMinorUnits(1234, 'MYR', 'MYR', '1')).toBe(1234)
    expect(convertMinorUnits(1234, 'MYR', 'MYR', '4.5')).toBe(1234)
  })

  it('uses "1 FROM = rate TO" direction', () => {
    // 1000 JPY at 1 JPY = 0.0312 MYR → RM 31.20
    expect(convertMinorUnits(1000, 'JPY', 'MYR', '0.0312')).toBe(3120)
    // USD 10.00 at 1 USD = 4.7 MYR → RM 47.00
    expect(convertMinorUnits(1000, 'USD', 'MYR', '4.7')).toBe(4700)
    // RM 10.00 at 1 MYR = 33.5 JPY → ¥335
    expect(convertMinorUnits(1000, 'MYR', 'JPY', '33.5')).toBe(335)
  })

  it('rounds half up to the base currency precision', () => {
    // 15 JPY * 0.0311 = 0.4665 MYR → 0.47
    expect(convertMinorUnits(15, 'JPY', 'MYR', '0.0311')).toBe(47)
    // 1 JPY * 0.0305 = 0.0305 → 0.03
    expect(convertMinorUnits(1, 'JPY', 'MYR', '0.0305')).toBe(3)
    // exactly half: 1 JPY * 0.035 = 0.035 → 0.04
    expect(convertMinorUnits(1, 'JPY', 'MYR', '0.035')).toBe(4)
    // MYR 0.01 at 33.49 JPY → 0.3349 → ¥0
    expect(convertMinorUnits(1, 'MYR', 'JPY', '33.49')).toBe(0)
  })

  it('handles very small amounts and classic float traps', () => {
    // 0.1 + 0.2 style trap: USD 0.29 * 100 should be exact
    expect(convertMinorUnits(29, 'USD', 'MYR', '1')).toBe(29)
    expect(convertMinorUnits(1, 'USD', 'MYR', '4.7')).toBe(5) // 0.047 → 0.05
    expect(convertMinorUnits(1, 'IDR', 'MYR', '0.0003')).toBe(0)
    expect(convertMinorUnits(100000000, 'IDR', 'MYR', '0.00029')).toBe(29000)
  })

  it('aggregates mixed currencies only after conversion', () => {
    const items = [
      convertMinorUnits(1000, 'JPY', 'MYR', '0.0312'), // 31.20
      convertMinorUnits(2000, 'USD', 'MYR', '4.7'), // 94.00
      convertMinorUnits(1550, 'MYR', 'MYR', '1'), // 15.50
    ]
    expect(sumMinor(items)).toBe(14070)
  })

  it('rejects invalid input', () => {
    expect(() => convertMinorUnits(-1, 'JPY', 'MYR', '0.03')).toThrow()
    expect(() => convertMinorUnits(1.5, 'JPY', 'MYR', '0.03')).toThrow()
    expect(() => convertMinorUnits(100, 'JPY', 'MYR', '0')).toThrow()
  })
})

describe('display helpers', () => {
  const nbsp = (s: string) => s.replace(/\u00a0/g, ' ')

  it('formats minor units with Intl', () => {
    expect(minorToDecimalString(1250, 2)).toBe('12.50')
    expect(minorToDecimalString(5, 2)).toBe('0.05')
    expect(minorToDecimalString(-5, 2)).toBe('-0.05')
    expect(minorToDecimalString(1500, 0)).toBe('1500')
    expect(nbsp(formatMoney(123456, 'MYR', 'en-MY'))).toBe('RM 1,234.56')
    expect(formatMoney(1500, 'JPY', 'en-US')).toBe('¥1,500')
    expect(nbsp(describeRate('JPY', 'MYR', '0.0312', 'en-MY'))).toBe('1 JPY = RM 0.0312')
  })

  it('computes percentage used on integers', () => {
    expect(percentUsed(800, 1000)).toBe(80)
    expect(percentUsed(1, 3)).toBe(33.3)
    expect(percentUsed(1500, 1000)).toBe(150)
    expect(percentUsed(10, 0)).toBeNull()
  })
})
