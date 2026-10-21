import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db/schema'
import type { ID, Traveller } from '../../types/domain'

/** Turns a user id (who added a record on a shared trip) into a name, or null when unknown. */
export function useWhoIs(tripId: ID, travellers: Traveller[]): (userId: string | undefined) => string | null {
  const members = useLiveQuery(() => db.members.where('tripId').equals(tripId).toArray(), [tripId])
  return (userId) => {
    if (!userId) return null
    const person = travellers.find((t) => t.userId === userId)
    if (person) return person.displayName
    const email = members?.find((m) => m.userId === userId)?.email
    return email ?? null
  }
}
