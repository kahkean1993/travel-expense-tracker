/** Display helpers for ISO calendar dates (YYYY-MM-DD), parsed as local dates. */

export function formatDate(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts)
}

export function formatDateRange(start: string, end: string) {
  return start === end ? formatDate(start) : `${formatDate(start)} – ${formatDate(end)}`
}
