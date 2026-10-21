import { describe, expect, it } from 'vitest'
import { parseRoute, paths } from './router'

describe('parseRoute', () => {
  it('round-trips every path', () => {
    expect(parseRoute('#' + paths.trips())).toEqual({ name: 'trips' })
    expect(parseRoute('')).toEqual({ name: 'trips' })
    expect(parseRoute('#' + paths.tripNew())).toEqual({ name: 'tripNew' })
    expect(parseRoute('#' + paths.dashboard('t1'))).toEqual({ name: 'dashboard', tripId: 't1' })
    expect(parseRoute('#' + paths.expenseDuplicate('t1', 'e1'))).toEqual({ name: 'expenseNew', tripId: 't1', duplicateOf: 'e1' })
    expect(parseRoute('#' + paths.expenseEdit('t1', 'e1'))).toEqual({ name: 'expenseEdit', tripId: 't1', expenseId: 'e1' })
    expect(parseRoute('#' + paths.settings())).toEqual({ name: 'settings' })
    expect(parseRoute('#' + paths.join('abc123'))).toEqual({ name: 'join', token: 'abc123' })
    expect(parseRoute('#/nope')).toEqual({ name: 'notFound' })
  })
})
