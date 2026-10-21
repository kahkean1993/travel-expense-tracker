import { useEffect, type ComponentType } from 'react'
import { href, paths, useRoute, type Route } from './router'
import { useLiveQuery } from 'dexie-react-hooks'
import { tripsRepo } from '../db/repositories'
import { IconChart, IconList, IconPlus, IconReport, IconSettings, IconSuitcase, IconUsers } from '../components/Icons'
import { OnlineIndicator, SaveErrorBanner, SaveIndicator, UpdateBanner } from '../components/StatusIndicators'
import { BackupReminder } from '../features/settings/BackupReminder'
import { TripsPage } from '../features/trips/TripsPage'
import { TripFormPage } from '../features/trips/TripFormPage'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { ExpensesPage } from '../features/expenses/ExpensesPage'
import { ExpenseFormPage } from '../features/expenses/ExpenseFormPage'
import { ExpenseDetailPage } from '../features/expenses/ExpenseDetailPage'
import { TravellersPage } from '../features/splitting/TravellersPage'
import { ReportPage } from '../features/reports/ReportPage'
import { SettingsPage } from '../features/settings/SettingsPage'
import { EmptyState, LinkButton } from '../components/ui'

const LAST_TRIP_KEY = 'tet:lastTripId'

function readLastTrip(): string | null {
  try {
    return localStorage.getItem(LAST_TRIP_KEY)
  } catch {
    return null
  }
}

function routeTripId(route: Route): string | null {
  return 'tripId' in route ? route.tripId : null
}

type NavKey = 'trips' | 'dashboard' | 'expenses' | 'travellers' | 'report' | 'settings'

function activeNav(route: Route): NavKey | null {
  switch (route.name) {
    case 'trips':
    case 'tripNew':
    case 'tripEdit':
      return 'trips'
    case 'dashboard':
      return 'dashboard'
    case 'expenses':
    case 'expenseNew':
    case 'expenseView':
    case 'expenseEdit':
      return 'expenses'
    case 'travellers':
      return 'travellers'
    case 'report':
      return 'report'
    case 'settings':
      return 'settings'
    default:
      return null
  }
}

interface NavItem {
  key: NavKey
  label: string
  to: string
  Icon: ComponentType<{ width?: number; height?: number }>
}

