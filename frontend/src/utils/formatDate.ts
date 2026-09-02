/**
 * Dates as the canvas writes them.
 *
 * Two shapes, and the distinction matters: a list says how long ago something
 * happened ("2 hours ago"), while a table of records shows the timestamp
 * itself, in mono, because those line up in a column and get compared.
 */

export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'

  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'Just now'

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.round(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`

  const months = Math.round(days / 30)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`

  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** `28 Aug, 09:14` — the Responses table's Submitted column. */
export function submittedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(',', ',')
}

/** `12 Mar 2026` — a joined-on date, where the time of day is noise. */
export function calendarDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
