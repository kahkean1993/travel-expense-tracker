/** Display helpers for ISO calendar dates (YYYY-MM-DD), parsed as local dates. */

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts)
}

export function formatDateRange(start: string, end: string) {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`
}

/** "Today", "Yesterday", otherwise e.g. "Wed, 21 Oct". */
export function dayLabel(iso: string, today: string): string {
  if (iso === today) return 'Today'
  const [y, m, d] = today.split('-').map(Number)
  const yesterday = new Date(y!, m! - 1, d! - 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (iso === `${yesterday.getFullYear()}-${pad(yesterday.getMonth() + 1)}-${pad(yesterday.getDate())}`) return 'Yesterday'
  return formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short' })
}
