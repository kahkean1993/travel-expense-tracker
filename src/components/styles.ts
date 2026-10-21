/** Shared Tailwind class strings. */

export type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const variantClass: Record<Variant, string> = {
  primary:
    'bg-accent-700 text-white shadow-sm hover:bg-accent-800 disabled:bg-slate-300 disabled:text-slate-600 disabled:shadow-none',
  secondary: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-500',
  ghost: 'text-accent-700 hover:bg-accent-50 disabled:text-slate-500',
  danger: 'bg-white text-red-700 border border-red-300 hover:bg-red-50 disabled:text-slate-500',
}

export function buttonClass(variant: Variant = 'secondary', extra = '') {
  return `press inline-flex items-center justify-center gap-2 rounded-xl px-4 min-h-11 text-sm font-semibold disabled:cursor-not-allowed ${variantClass[variant]} ${extra}`
}

export const inputClass =
  'w-full min-h-12 rounded-xl border border-slate-300 bg-white px-3.5 text-base text-slate-900 placeholder:text-slate-400 transition-shadow focus:border-accent-700 focus:outline-none focus:ring-4 focus:ring-accent-100 aria-[invalid=true]:border-red-500'

/** Round icon-only button (44px tap target). */
export const iconButtonClass =
  'press inline-flex size-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100'

export const cardClass = 'rounded-2xl border border-slate-200/70 bg-white p-4 shadow-card sm:p-5'
