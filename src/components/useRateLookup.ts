import { useState } from 'react'
import { fetchLiveRate, type LiveRate } from '../lib/rates'
import { useBusy } from './useBusy'

/** State for a "Use today's rate" button: looks the rate up and keeps the explanation to show next to it. */
export function useRateLookup() {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, run] = useBusy()
  /** Resolves to the rate, or null when it could not be found (the note then says why). */
  const lookUp = async (from: string, to: string): Promise<LiveRate | null> => {
    const found = await run(() => fetchLiveRate(from, to))
    if (!found) return null
    if (!found.ok) {
      setNote({ ok: false, text: found.error })
      return null
    }
    setNote({ ok: true, text: `Rate from ${found.value.date || 'today'} (market rate, your card may differ).` })
    return found.value
  }
  return { busy, note, lookUp, clearNote: () => setNote(null) }
}
