import { useEffect, useState } from 'react'
import { formatMoney } from '../lib/money/money'
import { avatarTint, categoryLook, initialsOf } from './look'
import { useCountUp } from './useCountUp'
import { IconReceipt, IconSearch, IconSuitcase, IconUsers } from './Icons'

// ---------- People and categories ----------

const AVATAR_SIZES = { sm: 'size-7 text-[11px]', md: 'size-9 text-sm', lg: 'size-12 text-base' }

/** Round coloured initial. Decorative: the person's name is always shown next to it. */
export function Avatar({ name, size = 'md', className = '' }: { name: string; size?: keyof typeof AVATAR_SIZES; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none ${avatarTint(name)} ${AVATAR_SIZES[size]} ${className}`}
    >
      {initialsOf(name)}
    </span>
  )
}

export function AvatarStack({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max)
  const extra = names.length - shown.length
  return (
    <span className="inline-flex items-center" aria-hidden="true">
      {shown.map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} size="sm" className="-ml-2 ring-2 ring-white first:ml-0" />
      ))}
      {extra > 0 ? (
        <span className="-ml-2 inline-flex size-7 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600 ring-2 ring-white">
          +{extra}
        </span>
      ) : null}
    </span>
  )
}

const TILE_SIZES = { sm: 'size-8 rounded-lg', md: 'size-10 rounded-xl', lg: 'size-12 rounded-2xl' }
const TILE_ICONS = { sm: 16, md: 20, lg: 24 }

export function CategoryIcon({ id, name, size = 'md', className = '' }: { id: string; name: string; size?: keyof typeof TILE_SIZES; className?: string }) {
  const { Icon, tint } = categoryLook(id, name)
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center ${tint} ${TILE_SIZES[size]} ${className}`}>
      <Icon width={TILE_ICONS[size]} height={TILE_ICONS[size]} />
    </span>
  )
}

// ---------- Motion ----------

/** Money that counts up. Screen readers get the final amount straight away. */
export function CountUpMoney({ minor, currency, className = '' }: { minor: number; currency: string; className?: string }) {
  const value = useCountUp(minor)
  return (
    <span className={className}>
      <span aria-hidden="true" className="tabular whitespace-nowrap">
        <MoneyParts minor={Math.round(value)} currency={currency} />
      </span>
      <span className="sr-only">{formatMoney(minor, currency)}</span>
    </span>
  )
}

/** Amount with a smaller currency symbol, so the digits stand out. */
export function MoneyParts({ minor, currency, hideSymbol = false }: { minor: number; currency: string; hideSymbol?: boolean }) {
  const text = formatMoney(minor, currency)
  // "MYR 1,234.50" / "RM 1,234.50" / "¥1,500": split the leading symbol from the number.
  const match = /^(-?)([^\d-]*?)(\s?)(\d.*)$/.exec(text)
  if (!match) return <>{text}</>
  const [, sign, symbol, gap, digits] = match
  if (hideSymbol) return <>{sign}{digits}</>
  return (
    <>
      {sign}
      {symbol ? <span className="mr-[0.15em] text-[0.62em] font-semibold tracking-wide align-[0.12em]">{symbol}{gap ? ' ' : ''}</span> : null}
      {digits}
    </>
  )
}

// ---------- Progress ring ----------

export type RingTone = 'ok' | 'warning' | 'over'
const RING_COLOURS: Record<RingTone, string> = { ok: 'stroke-white', warning: 'stroke-amber-300', over: 'stroke-rose-300' }

/** Circular progress that fills in on first show. Drawn for use on the dark budget card. */
export function Ring({ percent, tone, size = 92, stroke = 9, label }: { percent: number; tone: RingTone; size?: number; stroke?: number; label: string }) {
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const shown = Math.min(100, Math.max(0, percent))
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-white/20" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - (ready ? shown / 100 : 0))}
          className={RING_COLOURS[tone]}
          style={{ transition: 'stroke-dashoffset 1000ms var(--ease-out-expo)' }}
        />
      </svg>
      <span className="tabular absolute inset-0 flex items-center justify-center text-lg font-semibold text-white" aria-hidden="true">
        {Math.round(percent)}%
      </span>
    </div>
  )
}

// ---------- Loading and empty states ----------

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton rounded-xl ${className}`} />
}

export function PageSkeleton({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="space-y-4" aria-busy="true">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-44 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-24 w-full rounded-2xl" />
    </div>
  )
}

const ART = { trips: IconSuitcase, expenses: IconReceipt, people: IconUsers, search: IconSearch }

/** A soft round badge with a big icon, for empty states. */
export function EmptyArt({ kind }: { kind: keyof typeof ART }) {
  const Icon = ART[kind]
  return (
    <div className="relative mx-auto mb-4 flex size-24 items-center justify-center" aria-hidden="true">
      <span className="absolute inset-0 rounded-full bg-accent-50" />
      <span className="absolute -top-1 right-2 size-3 rounded-full bg-amber-200" />
      <span className="absolute bottom-1 left-0 size-2.5 rounded-full bg-sky-200" />
      <span className="absolute right-0 bottom-3 size-2 rounded-full bg-rose-200" />
      <Icon width={40} height={40} className="relative text-accent-700" />
    </div>
  )
}
