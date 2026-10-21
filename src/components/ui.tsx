import { useEffect, useId, useRef, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react'
import { IconAlert, IconChevronDown, IconChevronLeft, IconInfo, IconX } from './Icons'
import { href } from '../app/router'
import { buttonClass, cardClass, iconButtonClass, inputClass, type Variant } from './styles'
import { EmptyArt, MoneyParts, PageSkeleton } from './visuals'

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button type="button" className={buttonClass(variant, className)} {...props} />
}

export function LinkButton({
  to,
  variant = 'secondary',
  className = '',
  children,
}: {
  to: string
  variant?: Variant
  className?: string
  children: ReactNode
}) {
  return (
    <a href={href(to)} className={buttonClass(variant, className)}>
      {children}
    </a>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`${cardClass} ${className}`}>{children}</section>
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex min-h-8 items-center justify-between gap-2">
      <h2 className="text-[15px] font-semibold text-slate-900">{children}</h2>
      {action}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
}: {
  title: string
  subtitle?: ReactNode
  back?: string
  actions?: ReactNode
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-1">
        {back ? (
          <a href={href(back)} className={`no-print -ml-2 ${iconButtonClass}`} aria-label="Back">
            <IconChevronLeft />
          </a>
        ) : null}
        <div className="min-w-0 pt-0.5">
          <h1 className="text-2xl font-semibold tracking-tight break-words text-slate-900">{title}</h1>
          {subtitle ? <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div> : null}
        </div>
      </div>
      {actions ? <div className="no-print flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: ReactNode
  error?: string | undefined
  hint?: ReactNode
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-slate-700">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {error ? <FieldError>{error}</FieldError> : null}
    </div>
  )
}

export function FieldError({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="flex items-start gap-1.5 text-sm text-red-700" role="alert">
      <IconAlert width={16} height={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClass} {...props} />
}

/** A row of toggle chips acting as a single-choice radio group. */
export function ChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  error,
}: {
  label: string
  options: { value: T; label: string; leading?: ReactNode }[]
  value: T | ''
  onChange: (v: T) => void
  error?: string | undefined
}) {
  const id = useId()
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium text-slate-700">{label}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-describedby={error ? `${id}-err` : undefined}>
        {options.map((o) => {
          const selected = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(o.value)}
              className={`press inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm ${
                selected
                  ? 'border-accent-700 bg-accent-700 font-semibold text-white shadow-sm'
                  : 'border-slate-300 bg-surface text-slate-700 hover:border-slate-400 hover:bg-slate-50'
              } ${o.leading ? 'pl-1.5' : ''}`}
            >
              {o.leading}
              {o.label}
            </button>
          )
        })}
      </div>
      {error ? <FieldError id={`${id}-err`}>{error}</FieldError> : null}
    </fieldset>
  )
}

/** An amount with a small currency symbol so the digits stand out. */
export function Money({ minor, currency, className = '', hideSymbol = false }: { minor: number; currency: string; className?: string; hideSymbol?: boolean }) {
  return (
    <span className={`tabular whitespace-nowrap ${className}`}>
      <MoneyParts minor={minor} currency={currency} hideSymbol={hideSymbol} />
    </span>
  )
}

export function EmptyState({
  title,
  children,
  action,
  art,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
  art?: 'trips' | 'expenses' | 'people' | 'search'
}) {
  return (
    <div className="animate-enter rounded-2xl border border-slate-200/70 bg-surface px-6 py-10 text-center shadow-card">
      {art ? <EmptyArt kind={art} /> : null}
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {children ? <div className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500">{children}</div> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function Notice({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success'
  children: ReactNode
  action?: ReactNode
}) {
  const styles = {
    info: 'border-slate-200 bg-slate-100 text-slate-700',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
    danger: 'border-red-300 bg-red-50 text-red-900',
    success: 'border-accent-100 bg-accent-50 text-accent-800',
  }[tone]
  const Icon = tone === 'info' || tone === 'success' ? IconInfo : IconAlert
  return (
    <div className={`flex flex-wrap items-start gap-2 rounded-xl border px-3.5 py-3 text-sm ${styles}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon width={18} height={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  )
}

/** A card whose body folds away. Keeps rarely used things out of the way. */
export function Disclosure({ title, hint, children, defaultOpen = false }: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen || undefined} className="group rounded-2xl border border-slate-200/70 bg-surface shadow-card">
      <summary className="press flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 marker:content-none sm:px-5">
        <span>
          <span className="block text-[15px] font-semibold text-slate-900">{title}</span>
          {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
        </span>
        <IconChevronDown className="shrink-0 text-slate-500 transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">{children}</div>
    </details>
  )
}

/** Placeholder shapes shown while data loads. */
export function Loading({ label }: { label?: string }) {
  return <PageSkeleton {...(label ? { label } : {})} />
}

/** Opens a <dialog> modally while `open` is true. */
function useModal(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return ref
}

/** Accessible modal confirmation built on <dialog>. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  tone?: 'danger' | 'primary'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useModal(open)
  const titleId = useId()
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-surface p-0 text-slate-900 shadow-xl"
      aria-labelledby={titleId}
    >
      <div className="p-5">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-sm text-slate-600">{children}</div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  )
}

/** A panel that slides up from the bottom on phones (and sits centred on larger screens). */
export function Sheet({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
}) {
  const ref = useModal(open)
  const titleId = useId()
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="sheet border border-slate-200 bg-surface p-0 text-slate-900 shadow-xl"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose() // tap on the dimmed area
      }}
    >
      <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-slate-200 md:hidden" aria-hidden="true" />
        <div className="mb-2 flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} className={iconButtonClass} aria-label="Close">
            <IconX />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  )
}
