import { useEffect, useId, useRef, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react'
import { formatMoney } from '../lib/money/money'
import { IconAlert, IconChevronLeft, IconInfo } from './Icons'
import { href } from '../app/router'
import { buttonClass, inputClass, type Variant } from './styles'

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
  return <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>{children}</section>
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-slate-900">{children}</h2>
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
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2">
        {back ? (
          <a
            href={href(back)}
            className="no-print -ml-2 mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
            aria-label="Back"
          >
            <IconChevronLeft />
          </a>
        ) : null}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight break-words text-slate-900">{title}</h1>
          {subtitle ? <div className="mt-0.5 text-sm text-slate-600">{subtitle}</div> : null}
        </div>
      </div>
      {actions ? <div className="no-print flex flex-wrap gap-2">{actions}</div> : null}
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
    <div className="flex flex-col gap-1">
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
    <p id={id} className="flex items-start gap-1 text-sm text-red-700" role="alert">
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
  options: { value: T; label: string }[]
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
              className={`min-h-10 rounded-full border px-3.5 text-sm transition-colors ${
                selected
                  ? 'border-accent-700 bg-accent-700 font-medium text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {error ? <FieldError id={`${id}-err`}>{error}</FieldError> : null}
    </fieldset>
  )
}

export function Money({ minor, currency, className = '' }: { minor: number; currency: string; className?: string }) {
  return <span className={`tabular whitespace-nowrap ${className}`}>{formatMoney(minor, currency)}</span>
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {children ? <div className="mx-auto mt-1 max-w-sm text-sm text-slate-600">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
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
    info: 'border-slate-200 bg-slate-50 text-slate-700',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
    danger: 'border-red-300 bg-red-50 text-red-900',
    success: 'border-accent-100 bg-accent-50 text-accent-800',
  }[tone]
  const Icon = tone === 'info' || tone === 'success' ? IconInfo : IconAlert
  return (
    <div className={`flex flex-wrap items-start gap-2 rounded-lg border px-3 py-2.5 text-sm ${styles}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon width={18} height={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="py-12 text-center text-sm text-slate-500" role="status">
      {label}
    </div>
  )
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
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl"
      aria-labelledby={titleId}
    >
      <div className="p-5">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-sm text-slate-700">{children}</div>
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
