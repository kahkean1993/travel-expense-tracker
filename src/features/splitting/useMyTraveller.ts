import type { Traveller } from '../../types/domain'
import { useAuth } from '../../sync/cloud'

/** The traveller linked to the signed-in person, on shared trips. */
export function useMyTravellerId(travellers: Traveller[]): string | undefined {
  const auth = useAuth()
  if (auth.status !== 'signedIn') return undefined
  return travellers.find((t) => t.userId === auth.userId)?.id
}
