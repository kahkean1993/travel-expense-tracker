/**
 * Decimal-safe money utilities.
 *
 * Amounts are integer minor units (see src/types/domain.ts). Parsing user
 * input and currency conversion are done on strings / BigInt so no
 * floating-point rounding errors can creep into stored values.
 *
 * Rounding rule: converted amounts are rounded half-up (away from zero for
 * the positive amounts this app stores) to the base currency's minor unit.
 */

import type { CurrencyCode } from '../../types/domain'

/** Largest amount (in major units) accepted for a single expense or budget. */
export const MAX_MAJOR_AMOUNT = 1_000_000_000_000
/** Hard cap on any stored minor-unit value, well inside Number.MAX_SAFE_INTEGER. */
export const MAX_MINOR_UNITS = 1e15
/** Exchange rates are accepted with up to this many decimal places. */
export const MAX_RATE_DECIMALS = 10
export const MAX_RATE = 1_000_000

export const COMMON_CURRENCIES: CurrencyCode[] = [
  'MYR', 'JPY', 'USD', 'CNY', 'THB', 'SGD', 'EUR', 'GBP', 'KRW', 'IDR', 'TWD', 'AUD',
]

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

function supportedCurrencies(): Set<string> | null {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }
  if (typeof intl.supportedValuesOf !== 'function') return null
  try {
    return new Set(intl.supportedValuesOf('currency'))
  } catch {
    return null
  }
}
const SUPPORTED = supportedCurrencies()

export function normaliseCurrencyCode(input: string): string {
  return input.trim().toUpperCase()
}

/** True for a well-formed ISO 4217 code known to this browser's Intl data. */
export function isValidCurrencyCode(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false
  if (SUPPORTED) return SUPPORTED.has(code)
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code })
    return true
  } catch {
    return false
  }
}

/**
 * ISO 4217 minor-unit exponents for currencies that do not use 2 decimals.
 * This table is part of the storage format: stored minor units are read
 * with these digits, so they must never depend on the browser's Intl data
 * (which differs between versions, e.g. IDR is 2 in some and 0 in others).
 * Changing an existing entry requires a data migration.
 */
const ISO_MINOR_UNITS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, JPY: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
  BHD: 3, IQD: 3, JOD: 3, KWD: 3, LYD: 3, OMR: 3, TND: 3,
  CLF: 4, UYW: 4,
}

/** Number of minor-unit digits for a currency per ISO 4217, e.g. MYR → 2, JPY → 0. */
export function currencyFractionDigits(code: CurrencyCode): number {
  return ISO_MINOR_UNITS[code] ?? 2
}

/** Three upper-case letters. Used for stored data, which may come from another browser. */
export function isWellFormedCurrencyCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code)
}

/** Converts minor units to a plain decimal string, e.g. (1234, 2) → "12.34". */
export function minorToDecimalString(minor: number, digits: number): string {
  const negative = minor < 0
  const abs = BigInt(Math.abs(minor)).toString()
  if (digits === 0) return (negative ? '-' : '') + abs
  const padded = abs.padStart(digits + 1, '0')
  const whole = padded.slice(0, padded.length - digits)
  const frac = padded.slice(padded.length - digits)
  return `${negative ? '-' : ''}${whole}.${frac}`
}

export function minorToInputString(minor: number, currency: CurrencyCode): string {
  return minorToDecimalString(minor, currencyFractionDigits(currency))
}

/**
 * Parses a user-entered amount into minor units.
 * Accepts "12", "12.5", "1,234.50". Rejects negatives, NaN, too many decimals.
 */
export function parseAmountToMinor(
  input: string,
  currency: CurrencyCode,
  options: { allowZero?: boolean } = {},
): Result<number> {
  const digits = currencyFractionDigits(currency)
  let text = input.trim().replace(/\s/g, '')
  if (text === '') return { ok: false, error: 'Enter an amount.' }
  if (text.startsWith('-')) return { ok: false, error: 'Amount cannot be negative.' }
  if (text.includes(',')) {
    if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(text)) {
      return { ok: false, error: 'Use a dot for decimals, e.g. 12.50.' }
    }
    text = text.replace(/,/g, '')
  }
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match || (match[1] === '' && (match[2] ?? '') === '')) {
    return { ok: false, error: 'Enter a valid number, e.g. 12.50.' }
  }
  const whole = match[1] || '0'
  const frac = match[2] ?? ''
  if (frac.length > digits) {
    return {
      ok: false,
      error:
        digits === 0
          ? `${currency} amounts have no decimal places.`
          : `${currency} allows at most ${digits} decimal place${digits === 1 ? '' : 's'}.`,
    }
  }
  const minorBig = BigInt(whole) * 10n ** BigInt(digits) + BigInt(frac.padEnd(digits, '0') || '0')
  if (minorBig > BigInt(MAX_MAJOR_AMOUNT) * 10n ** BigInt(digits) || minorBig > BigInt(MAX_MINOR_UNITS)) {
    return { ok: false, error: 'Amount is too large.' }
  }
  const minor = Number(minorBig)
  if (minor === 0 && !options.allowZero) return { ok: false, error: 'Amount must be greater than zero.' }
  return { ok: true, value: minor }
}

