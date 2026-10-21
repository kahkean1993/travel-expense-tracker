/**
 * A per-person statement: every expense and payment that moves someone's
 * balance, so "why do I owe this?" can be answered line by line.
 */
import type { Expense, ExpenseShare, ID, ISODate, Settlement } from '../../types/domain'

export interface StatementLine {
  kind: 'expense' | 'payment'
  id: ID
  date: ISODate
  title: string
  /** For expenses: who paid it. For payments: who paid whom. */
  detail: string
  /** The part of an expense this person paid up front. */
  paid: number
  /** This person's share of the expense. */
  share: number
  /** A settlement payment this person made. */
  sent: number
  /** A settlement payment this person received. */
  received: number
  /** How the line moves their balance: paid − share + sent − received. */
  effect: number
}

export interface Statement {
  lines: StatementLine[]
  totals: { paid: number; share: number; sent: number; received: number; net: number }
}

export function statementFor(
  travellerId: ID,
  expenses: Expense[],
  shares: ExpenseShare[],
  settlements: Settlement[],
  names: Map<ID, string>,
): Statement {
  const nameOf = (id: ID) => names.get(id) ?? 'Former traveller'
  const myShare = new Map<ID, number>()
  for (const s of shares) {
    if (s.travellerId === travellerId) myShare.set(s.expenseId, (myShare.get(s.expenseId) ?? 0) + s.allocatedBaseAmountMinorUnits)
  }

  const lines: (StatementLine & { order: string })[] = []
  for (const e of expenses) {
    const paid = e.payerTravellerId === travellerId ? e.baseAmountMinorUnits : 0
    const share = myShare.get(e.id) ?? 0
    if (paid === 0 && share === 0) continue
    lines.push({
      kind: 'expense',
      id: e.id,
      date: e.date,
      title: e.description,
      detail: `Paid by ${nameOf(e.payerTravellerId)}`,
      paid,
      share,
      sent: 0,
      received: 0,
      effect: paid - share,
      order: e.createdAt,
    })
  }
  for (const p of settlements) {
    const sent = p.fromTravellerId === travellerId ? p.amountMinorUnits : 0
    const received = p.toTravellerId === travellerId ? p.amountMinorUnits : 0
    if (sent === 0 && received === 0) continue
    lines.push({
      kind: 'payment',
      id: p.id,
      date: p.paidOn,
      title: sent ? `Paid ${nameOf(p.toTravellerId)}` : `Received from ${nameOf(p.fromTravellerId)}`,
      detail: p.note,
      paid: 0,
      share: 0,
      sent,
      received,
      effect: sent - received,
      order: p.createdAt,
    })
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order) || a.id.localeCompare(b.id))

  const totals = { paid: 0, share: 0, sent: 0, received: 0, net: 0 }
  for (const l of lines) {
    totals.paid += l.paid
    totals.share += l.share
    totals.sent += l.sent
    totals.received += l.received
  }
  totals.net = totals.paid - totals.share + totals.sent - totals.received
  return { lines: lines.map(({ order: _order, ...line }) => line), totals }
}
