import { href, paths } from '../../app/router'
import { Money } from '../../components/ui'
import { formatDate } from '../../lib/dates'
import { formatMoney } from '../../lib/money/money'
import type { Expense } from '../../types/domain'

export function ExpenseRow({
  expense,
  categoryName,
  payerName,
  showDate = true,
}: {
  expense: Expense
  categoryName: string
  payerName: string
  showDate?: boolean
}) {
  const foreign = expense.originalCurrency !== expense.baseCurrency
  return (
    <li>
      <a
        href={href(paths.expenseView(expense.tripId, expense.id))}
        className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-900">{expense.description}</p>
          <p className="truncate text-sm text-slate-600">
            {[showDate ? formatDate(expense.date, { day: 'numeric', month: 'short' }) : null, categoryName, `Paid by ${payerName}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Money minor={expense.baseAmountMinorUnits} currency={expense.baseCurrency} className="font-medium text-slate-900" />
          {foreign ? (
            <p className="text-xs text-slate-500 tabular">
              {formatMoney(expense.originalAmountMinorUnits, expense.originalCurrency)}
            </p>
          ) : null}
        </div>
      </a>
    </li>
  )
}
