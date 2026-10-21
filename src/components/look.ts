/**
 * Visual language: each category gets an icon and a soft colour, people get
 * a coloured initial, trips get a calm gradient. Colour is never the only
 * cue (names and labels are always shown too).
 */
import type { ComponentType, SVGProps } from 'react'
import {
  IconBag,
  IconBed,
  IconBus,
  IconDots,
  IconHeart,
  IconShield,
  IconTag,
  IconTicket,
  IconUtensils,
  IconWifi,
} from './Icons'

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { title?: string }>

export interface CategoryLook {
  Icon: IconComponent
  /** Background + icon colour for the round tile. */
  tint: string
  /** Solid colour for chart segments. */
  bar: string
}

const BUILT_IN: Record<string, CategoryLook> = {
  'cat-transport': { Icon: IconBus, tint: 'bg-sky-100 text-sky-700', bar: 'bg-sky-400' },
  'cat-accommodation': { Icon: IconBed, tint: 'bg-violet-100 text-violet-700', bar: 'bg-violet-400' },
  'cat-food': { Icon: IconUtensils, tint: 'bg-orange-100 text-orange-700', bar: 'bg-orange-400' },
  'cat-shopping': { Icon: IconBag, tint: 'bg-pink-100 text-pink-700', bar: 'bg-pink-400' },
  'cat-activities': { Icon: IconTicket, tint: 'bg-amber-100 text-amber-800', bar: 'bg-amber-400' },
  'cat-insurance': { Icon: IconShield, tint: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-400' },
  'cat-sim': { Icon: IconWifi, tint: 'bg-cyan-100 text-cyan-700', bar: 'bg-cyan-400' },
  'cat-health': { Icon: IconHeart, tint: 'bg-rose-100 text-rose-700', bar: 'bg-rose-400' },
  'cat-misc': { Icon: IconDots, tint: 'bg-stone-200 text-stone-700', bar: 'bg-stone-400' },
}

const CUSTOM: Omit<CategoryLook, 'Icon'>[] = [
  { tint: 'bg-indigo-100 text-indigo-700', bar: 'bg-indigo-500' },
  { tint: 'bg-lime-100 text-lime-800', bar: 'bg-lime-600' },
  { tint: 'bg-fuchsia-100 text-fuchsia-700', bar: 'bg-fuchsia-500' },
  { tint: 'bg-teal-100 text-teal-800', bar: 'bg-teal-600' },
]

function hash(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0
  return h
}

/** Built-in categories have fixed looks; custom ones get a stable colour from their name. */
export function categoryLook(id: string, name: string): CategoryLook {
  const known = BUILT_IN[id]
  if (known) return known
  return { Icon: IconTag, ...CUSTOM[hash(name.toLowerCase()) % CUSTOM.length]! }
}

const AVATAR_TINTS = [
  'bg-sky-100 text-sky-800',
  'bg-violet-100 text-violet-800',
  'bg-orange-100 text-orange-800',
  'bg-pink-100 text-pink-800',
  'bg-emerald-100 text-emerald-800',
  'bg-amber-100 text-amber-900',
  'bg-cyan-100 text-cyan-800',
  'bg-rose-100 text-rose-800',
]

export const avatarTint = (name: string) => AVATAR_TINTS[hash(name.trim().toLowerCase()) % AVATAR_TINTS.length]!

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = [...words[0]!][0] ?? '?'
  const second = words.length > 1 ? ([...words[words.length - 1]!][0] ?? '') : ''
  return (first + second).toUpperCase()
}

const COVERS = [
  'from-accent-700 to-accent-900',
  'from-sky-700 to-sky-900',
  'from-indigo-600 to-indigo-900',
  'from-violet-700 to-violet-900',
  'from-emerald-700 to-emerald-900',
]

/** A calm gradient for a trip, stable for the same trip id. */
export const tripCover = (id: string) => COVERS[hash(id) % COVERS.length]!
