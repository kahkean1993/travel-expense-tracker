import { href, paths } from '../../app/router'
import { Money } from '../../components/ui'
import { CategoryIcon } from '../../components/visuals'
import { formatDate } from '../../lib/dates'
import { formatMoney } from '../../lib/money/money'
import type { Expense } from '../../types/domain'

export function ExpenseRow({
  expense,
  categoryName,
  payerName,
  showDate = true,
  highlight = false,
  index = 0,
}: {
  expense: Expense
  categoryName: string
  payerName: string
  showDate?: boolean
  /** Briefly tint the row, e.g. right after it was saved. */
  highlight?: boolean
  /** Position in the list, used to stagger the entrance. */
  index?: number
}) {
  const foreign = expense.originalCurrency !== expense.baseCurrency
  return (
    <li
      className={`animate-enter ${highlight ? 'animate-flash' : ''}`}
      style={{ animationDelay: `${Math.min(index, 8) * 35}ms` }}
    >
      <a
        href={href(paths.expenseView(expense.tripId, expense.id))}
        className="press flex items-center gap-3 px-4 py-3 hover:bg-slate-50"
        title={`${categoryName}, paid by ${payerName}`}
      >
        <CategoryIcon id={expense.categoryId} name={categoryName} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-slate-900">{expense.description}</p>
          <p className="truncate text-[13px] text-slate-500">
            {showDate ? `${formatDate(expense.date, { day: 'numeric', month: 'short' })} · ` : ''}
            {categoryName}
            <span className="sr-only">, paid by {payerName}</span>
            <span aria-hidden="true"> · {payerName}</span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <Money minor={expense.baseAmountMinorUnits} currency={expense.baseCurrency} className="text-[15px] font-semibold text-slate-900" />
          {foreign ? (
            <p className="tabular text-xs text-slate-500">{formatMoney(expense.originalAmountMinorUnits, expense.originalCurrency)}</p>
          ) : null}
        </div>
      </a>
    </li>
  )
}
