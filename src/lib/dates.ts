export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

export const addDays = (d: Date, n: number) => {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO timestamp -> value for <input type="datetime-local"> in local time. */
export const toLocalInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

export function formatDue(iso: string, now = new Date()) {
  const d = new Date(iso)
  const days = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86_400_000)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  if (days === 0) return `Today ${time}`
  if (days === 1) return `Tomorrow ${time}`
  if (days === -1) return `Yesterday ${time}`
  if (days > 1 && days < 7) return `${d.toLocaleDateString([], { weekday: 'long' })} ${time}`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })
}

export function timeAgo(iso: string, now = new Date()) {
  const secs = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000))
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86_400) return `${Math.floor(secs / 3600)}h ago`
  if (secs < 7 * 86_400) return `${Math.floor(secs / 86_400)}d ago`
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}
