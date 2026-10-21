import { useMemo, useRef, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { navigate, paths } from '../../app/router'
import { TripGuard } from '../../components/TripGuard'
import type { TripData } from '../../db/hooks'
import { expensesRepo } from '../../db/repositories'
import { Button, Card, ChipGroup, EmptyState, Field, FieldError, LinkButton, Loading, Money, Notice, PageHeader, TextInput } from '../../components/ui'
import { inputClass } from '../../components/styles'
import { CurrencySelect } from '../../components/CurrencySelect'
import { useBusy } from '../../components/useBusy'
import { useAuth } from '../../sync/cloud'
import { currencySymbol, minorToInputString } from '../../lib/money/money'
import { localDateString } from '../../lib/export/csv'
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type Expense, type ExpenseShare, type PaymentMethod } from '../../types/domain'
import { emptyExpenseForm, evaluateExpenseForm, formFromExpense, type ExpenseFormValues } from './expenseDraft'

export function ExpenseFormPage({
  tripId,
  expenseId,
  duplicateOf,
}: {
  tripId: string
  expenseId?: string | undefined
  duplicateOf?: string | undefined
}) {
  const sourceId = expenseId ?? duplicateOf
  const source = useLiveQuery(async () => {
    if (!sourceId) return { expense: null, shares: [] as ExpenseShare[] }
    const expense = await expensesRepo.get(sourceId)
    return { expense: expense ?? null, shares: expense ? await expensesRepo.sharesByExpense(sourceId) : [] }
  }, [sourceId])

  return (
    <TripGuard tripId={tripId}>
      {(data) => {
        if (!source) return <Loading />
        if (sourceId && (!source.expense || source.expense.tripId !== tripId))
          return (
            <EmptyState title="Expense not found" action={<LinkButton to={paths.expenses(tripId)}>Back to expenses</LinkButton>}>
              It may have been deleted.
            </EmptyState>
          )
        return (
          <ExpenseForm
            data={data}
            mode={expenseId ? 'edit' : duplicateOf ? 'duplicate' : 'new'}
            source={source.expense}
            sourceShares={source.shares}
          />
        )
      }}
    </TripGuard>
  )
}

function lastRateFor(expenses: Expense[], currency: string): string | null {
  const match = expenses
    .filter((e) => e.originalCurrency === currency)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))[0]
  return match?.exchangeRate ?? null
}

