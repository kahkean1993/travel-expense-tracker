import { useEffect } from 'react'
import { JoinPage } from '../features/sharing/JoinPage'
import { SyncIndicator } from '../components/SyncIndicator'
import { pendingInvite, pendingShare, rememberPendingShare, useAuth } from '../sync/cloud'
import { href, navigate, paths, routeKey, useRoute, type Route } from './router'
import { BottomBar, Sidebar } from './Navigation'
import { hidesTabBar, sectionOf } from './sections'
import { useLiveQuery } from 'dexie-react-hooks'
import { tripsRepo } from '../db/repositories'
import { IconSuitcase } from '../components/Icons'
import { OnlineIndicator, SaveErrorBanner, SaveIndicator, UpdateBanner } from '../components/StatusIndicators'
import { BackupReminder } from '../features/settings/BackupReminder'
import { TripsPage } from '../features/trips/TripsPage'
import { TripFormPage } from '../features/trips/TripFormPage'
import { DashboardPage } from '../features/dashboard/DashboardPage'
import { ExpensesPage } from '../features/expenses/ExpensesPage'
import { ExpenseFormPage } from '../features/expenses/ExpenseFormPage'
import { ExpenseDetailPage } from '../features/expenses/ExpenseDetailPage'
import { TravellersPage } from '../features/splitting/TravellersPage'
import { PersonStatementPage } from '../features/splitting/PersonStatementPage'
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

export function App() {
  const route = useRoute()
  const currentTripId = routeTripId(route)
  const lastTripId = currentTripId ?? readLastTrip()
  const auth = useAuth()

  // The sign-in email opens the home page. Continue what the person was doing:
  // joining a trip from an invite link, or sharing one of their trips.
  useEffect(() => {
    if (auth.status !== 'signedIn') return
    const token = pendingInvite()
    if (token && route.name !== 'join') return navigate(paths.join(token))
    const tripId = pendingShare()
    if (tripId) {
      rememberPendingShare(null)
      navigate(paths.travellers(tripId))
    }
  }, [auth.status, route.name])

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
  const section = sectionOf(route, tripId !== null)
  const hideTabs = hidesTabBar(route)

  return (
    <div className="min-h-dvh md:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>

      <Sidebar
        tripId={tripId}
        tripName={contextTrip?.name}
        section={section}
        footer={auth.status === 'disabled' ? 'Data is stored only in this browser on this device.' : 'Trips you don’t share stay on this device only.'}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 border-b border-slate-200/70 bg-white/90 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4">
            <a href={href(paths.trips())} className="flex min-w-0 items-center gap-2.5 font-semibold text-slate-900 md:invisible">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-700 text-white">
                <IconSuitcase width={17} height={17} />
              </span>
              <span className="truncate">Trip Expenses</span>
            </a>
            <div className="flex items-center gap-2">
              <OnlineIndicator />
              <SyncIndicator />
              <SaveIndicator />
            </div>
          </div>
        </header>
        <SaveErrorBanner />
        <UpdateBanner />

        <main id="main" className={`mx-auto w-full max-w-5xl flex-1 px-4 pt-5 md:pb-12 print:p-0 ${hideTabs ? 'pb-40' : 'pb-28'}`}>
          <BackupReminder />
          <div key={routeKey(route)} className="animate-enter">
            <Screen route={route} />
          </div>
        </main>
      </div>

      {hideTabs ? null : <BottomBar tripId={tripId} section={section} />}
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
    case 'person':
      return <PersonStatementPage tripId={route.tripId} travellerId={route.travellerId} />
    case 'report':
      return <ReportPage tripId={route.tripId} />
    case 'settings':
      return <SettingsPage />
    case 'join':
      return <JoinPage token={route.token} />
    case 'notFound':
      return (
        <EmptyState title="Page not found" action={<LinkButton to={paths.trips()} variant="primary">Go to trips</LinkButton>}>
          This link doesn't match any screen in the app.
        </EmptyState>
      )
  }
}
