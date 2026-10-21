/**
 * Minimal hash router. Hash URLs (#/trips/…) work on GitHub Pages without
 * server-side rewrites and keep data out of query strings.
 */
import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'trips' }
  | { name: 'tripNew' }
  | { name: 'tripEdit'; tripId: string }
  | { name: 'dashboard'; tripId: string }
  | { name: 'expenses'; tripId: string }
  | { name: 'expenseNew'; tripId: string; duplicateOf?: string }
  | { name: 'expenseView'; tripId: string; expenseId: string }
  | { name: 'expenseEdit'; tripId: string; expenseId: string }
  | { name: 'travellers'; tripId: string }
  | { name: 'report'; tripId: string }
  | { name: 'settings' }
  | { name: 'join'; token: string }
  | { name: 'notFound' }

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '') || '/'
  const [pathname = '/', query = ''] = path.split('?')
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const params = new URLSearchParams(query)
  const [a, b, c, d, e] = parts
  if (parts.length === 0) return { name: 'trips' }
  if (a === 'settings' && parts.length === 1) return { name: 'settings' }
  if (a === 'join' && b && parts.length === 2) return { name: 'join', token: b }
  if (a !== 'trips') return { name: 'notFound' }
  if (b === 'new' && parts.length === 2) return { name: 'tripNew' }
  if (!b) return { name: 'trips' }
  if (parts.length === 2) return { name: 'dashboard', tripId: b }
  if (c === 'edit' && parts.length === 3) return { name: 'tripEdit', tripId: b }
  if (c === 'travellers' && parts.length === 3) return { name: 'travellers', tripId: b }
  if (c === 'report' && parts.length === 3) return { name: 'report', tripId: b }
  if (c === 'expenses') {
    if (parts.length === 3) return { name: 'expenses', tripId: b }
    if (d === 'new' && parts.length === 4) {
      const dup = params.get('duplicate')
      return dup ? { name: 'expenseNew', tripId: b, duplicateOf: dup } : { name: 'expenseNew', tripId: b }
    }
    if (d && parts.length === 4) return { name: 'expenseView', tripId: b, expenseId: d }
    if (d && e === 'edit' && parts.length === 5) return { name: 'expenseEdit', tripId: b, expenseId: d }
  }
  return { name: 'notFound' }
}

export const paths = {
  trips: () => '/',
  tripNew: () => '/trips/new',
  tripEdit: (id: string) => `/trips/${id}/edit`,
  dashboard: (id: string) => `/trips/${id}`,
  expenses: (id: string) => `/trips/${id}/expenses`,
  expenseNew: (id: string) => `/trips/${id}/expenses/new`,
  expenseDuplicate: (id: string, expenseId: string) => `/trips/${id}/expenses/new?duplicate=${expenseId}`,
  expenseView: (id: string, expenseId: string) => `/trips/${id}/expenses/${expenseId}`,
  expenseEdit: (id: string, expenseId: string) => `/trips/${id}/expenses/${expenseId}/edit`,
  travellers: (id: string) => `/trips/${id}/travellers`,
  report: (id: string) => `/trips/${id}/report`,
  settings: () => '/settings',
  join: (token: string) => `/join/${token}`,
}

export const href = (path: string) => `#${path}`

/** Changes whenever the visible screen changes, so screens can animate in. */
export function routeKey(route: Route): string {
  const parts: string[] = [route.name]
  if ('tripId' in route) parts.push(route.tripId)
  if ('expenseId' in route) parts.push(route.expenseId)
  if ('duplicateOf' in route && route.duplicateOf) parts.push(route.duplicateOf)
  if ('token' in route) parts.push(route.token)
  return parts.join(':')
}

export function navigate(path: string, options: { replace?: boolean } = {}) {
  if (options.replace) {
    history.replaceState(null, '', href(path))
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  } else {
    window.location.hash = path
  }
}

function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash)
}

export function useRoute(): Route {
  return parseRoute(useHash())
}
