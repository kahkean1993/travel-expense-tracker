/**
 * Looks up a day's mid-market exchange rate from the free Frankfurter service
 * (European Central Bank reference rates, no account or key). Only the two
 * currency codes are sent. The result is only a suggestion for the rate field.
 */
import { parseExchangeRate, type Result } from './money/money'

const ENDPOINT = 'https://api.frankfurter.dev/v1/latest'

export interface LiveRate {
  rate: string
  /** The date the service says the rate is from. */
  date: string
}

export async function fetchLiveRate(from: string, to: string, fetcher: typeof fetch = fetch): Promise<Result<LiveRate>> {
  if (from === to) return { ok: true, value: { rate: '1', date: '' } }
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return { ok: false, error: 'Use 3-letter currency codes like JPY. Enter the rate yourself.' }
  let response: Response
  try {
    response = await fetcher(`${ENDPOINT}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`, {
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return { ok: false, error: 'Could not reach the rate service. Enter the rate yourself.' }
  }
  if (response.status === 404 || response.status === 422) {
    return { ok: false, error: `No live rate for ${from} → ${to}. Enter the rate yourself.` }
  }
  if (!response.ok) return { ok: false, error: 'The rate service is not available right now. Enter the rate yourself.' }
  // Read the number as text so it never passes through floating point.
  const text = await response.text()
  const match = new RegExp(`"${to}"\\s*:\\s*([0-9.eE+-]+)`).exec(text)
  const date = /"date"\s*:\s*"(\d{4}-\d{2}-\d{2})"/.exec(text)?.[1] ?? ''
  if (!match) return { ok: false, error: `No live rate for ${from} → ${to}. Enter the rate yourself.` }
  let raw = match[1]!
  if (/e/i.test(raw)) raw = Number(raw).toFixed(10)
  const rate = parseExchangeRate(raw.includes('.') ? raw.replace(/(\.\d{10})\d+$/, '$1') : raw)
  if (!rate.ok) return { ok: false, error: 'The rate service returned an unusable rate. Enter the rate yourself.' }
  return { ok: true, value: { rate: rate.value, date } }
}
