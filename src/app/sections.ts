import type { Route } from './router'

export type Section = 'home' | 'expenses' | 'split' | 'more' | 'trips' | 'settings' | null

/** Which part of the app the current screen belongs to. */
export function sectionOf(route: Route, hasTrip: boolean): Section {
  switch (route.name) {
    case 'dashboard':
      return 'home'
    case 'expenses':
    case 'expenseNew':
    case 'expenseView':
    case 'expenseEdit':
      return 'expenses'
    case 'travellers':
      return 'split'
    case 'report':
    case 'tripEdit':
      return hasTrip ? 'more' : 'trips'
    case 'trips':
    case 'tripNew':
      return hasTrip ? 'more' : 'trips'
    case 'settings':
    case 'join':
      return hasTrip ? 'more' : 'settings'
    default:
      return null
  }
}

/** Screens with their own sticky Save bar hide the tab bar to give the form the full screen. */
export const hidesTabBar = (route: Route) =>
  route.name === 'expenseNew' || route.name === 'expenseEdit' || route.name === 'tripNew' || route.name === 'tripEdit'
