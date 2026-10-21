import { tripsRepo } from '../../db/repositories'
import { Button, EmptyState, LinkButton } from '../../components/ui'
import { useBusy } from '../../components/useBusy'

/** Shown instead of an expense form while the trip is completed. */
export function TripLockedNotice({ tripId, back }: { tripId: string; back: string }) {
  const [busy, run] = useBusy()
  return (
    <EmptyState
      title="This trip is completed"
      action={
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void run(() => tripsRepo.setStatus(tripId, 'active'))}>
            Reopen trip
          </Button>
          <LinkButton to={back}>Back</LinkButton>
        </div>
      }
    >
      Expenses are locked so the final split can't change by accident. Reopen the trip to add or change expenses. Payments can still be recorded.
    </EmptyState>
  )
}
