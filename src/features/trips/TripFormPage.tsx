import { useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { navigate, paths } from '../../app/router'
import { settingsRepo, tripsRepo, type TripInput } from '../../db/repositories'
import { useTripData } from '../../db/hooks'
import { Button, Card, ConfirmDialog, EmptyState, Field, FieldError, LinkButton, Loading, Notice, PageHeader, TextInput } from '../../components/ui'
import { inputClass } from '../../components/styles'
import { CurrencySelect } from '../../components/CurrencySelect'
import { IconPlus, IconX } from '../../components/Icons'
import { useBusy } from '../../components/useBusy'
import { useAuth } from '../../sync/cloud'
import { useCategories } from '../../db/hooks'
import { Disclosure } from '../../components/ui'
import { isValidCurrencyCode, minorToInputString, parseAmountToMinor } from '../../lib/money/money'
import { localDateString } from '../../lib/export/csv'
import type { Trip } from '../../types/domain'

export function TripFormPage({ tripId }: { tripId?: string }) {
  const data = useTripData(tripId ?? '')
  const settings = useLiveQuery(() => settingsRepo.get())
  if (tripId) {
    if (data === undefined) return <Loading />
    if (data === null)
      return (
        <EmptyState title="Trip not found" action={<LinkButton to={paths.trips()}>Back to trips</LinkButton>}>
          It may have been deleted.
        </EmptyState>
      )
    return <TripForm trip={data.trip} hasExpenses={data.expenses.length > 0} expenseCount={data.expenses.length} />
  }
  if (!settings) return <Loading />
  return <TripForm defaultCurrency={settings.defaultBaseCurrency} />
}

interface Errors {
  name?: string
  startDate?: string
  endDate?: string
  baseCurrency?: string
  budget?: string
  categoryBudgets?: string
  travellers?: string
  form?: string
}

function TripForm({
  trip,
  hasExpenses = false,
  expenseCount = 0,
  defaultCurrency = 'MYR',
}: {
  trip?: Trip
  hasExpenses?: boolean
  expenseCount?: number
  defaultCurrency?: string
}) {
  const today = localDateString()
  const [name, setName] = useState(trip?.name ?? '')
  const [destination, setDestination] = useState(trip?.destination ?? '')
  const [startDate, setStartDate] = useState(trip?.startDate ?? today)
  const [endDate, setEndDate] = useState(trip?.endDate ?? today)
  const [baseCurrency, setBaseCurrency] = useState(trip?.baseCurrency ?? defaultCurrency)
  const [budget, setBudget] = useState(trip ? minorToInputString(trip.budgetMinorUnits, trip.baseCurrency) : '')
  const allCategories = useCategories()
  const budgetCategories = (allCategories ?? []).filter((c) => c.tripId === null || c.tripId === trip?.id)
  const [catBudgets, setCatBudgets] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(trip?.categoryBudgets ?? {}).map(([id, v]) => [id, minorToInputString(v, trip!.baseCurrency)])),
  )
  const [travellers, setTravellers] = useState<string[]>(['Me'])
  const [newTraveller, setNewTraveller] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [busy, run] = useBusy()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const auth = useAuth()
  const isShared = trip?.syncMode === 'cloud'
  // Shared trips can only be deleted by their owner (the server enforces this too).
  const canDelete = !isShared || (auth.status === 'signedIn' && trip?.ownerId === auth.userId)

  function validate(): { input: TripInput } | { errors: Errors } {
    const e: Errors = {}
    if (!name.trim()) e.name = 'Give the trip a name.'
    else if (name.trim().length > 100) e.name = 'Keep the name under 100 characters.'
    if (!startDate) e.startDate = 'Choose a start date.'
    if (!endDate) e.endDate = 'Choose an end date.'
    else if (startDate && endDate < startDate) e.endDate = 'End date must be on or after the start date.'
    if (!isValidCurrencyCode(baseCurrency)) e.baseCurrency = 'Choose a valid currency code.'
    let budgetMinor = 0
    if (!e.baseCurrency && budget.trim() !== '') {
      const parsed = parseAmountToMinor(budget, baseCurrency, { allowZero: true })
      if (parsed.ok) budgetMinor = parsed.value
      else e.budget = parsed.error
    }
    const categoryBudgets: Record<string, number> = {}
    if (!e.baseCurrency) {
      for (const [id, text] of Object.entries(catBudgets)) {
        if (text.trim() === '') continue
        const parsed = parseAmountToMinor(text, baseCurrency, { allowZero: true })
        if (!parsed.ok) {
          const label = budgetCategories.find((c) => c.id === id)?.name ?? 'A category'
          e.categoryBudgets = `${label}: ${parsed.error}`
          break
        }
        if (parsed.value > 0) categoryBudgets[id] = parsed.value
      }
    }
    if (!trip && travellers.length === 0) e.travellers = 'Add at least one traveller.'
    if (Object.keys(e).length) return { errors: e }
    return {
      input: {
        name: name.trim(),
        destination: destination.trim(),
        startDate,
        endDate,
        baseCurrency,
        budgetMinorUnits: budgetMinor,
        categoryBudgets,
      },
    }
  }

  function addTraveller() {
    const n = newTraveller.trim()
    if (!n) return
    if (travellers.some((t) => t.toLowerCase() === n.toLowerCase())) {
      setErrors((e) => ({ ...e, travellers: `"${n}" is already in the list.` }))
      return
    }
    setTravellers([...travellers, n])
    setNewTraveller('')
    setErrors((e) => ({ ...e, travellers: undefined }))
  }

  function submit(ev: FormEvent) {
    ev.preventDefault()
    const result = validate()
    if ('errors' in result) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    void run(async () => {
      try {
        if (trip) {
          await tripsRepo.update(trip.id, result.input)
          navigate(paths.dashboard(trip.id))
        } else {
          const created = await tripsRepo.create(result.input, travellers)
          navigate(paths.dashboard(created.id), { replace: true })
        }
      } catch (err) {
        setErrors({ form: err instanceof Error ? err.message : 'Could not save the trip.' })
      }
    })
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader
        title={trip ? 'Edit trip' : 'New trip'}
        back={trip ? paths.dashboard(trip.id) : paths.trips()}
      />
      <form onSubmit={submit} noValidate className="space-y-4">
        <Card className="space-y-4">
          <Field label="Trip name" htmlFor="trip-name" error={errors.name}>
            <TextInput
              id="trip-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Japan spring break"
              aria-invalid={!!errors.name}
              autoFocus={!trip}
            />
          </Field>
          <Field label="Destination (optional)" htmlFor="trip-dest">
            <TextInput id="trip-dest" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="e.g. Tokyo & Kyoto" />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Start date" htmlFor="trip-start" error={errors.startDate}>
              <input
                id="trip-start"
                type="date"
                className={inputClass}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value)
                  if (endDate < e.target.value) setEndDate(e.target.value)
                }}
                aria-invalid={!!errors.startDate}
              />
            </Field>
            <Field label="End date" htmlFor="trip-end" error={errors.endDate}>
              <input
                id="trip-end"
                type="date"
                className={inputClass}
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-invalid={!!errors.endDate}
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Base currency"
              htmlFor="trip-currency"
              error={errors.baseCurrency}
              hint={hasExpenses ? 'Locked because this trip has expenses.' : 'Totals, budget and splits use this currency.'}
            >
              <CurrencySelect
                id="trip-currency"
                value={baseCurrency}
                onChange={setBaseCurrency}
                disabled={hasExpenses}
                invalid={!!errors.baseCurrency}
              />
            </Field>
            <Field label={`Budget (${baseCurrency || '—'})`} htmlFor="trip-budget" error={errors.budget} hint="Leave empty for no budget.">
              <TextInput
                id="trip-budget"
                inputMode="decimal"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="e.g. 5000"
                aria-invalid={!!errors.budget}
              />
            </Field>
          </div>
          <Disclosure
            title="Budget by category (optional)"
            hint={Object.values(catBudgets).some((v) => v.trim()) ? 'Some categories have a limit' : 'Set a limit for food, transport and so on'}
            defaultOpen={Object.keys(trip?.categoryBudgets ?? {}).length > 0}
          >
            <ul className="space-y-2">
              {budgetCategories.map((c) => (
                <li key={c.id} className="flex items-center gap-3">
                  <label htmlFor={`cb-${c.id}`} className="min-w-0 flex-1 truncate text-sm text-slate-700">{c.name}</label>
                  <input
                    id={`cb-${c.id}`}
                    className={`${inputClass} w-32 text-right tabular`}
                    inputMode="decimal"
                    placeholder="No limit"
                    value={catBudgets[c.id] ?? ''}
                    onChange={(ev) => setCatBudgets((b) => ({ ...b, [c.id]: ev.target.value }))}
                  />
                </li>
              ))}
            </ul>
            {errors.categoryBudgets ? <div className="mt-2"><FieldError>{errors.categoryBudgets}</FieldError></div> : null}
            <p className="mt-2 text-xs text-slate-500">Limits are in {baseCurrency}. The Home screen shows how much of each is used.</p>
          </Disclosure>
        </Card>

        {!trip ? (
          <Card className="space-y-3">
            <div>
              <h2 className="text-sm font-medium text-slate-700">Travellers</h2>
              <p className="text-xs text-slate-500">Who is sharing costs on this trip? You can change this later.</p>
            </div>
            <ul className="flex flex-wrap gap-2">
              {travellers.map((t, i) => (
                <li key={i === 0 ? "__first" : t} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pr-1 pl-3 text-sm">
                  {i === 0 ? (
                    <input
                      aria-label="Your name"
                      className="w-24 bg-transparent"
                      value={t}
                      onChange={(e) => setTravellers([e.target.value, ...travellers.slice(1)])}
                    />
                  ) : (
                    t
                  )}
                  {travellers.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setTravellers(travellers.filter((_, j) => j !== i))}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200"
                      aria-label={`Remove ${t}`}
                    >
                      <IconX width={14} height={14} />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <TextInput
                value={newTraveller}
                onChange={(e) => setNewTraveller(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTraveller()
                  }
                }}
                placeholder="Add a companion's name"
                aria-label="Companion name"
              />
              <Button onClick={addTraveller}>
                <IconPlus width={18} height={18} /> Add
              </Button>
            </div>
            {errors.travellers ? <FieldError>{errors.travellers}</FieldError> : null}
          </Card>
        ) : null}

        {errors.form ? <Notice tone="danger">{errors.form}</Notice> : null}

        <div className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/70 bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur md:static md:z-auto md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
          <div className="mx-auto flex max-w-xl gap-2">
            <LinkButton to={trip ? paths.dashboard(trip.id) : paths.trips()} className="min-h-12 flex-1">
              Cancel
            </LinkButton>
            <Button type="submit" variant="primary" disabled={busy} className="min-h-12 flex-[1.4]">
              {busy ? 'Saving…' : trip ? 'Save changes' : 'Create trip'}
            </Button>
          </div>
        </div>
      </form>

      {trip ? (
        <Card className="mt-8 space-y-3">
          <h2 className="text-base font-semibold">Trip status</h2>
          <p className="text-sm text-slate-600">
            {trip.status === 'active'
              ? 'Mark the trip as completed when you are back. It moves to the Completed list and can be reopened any time.'
              : 'This trip is completed. Reopen it to keep tracking expenses as an active trip.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() => void run(() => tripsRepo.setStatus(trip.id, trip.status === 'active' ? 'completed' : 'active'))}
            >
              {trip.status === 'active' ? 'Mark as completed' : 'Reopen trip'}
            </Button>
            {canDelete ? (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                {isShared ? 'Delete for everyone' : 'Delete trip'}
              </Button>
            ) : null}
          </div>
          {!canDelete ? (
            <p className="text-xs text-slate-500">
              Only the trip owner can delete a shared trip. To remove it from your devices, leave the trip on the Split page.
            </p>
          ) : null}
        </Card>
      ) : null}

      {trip ? (
        <ConfirmDialog
          open={confirmDelete}
          title={`Delete "${trip.name}"?`}
          confirmLabel="Delete trip and its records"
          busy={busy}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() =>
            void run(async () => {
              await tripsRepo.delete(trip.id)
              setConfirmDelete(false)
              navigate(paths.trips(), { replace: true })
            })
          }
        >
          <p>
            This permanently deletes the trip and all of its records, including{' '}
            <strong>
              {expenseCount} expense{expenseCount === 1 ? '' : 's'}
            </strong>{' '}
            and its traveller list. Other trips are not affected.
          </p>
          {isShared ? (
            <p className="mt-2">
              <strong>This is a shared trip:</strong> it will be deleted for every member, on all of their devices.
            </p>
          ) : null}
          <p className="mt-2">Consider downloading a backup from Settings first. This cannot be undone.</p>
        </ConfirmDialog>
      ) : null}
    </div>
  )
}