export function App() {
  const route = useRoute()
  const currentTripId = routeTripId(route)
  const lastTripId = currentTripId ?? readLastTrip()

  useEffect(() => {
    if (!currentTripId) return
    try {
      localStorage.setItem(LAST_TRIP_KEY, currentTripId)
    } catch {
      // Storage unavailable (private mode): navigation memory is optional.
    }
  }, [currentTripId])

  // Only offer trip tabs when the remembered trip still exists.
  const contextTrip = useLiveQuery(
    async () => (currentTripId ?? lastTripId ? ((await tripsRepo.get((currentTripId ?? lastTripId)!)) ?? null) : null),
    [currentTripId, lastTripId],
  )
  const tripId = contextTrip?.id ?? null

  const nav: NavItem[] = [{ key: 'trips', label: 'Trips', to: paths.trips(), Icon: IconSuitcase }]
  if (tripId) {
    nav.push(
      { key: 'dashboard', label: 'Dashboard', to: paths.dashboard(tripId), Icon: IconChart },
      { key: 'expenses', label: 'Expenses', to: paths.expenses(tripId), Icon: IconList },
      { key: 'travellers', label: 'Split', to: paths.travellers(tripId), Icon: IconUsers },
      { key: 'report', label: 'Report', to: paths.report(tripId), Icon: IconReport },
    )
  }
  nav.push({ key: 'settings', label: 'Backup', to: paths.settings(), Icon: IconSettings })
  const active = activeNav(route)

  const showFab =
    currentTripId !== null &&
    contextTrip?.id === currentTripId &&
    (route.name === 'dashboard' || route.name === 'expenses' || route.name === 'travellers' || route.name === 'expenseView')

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="no-print sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <a href={href(paths.trips())} className="flex items-center gap-2 px-5 py-5 font-semibold text-slate-900">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-700 text-white">
            <IconSuitcase width={18} height={18} />
          </span>
          Trip Expenses
        </a>
        {contextTrip ? (
          <p className="truncate px-5 pb-2 text-xs font-medium uppercase tracking-wide text-slate-500" title={contextTrip.name}>
            {contextTrip.name}
          </p>
        ) : null}
        <nav aria-label="Main" className="flex flex-col gap-0.5 px-3">
          {nav.map((item) => (
            <a
              key={item.key}
              href={href(item.to)}
              aria-current={active === item.key ? 'page' : undefined}
              className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm ${
                active === item.key ? 'bg-accent-50 font-medium text-accent-800' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <item.Icon width={18} height={18} />
              {item.key === 'settings' ? 'Settings & Backup' : item.key === 'travellers' ? 'Travellers & Split' : item.label}
            </a>
          ))}
        </nav>
        <p className="mt-auto px-5 py-4 text-xs text-slate-500">Data is stored only in this browser on this device.</p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="mx-auto flex h-12 max-w-5xl items-center justify-between gap-2 px-4">
            <a href={href(paths.trips())} className="flex min-w-0 items-center gap-2 font-semibold text-slate-900 md:hidden">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-700 text-white">
                <IconSuitcase width={16} height={16} />
              </span>
              <span className="truncate">{contextTrip && currentTripId ? contextTrip.name : 'Trip Expenses'}</span>
            </a>
            <span className="hidden md:block" />
            <div className="flex items-center gap-2">
              <OnlineIndicator />
              <SaveIndicator />
            </div>
          </div>
        </div>
        <SaveErrorBanner />
        <UpdateBanner />

        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 pb-36 md:pb-12 print:p-0">
          <BackupReminder />
          <Screen route={route} />
        </main>
      </div>

      {showFab ? (
        <a
          href={href(paths.expenseNew(currentTripId))}
          className="no-print fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 inline-flex min-h-14 items-center gap-2 rounded-full bg-accent-700 px-5 font-semibold text-white shadow-lg shadow-slate-900/20 hover:bg-accent-800 md:right-8 md:bottom-8"
        >
          <IconPlus /> Add Expense
        </a>
      ) : null}

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Main"
        className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="mx-auto flex max-w-lg">
          {nav.map((item) => (
            <li key={item.key} className="flex-1">
              <a
                href={href(item.to)}
                aria-current={active === item.key ? 'page' : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${
                  active === item.key ? 'font-semibold text-accent-700' : 'text-slate-600'
                }`}
              >
                <item.Icon width={20} height={20} />
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

function Screen({ route }: { route: Route }) {
  const scrollKey = `${route.name}:${routeTripId(route) ?? ''}`
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [scrollKey])

  switch (route.name) {
    case 'trips':
      return <TripsPage />
    case 'tripNew':
      return <TripFormPage />
    case 'tripEdit':
      return <TripFormPage tripId={route.tripId} />
    case 'dashboard':
      return <DashboardPage tripId={route.tripId} />
    case 'expenses':
      return <ExpensesPage tripId={route.tripId} />
    case 'expenseNew':
      return <ExpenseFormPage key={`new-${route.duplicateOf ?? ''}`} tripId={route.tripId} duplicateOf={route.duplicateOf} />
    case 'expenseEdit':
      return <ExpenseFormPage key={`edit-${route.expenseId}`} tripId={route.tripId} expenseId={route.expenseId} />
    case 'expenseView':
      return <ExpenseDetailPage tripId={route.tripId} expenseId={route.expenseId} />
    case 'travellers':
      return <TravellersPage tripId={route.tripId} />
    case 'report':
      return <ReportPage tripId={route.tripId} />
    case 'settings':
      return <SettingsPage />
    case 'notFound':
      return (
        <EmptyState title="Page not found" action={<LinkButton to={paths.trips()} variant="primary">Go to trips</LinkButton>}>
          This link doesn't match any screen in the app.
        </EmptyState>
      )
  }
}
