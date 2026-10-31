import { Button } from './ui'
import type { useRateLookup } from './useRateLookup'

export function RateLookupButton({ lookup, onClick }: { lookup: ReturnType<typeof useRateLookup>; onClick: () => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <Button className="min-h-9 px-3" disabled={lookup.busy} onClick={onClick}>
        {lookup.busy ? 'Looking up…' : "Use today's rate"}
      </Button>
      {lookup.note ? (
        <span role="status" className={`text-xs ${lookup.note.ok ? 'text-slate-600' : 'text-amber-800'}`}>
          {lookup.note.text}
        </span>
      ) : null}
    </div>
  )
}
