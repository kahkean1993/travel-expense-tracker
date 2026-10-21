/** Shared Tailwind class strings. */

export type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const variantClass: Record<Variant, string> = {
  primary: 'bg-accent-700 text-white hover:bg-accent-800 disabled:bg-slate-300 disabled:text-slate-600',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  ghost: 'text-accent-700 hover:bg-accent-50 disabled:text-slate-400',
  danger: 'bg-white text-red-700 border border-red-300 hover:bg-red-50 disabled:text-slate-400',
}

export function buttonClass(variant: Variant = 'secondary', extra = '') {
  return `inline-flex items-center justify-center gap-2 rounded-lg px-4 min-h-11 text-sm font-medium transition-colors disabled:cursor-not-allowed ${variantClass[variant]} ${extra}`
}

export const inputClass =
  'w-full min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-accent-700 focus:outline-none focus:ring-2 focus:ring-accent-100 aria-[invalid=true]:border-red-500'

