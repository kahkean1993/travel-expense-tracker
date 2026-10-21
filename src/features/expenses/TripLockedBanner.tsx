import { tripsRepo } from '../../db/repositories'
import { Button, Notice } from '../../components/ui'
import { useBusy } from '../../components/useBusy'

/** Explains why expenses can't be changed on a completed trip, with a way to reopen it. */
export function TripLockedBanner({ tripId }: { tripId: string }) {
  const [busy, run] = useBusy()
  return (
    <Notice
      action={
        <Button disabled={busy} onClick={() => void run(() => tripsRepo.setStatus(tripId, 'active'))}>
          Reopen trip
        </Button>
      }
    >
      This trip is completed, so its expenses are locked. Reopen it to make changes.
    </Notice>
  )
}