/** Validates and normalises an exchange rate string ("0.03120" → "0.0312"). */
export function parseExchangeRate(input: string): Result<string> {
  const text = input.trim().replace(/\s/g, '')
  if (text === '') return { ok: false, error: 'Enter the exchange rate.' }
  const match = /^(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match || (match[1] === '' && (match[2] ?? '') === '')) {
    return { ok: false, error: 'Enter a valid positive number, e.g. 0.0312.' }
  }
  const whole = (match[1] || '0').replace(/^0+(?=\d)/, '')
  const frac = (match[2] ?? '').replace(/0+$/, '')
  if (frac.length > MAX_RATE_DECIMALS) {
    return { ok: false, error: `Use at most ${MAX_RATE_DECIMALS} decimal places.` }
  }
  if (/^0*$/.test(whole) && frac === '') return { ok: false, error: 'Exchange rate must be greater than zero.' }
  if (BigInt(whole) >= BigInt(MAX_RATE)) return { ok: false, error: 'Exchange rate is too large.' }
  return { ok: true, value: frac ? `${whole}.${frac}` : whole }
}

/** Splits a normalised rate string into an integer numerator and power-of-ten scale. */
function rateToFraction(rate: string): { numerator: bigint; scale: number } {
  const [whole = '0', frac = ''] = rate.split('.')
  return { numerator: BigInt(whole + frac), scale: frac.length }
}

/**
 * Converts an amount in minor units of `from` into minor units of `to`
 * using "1 from = rate to". Same-currency conversion always returns the
 * input unchanged (the rate is ignored), preventing double conversion.
 */
export function convertMinorUnits(
  originalMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  rate: string,
): number {
  if (!Number.isSafeInteger(originalMinor) || originalMinor < 0) {
    throw new RangeError('Amount must be a non-negative safe integer')
  }
  if (from === to) return originalMinor
  const parsed = parseExchangeRate(rate)
  if (!parsed.ok) throw new RangeError(parsed.error)
  const { numerator, scale } = rateToFraction(parsed.value)
  const fromDigits = currencyFractionDigits(from)
  const toDigits = currencyFractionDigits(to)
  // result = original / 10^fromDigits * (numerator / 10^scale) * 10^toDigits
  const num = BigInt(originalMinor) * numerator * 10n ** BigInt(toDigits)
  const den = 10n ** BigInt(scale + fromDigits)
  const rounded = (num * 2n + den) / (den * 2n) // round half up
  if (rounded > BigInt(MAX_MINOR_UNITS)) throw new RangeError('Converted amount is too large')
  return Number(rounded)
}

/** Sums minor-unit amounts, asserting the result stays exact. */
export function sumMinor(values: Iterable<number>): number {
  let total = 0
  for (const v of values) total += v
  if (!Number.isSafeInteger(total)) throw new RangeError('Total exceeds safe integer range')
  return total
}

const formatterCache = new Map<string, Intl.NumberFormat>()
function formatter(currency: CurrencyCode, locale?: string): Intl.NumberFormat {
  const key = `${locale ?? ''}|${currency}`
  let f = formatterCache.get(key)
  if (!f) {
    const digits = currencyFractionDigits(currency)
    // Pin decimals to the stored precision so display never rounds a saved amount.
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    formatterCache.set(key, f)
  }
  return f
}

/** Formats minor units for display, e.g. (1250, "MYR") → "RM 12.50" (locale dependent). */
export function formatMoney(minor: number, currency: CurrencyCode, locale?: string): string {
  const text = minorToDecimalString(minor, currencyFractionDigits(currency))
  // Intl accepts decimal strings exactly (no float conversion).
  return formatter(currency, locale).format(text as unknown as number)
}

/** The currency symbol as the display locale renders it, e.g. "RM" or "¥". */
export function currencySymbol(currency: CurrencyCode, locale?: string): string {
  const part = formatter(currency, locale)
    .formatToParts(0)
    .find((p) => p.type === 'currency')
  return part?.value ?? currency
}

/** Human-readable rate direction, e.g. "1 JPY = RM 0.0312". */
export function describeRate(from: CurrencyCode, to: CurrencyCode, rate: string, locale?: string): string {
  return `1 ${from} = ${currencySymbol(to, locale)} ${rate}`
}

/** Percentage of budget used, with one decimal place, computed on integers. */
export function percentUsed(spentMinor: number, budgetMinor: number): number | null {
  if (budgetMinor <= 0) return null
  const tenths = (BigInt(spentMinor) * 1000n * 2n + BigInt(budgetMinor)) / (BigInt(budgetMinor) * 2n)
  return Number(tenths) / 10
}
