import { describe, expect, it } from 'vitest'
import { toRemoteError } from './supabaseRemote'

describe('toRemoteError', () => {
  it('treats fetch failures as network errors', () => {
    expect(toRemoteError({ message: 'TypeError: Failed to fetch' }, 0).kind).toBe('network')
    expect(toRemoteError({ message: 'Load failed' }).kind).toBe('network')
  })
  it('treats expired sessions as auth errors', () => {
    expect(toRemoteError({ message: 'JWT expired', code: 'PGRST301' }, 401).kind).toBe('auth')
  })
  it('treats validation and permission errors as rejected', () => {
    const e = toRemoteError({ message: 'new row violates row-level security policy', code: '42501' }, 403)
    expect(e).toMatchObject({ kind: 'rejected', message: 'new row violates row-level security policy' })
  })
})