function ExpenseForm({
  data,
  mode,
  source,
  sourceShares,
}: {
  data: TripData
  mode: 'new' | 'edit' | 'duplicate'
  source: Expense | null
  sourceShares: ExpenseShare[]
}) {
  const { trip, travellers, expenses, categories } = data
  const auth = useAuth()
  // On a shared trip, the signed-in person's own traveller is the default payer.
  const myTraveller = auth.status === 'signedIn' ? travellers.find((t) => t.userId === auth.userId) : undefined
  const today = localDateString()
  const [values, setValues] = useState<ExpenseFormValues>(() => {
    if (source) {
      const v = formFromExpense(source, sourceShares, minorToInputString)
      return mode === 'duplicate' ? { ...v, date: today } : v
    }
    const blank = emptyExpenseForm(trip, travellers, today)
    if (!myTraveller) return blank
    return {
      ...blank,
      payerId: myTraveller.id,
      participantIds: blank.splitMode === 'personal' ? [myTraveller.id] : blank.participantIds,
    }
  })
  const [submitted, setSubmitted] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [addedCount, setAddedCount] = useState(0)
  const [busy, run] = useBusy()
  const amountRef = useRef<HTMLInputElement>(null)

  const evaluation = useMemo(() => evaluateExpenseForm(values, trip, travellers), [values, trip, travellers])
  const errors = submitted ? evaluation.errors : {}
  const set = <K extends keyof ExpenseFormValues>(key: K, value: ExpenseFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }))

  const sameCurrency = values.currency === trip.baseCurrency
  const usedCurrencies = [...new Set([trip.baseCurrency, ...expenses.map((e) => e.originalCurrency)])]
  const lastRate = !sameCurrency ? lastRateFor(expenses, values.currency) : null
  const names = new Map(travellers.map((t) => [t.id, t.displayName]))
  const sym = currencySymbol(trip.baseCurrency)

  function changeCurrency(code: string) {
    setValues((v) => {
      if (code === trip.baseCurrency) return { ...v, currency: code, rate: '1' }
      const remembered = lastRateFor(expenses, code)
      const keepRate = v.currency !== trip.baseCurrency && v.currency === code
      return { ...v, currency: code, rate: keepRate ? v.rate : (remembered ?? '') }
    })
  }

  function changeSplitMode(next: 'personal' | 'equal' | 'custom') {
    setValues((v) => {
      if (next === 'personal') return { ...v, splitMode: 'personal', participantIds: [v.payerId] }
      const participants = v.splitMode === 'personal' ? travellers.map((t) => t.id) : v.participantIds
      if (next === 'equal') return { ...v, splitMode: 'equal', participantIds: participants }
      return {
        ...v,
        splitMode: v.splitMode === 'custom_weight' ? 'custom_weight' : 'custom_amount',
        participantIds: participants,
      }
    })
  }

  function toggleParticipant(id: string) {
    setValues((v) => {
      const has = v.participantIds.includes(id)
      const next = has ? v.participantIds.filter((p) => p !== id) : [...v.participantIds, id]
      // Keep traveller order stable so remainder distribution is predictable.
      return { ...v, participantIds: travellers.map((t) => t.id).filter((tid) => next.includes(tid)) }
    })
  }

  function save(addAnother: boolean) {
    setSubmitted(true)
    setSaveError(null)
    const result = evaluation.result
    if (!result) {
      // Move focus to the first invalid field.
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      return
    }
    void run(async () => {
      try {
        const saved = await expensesRepo.save(mode === 'edit' ? source!.id : undefined, result.record, result.shares)
        if (addAnother) {
          setValues((v) => ({ ...v, amount: '', description: '', notes: '', customAmounts: {} }))
          setSubmitted(false)
          setAddedCount((c) => c + 1)
          amountRef.current?.focus()
          window.scrollTo(0, 0)
        } else if (mode === 'edit') {
          navigate(paths.expenseView(trip.id, saved.id), { replace: true })
        } else {
          navigate(paths.expenses(trip.id), { replace: true })
        }
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Could not save this expense.')
      }
    })
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    save(false)
  }

  const splitChoice = values.splitMode === 'personal' ? 'personal' : values.splitMode === 'equal' ? 'equal' : 'custom'
  const title = mode === 'edit' ? 'Edit expense' : mode === 'duplicate' ? 'Duplicate expense' : 'Add expense'
  const cancelTo = mode === 'edit' && source ? paths.expenseView(trip.id, source.id) : paths.expenses(trip.id)

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={title} subtitle={trip.name} back={cancelTo} />
      {addedCount > 0 ? (
        <div className="mb-3">
          <Notice tone="success">
            {addedCount === 1 ? 'Expense saved.' : `${addedCount} expenses saved.`} Add the next one below.
          </Notice>
        </div>
      ) : null}
      {mode === 'duplicate' && addedCount === 0 ? (
        <div className="mb-3">
          <Notice>This is a copy with today's date. Check the details, then save it as a new expense.</Notice>
        </div>
      ) : null}

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Card className="space-y-4">
          {/* 1. Amount and currency first */}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="amount" className="text-sm font-medium text-slate-700">
                Amount
              </label>
              <input
                id="amount"
                ref={amountRef}
                className={`${inputClass} min-h-14 text-2xl font-semibold tabular`}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                autoFocus={mode === 'new'}
                value={values.amount}
                onChange={(e) => set('amount', e.target.value)}
                aria-invalid={!!errors.amount}
                aria-describedby={errors.amount ? 'amount-err' : undefined}
              />
            </div>
            <div className="flex w-32 flex-col gap-1 sm:w-40">
              <label htmlFor="currency" className="text-sm font-medium text-slate-700">
                Currency
              </label>
              <div className="[&_select]:min-h-14">
                <CurrencySelect
                  id="currency"
                  value={values.currency}
                  onChange={changeCurrency}
                  extra={usedCurrencies}
                  invalid={!!errors.currency}
                />
              </div>
            </div>
          </div>
          {errors.amount ? <FieldError id="amount-err">{errors.amount}</FieldError> : null}
          {errors.currency ? <FieldError>{errors.currency}</FieldError> : null}

          {/* Exchange rate only when needed */}
          {!sameCurrency && values.currency.length === 3 ? (
            <div className="rounded-lg bg-slate-50 p-3">
              <label htmlFor="rate" className="text-sm font-medium text-slate-700">
                Exchange rate
              </label>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <span className="shrink-0 text-slate-700 tabular">1 {values.currency} =</span>
                <span className="shrink-0 text-slate-700">{sym}</span>
                <input
                  id="rate"
                  className={`${inputClass} tabular`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="e.g. 0.0312"
                  value={values.rate}
                  onChange={(e) => set('rate', e.target.value)}
                  aria-invalid={!!errors.rate}
                />
              </div>
              {errors.rate ? (
                <div className="mt-1">
                  <FieldError>{errors.rate}</FieldError>
                </div>
              ) : (
                <p className="mt-1 text-xs text-slate-500">
                  How many {trip.baseCurrency} one {values.currency} is worth.
                  {lastRate && lastRate !== values.rate ? (
                    <>
                      {' '}
                      Last used on this trip:{' '}
                      <button type="button" className="font-medium text-accent-700 underline" onClick={() => set('rate', lastRate)}>
                        {lastRate}
                      </button>
                    </>
                  ) : null}
                </p>
              )}
            </div>
          ) : null}

          {evaluation.baseAmount !== null && !sameCurrency ? (
            <p className="text-sm text-slate-700">
              Converted total: <Money minor={evaluation.baseAmount} currency={trip.baseCurrency} className="font-semibold text-slate-900" />
            </p>
          ) : null}

          <Field label="Description" htmlFor="description" error={errors.description}>
            <TextInput
              id="description"
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="e.g. Ramen lunch, Airport train"
              maxLength={200}
              aria-invalid={!!errors.description}
            />
          </Field>

          <ChipGroup
            label="Category"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            value={values.categoryId}
            onChange={(id) => set('categoryId', id)}
            error={errors.categoryId}
          />

          <Field label="Date" htmlFor="date" error={errors.date}>
            <input
              id="date"
              type="date"
              className={inputClass}
              value={values.date}
              onChange={(e) => set('date', e.target.value)}
              aria-invalid={!!errors.date}
            />
          </Field>
        </Card>

        <Card className="space-y-4">
          <ChipGroup
            label="Paid by"
            options={travellers.map((t) => ({ value: t.id, label: t.displayName }))}
            value={values.payerId}
            onChange={(id) =>
              setValues((v) => ({
                ...v,
                payerId: id,
                // A personal expense follows the payer unless someone else was chosen.
                participantIds: v.splitMode === 'personal' && v.participantIds[0] === v.payerId ? [id] : v.participantIds,
              }))
            }
            error={errors.payerId}
          />
          <ChipGroup<PaymentMethod>
            label="Payment method"
            options={PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))}
            value={values.paymentMethod}
            onChange={(m) => set('paymentMethod', m)}
          />
          <Field
            label="Card or account nickname (optional)"
            htmlFor="account"
            error={errors.paymentAccountNote}
            hint="For example “Maybank Visa”. Never enter card numbers."
          >
            <TextInput
              id="account"
              value={values.paymentAccountNote}
              onChange={(e) => set('paymentAccountNote', e.target.value)}
              maxLength={60}
              aria-invalid={!!errors.paymentAccountNote}
            />
          </Field>
        </Card>

        <Card className="space-y-4">
          {travellers.length > 1 ? (
            <>
              <ChipGroup
                label="Who is this for?"
                options={[
                  { value: 'personal', label: 'Just one person' },
                  { value: 'equal', label: 'Split equally' },
                  { value: 'custom', label: 'Custom split' },
                ]}
                value={splitChoice}
                onChange={changeSplitMode}
              />
              {values.splitMode === 'personal' ? (
                <ChipGroup
                  label="Assigned to"
                  options={travellers.map((t) => ({ value: t.id, label: t.displayName }))}
                  value={values.participantIds[0] ?? ''}
                  onChange={(id) => set('participantIds', [id])}
                />
              ) : (
                <>
                  {splitChoice === 'custom' ? (
                    <ChipGroup
                      label="Split by"
                      options={[
                        { value: 'custom_amount', label: `Amount (${trip.baseCurrency})` },
                        { value: 'custom_weight', label: 'Shares' },
                      ]}
                      value={values.splitMode}
                      onChange={(m) => set('splitMode', m as 'custom_amount' | 'custom_weight')}
                    />
                  ) : null}
                  <fieldset>
                    <legend className="mb-1.5 text-sm font-medium text-slate-700">People sharing</legend>
                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {travellers.map((t) => {
                        const checked = values.participantIds.includes(t.id)
                        const share = evaluation.allocation?.find((a) => a.travellerId === t.id)
                        return (
                          <li key={t.id} className="flex min-h-12 items-center gap-3 px-3 py-1.5">
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                              <input
                                type="checkbox"
                                className="h-5 w-5 accent-accent-700"
                                checked={checked}
                                onChange={() => toggleParticipant(t.id)}
                              />
                              <span className="truncate">{t.displayName}</span>
                            </label>
                            {checked && values.splitMode === 'custom_amount' ? (
                              <input
                                className={`${inputClass} w-28 text-right tabular`}
                                inputMode="decimal"
                                aria-label={`${t.displayName}'s amount`}
                                placeholder="0.00"
                                value={values.customAmounts[t.id] ?? ''}
                                onChange={(e) => set('customAmounts', { ...values.customAmounts, [t.id]: e.target.value })}
                              />
                            ) : null}
                            {checked && values.splitMode === 'custom_weight' ? (
                              <input
                                className={`${inputClass} w-20 text-right tabular`}
                                inputMode="numeric"
                                aria-label={`${t.displayName}'s shares`}
                                value={values.weights[t.id] ?? '1'}
                                onChange={(e) => set('weights', { ...values.weights, [t.id]: e.target.value })}
                              />
                            ) : null}
                            {checked && values.splitMode !== 'custom_amount' ? (
                              <span className="w-24 text-right text-sm text-slate-700">
                                {share ? <Money minor={share.amount} currency={trip.baseCurrency} /> : '—'}
                              </span>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  </fieldset>
                  {values.splitMode === 'custom_amount' && evaluation.baseAmount !== null && evaluation.customSum !== null ? (
                    <p className="text-sm text-slate-700" aria-live="polite">
                      Allocated <Money minor={evaluation.customSum} currency={trip.baseCurrency} /> of{' '}
                      <Money minor={evaluation.baseAmount} currency={trip.baseCurrency} />
                      {evaluation.customSum !== evaluation.baseAmount ? (
                        <>
                          {' · '}
                          <strong>
                            {evaluation.customSum < evaluation.baseAmount ? 'Remaining ' : 'Over by '}
                            <Money minor={Math.abs(evaluation.baseAmount - evaluation.customSum)} currency={trip.baseCurrency} />
                          </strong>
                        </>
                      ) : (
                        ' · Fully allocated'
                      )}
                    </p>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-700">
              This expense is assigned to <strong>{travellers[0]?.displayName}</strong>. Add travellers on the Split tab
              to share costs.
            </p>
          )}
          {submitted && errors.split ? <FieldError>{errors.split}</FieldError> : null}

          {/* Preview */}
          {evaluation.allocation && evaluation.baseAmount !== null ? (
            <div className="rounded-lg bg-slate-50 p-3 text-sm" aria-live="polite">
              <p className="font-medium text-slate-900">
                Total <Money minor={evaluation.baseAmount} currency={trip.baseCurrency} /> · paid by {names.get(values.payerId) ?? '—'}
              </p>
              <ul className="mt-1 text-slate-700">
                {evaluation.allocation.map((a) => (
                  <li key={a.travellerId} className="flex justify-between gap-2">
                    <span className="truncate">{names.get(a.travellerId)}</span>
                    <Money minor={a.amount} currency={trip.baseCurrency} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        <Card>
          <Field label="Notes (optional)" htmlFor="notes" error={errors.notes}>
            <textarea
              id="notes"
              className={`${inputClass} min-h-20 py-2`}
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
              maxLength={2000}
              aria-invalid={!!errors.notes}
            />
          </Field>
        </Card>

        {saveError ? <Notice tone="danger">{saveError}</Notice> : null}
        {submitted && !evaluation.result ? (
          <Notice tone="danger">Please fix the highlighted fields before saving.</Notice>
        ) : null}

        <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
          <LinkButton to={cancelTo}>Cancel</LinkButton>
          {mode !== 'edit' ? (
            <Button disabled={busy} onClick={() => save(true)}>
              Save & add another
            </Button>
          ) : null}
          <Button type="submit" variant="primary" disabled={busy} className="min-w-28">
            {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Save expense'}
          </Button>
        </div>
      </form>
    </div>
  )
}
