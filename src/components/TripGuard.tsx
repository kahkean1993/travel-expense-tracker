import type { ReactNode } from 'react'
import { useTripData, type TripData } from '../db/hooks'
import { EmptyState, LinkButton, Loading } from './ui'
import { paths } from '../app/router'

/** Loads a trip's data and renders loading / not-found states. */
export function TripGuard({ tripId, children }: { tripId: string; children: (data: TripData) => ReactNode }) {
  const data = useTripData(tripId)
  if (data === undefined) return <Loading />
  if (data === null)
    return (
      <EmptyState title="Trip not found" action={<LinkButton to={paths.trips()} variant="primary">Back to trips</LinkButton>}>
        It may have been deleted, or it was saved in a different browser or device.
      </EmptyState>
    )
  return <>{children(data)}</>
}
