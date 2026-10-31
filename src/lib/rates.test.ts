import { describe, expect, it } from 'vitest'
import { fetchLiveRate } from './rates'

const reply = (body: string, status = 200) => (async () => new Response(body, { status })) as unknown as typeof fetch

describe('fetchLiveRate', () => {
  it('reads the rate as exact text', async () => {
    const r = await fetchLiveRate('JPY', 'MYR', reply('{"amount":1.0,"base":"JPY","date":"2026-10-21","rates":{"MYR":0.02950}}'))
    expect(r).toEqual({ ok: true, value: { rate: '0.0295', date: '2026-10-21' } })
  })
  it('trims rates with too many decimals', async () => {
    const r = await fetchLiveRate('USD', 'MYR', reply('{"date":"2026-10-21","rates":{"MYR":4.123456789012}}'))
    expect(r.ok && r.value.rate).toBe('4.1234567890'.replace(/0+$/, ''))
  })
  it('handles scientific notation', async () => {
    const r = await fetchLiveRate('IDR', 'MYR', reply('{"date":"2026-10-21","rates":{"MYR":2.6e-4}}'))
    expect(r.ok && r.value.rate).toBe('0.00026')
  })
  it('reports unsupported currencies and outages', async () => {
    expect((await fetchLiveRate('XXX', 'MYR', reply('{}', 404))).ok).toBe(false)
    expect((await fetchLiveRate('JPY', 'MYR', reply('{}', 500))).ok).toBe(false)
    const offline = (async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    expect((await fetchLiveRate('JPY', 'MYR', offline)).ok).toBe(false)
  })
  it('rejects malformed currency codes without a request', async () => {
    const never = (() => { throw new Error('no request') }) as unknown as typeof fetch
    expect((await fetchLiveRate('A.B', 'MYR', never)).ok).toBe(false)
    expect((await fetchLiveRate('JPY', '(((', never)).ok).toBe(false)
  })
  it('returns 1 for the same currency without a request', async () => {
    expect((await fetchLiveRate('MYR', 'MYR', (() => { throw new Error('no') }) as unknown as typeof fetch))).toEqual({ ok: true, value: { rate: '1', date: '' } })
  })
})
