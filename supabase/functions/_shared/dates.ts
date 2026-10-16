// Time-zone maths without a date library. "Today" means the user's local day, not the server's.

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const partsOf = (tz: string, at: Date) => {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]))
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, second: +p.second }
}

/** Milliseconds the zone is ahead of UTC at this instant (negative for the Americas). */
export function tzOffsetMs(tz: string, at: Date): number {
  const p = partsOf(tz, at)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/** The instant at which the wall clock in `tz` shows this local date and time. */
export function wallTimeToInstant(tz: string, year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const first = guess - tzOffsetMs(tz, new Date(guess))
  // Re-evaluate at the first estimate: the offset can differ across a daylight-saving change.
  return new Date(guess - tzOffsetMs(tz, new Date(first)))
}

const localMidnight = (tz: string, year: number, month: number, day: number) => wallTimeToInstant(tz, year, month, day)

/** [start, end) of the local day containing `now`, shifted by `dayOffset` days. */
export function zonedDayRange(tz: string, now: Date, dayOffset = 0): { start: Date; end: Date } {
  const p = partsOf(tz, now)
  // Date.UTC normalises overflowing days/months, which gives us calendar arithmetic for free.
  const base = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset))
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset + 1))
  return {
    start: localMidnight(tz, base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()),
    end: localMidnight(tz, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()),
  }
}

/** Start of the local week (Monday), matching how weekly goals are counted. */
export function zonedWeekStart(tz: string, now: Date): Date {
  const today = zonedDayRange(tz, now).start
  const p = partsOf(tz, today)
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() // 0 = Sunday
  return zonedDayRange(tz, now, -((weekday + 6) % 7)).start
}

export function localDate(tz: string, now: Date): string {
  const p = partsOf(tz, now)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function utcOffsetLabel(tz: string, at: Date): string {
  const mins = Math.round(tzOffsetMs(tz, at) / 60_000)
  const sign = mins < 0 ? '-' : '+'
  const abs = Math.abs(mins)
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`
}

/** "Thu 15 Oct 2026, 22:50" in the user's zone. */
export function formatLocal(tz: string, at: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(at).replace(/,? at /, ', ')
}

export function localHour(tz: string, now: Date): number {
  return partsOf(tz, now).hour
}

const validCalendar = (y: number, mo: number, d: number, h: number, mi: number, sec: number) =>
  mo >= 1 && mo <= 12 && d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate() && h >= 0 && h <= 23 && mi >= 0 && mi <= 59 && sec >= 0 && sec <= 59

/**
 * Parses a due date from the model. Accepts a full ISO timestamp (with Z or an offset), or a local wall time
 * with no offset ("2026-10-16T18:00" or just "2026-10-16", which means 09:00) read in the user's zone.
 * Impossible dates (month 13, 31 February, 25:00) are rejected rather than silently rolled over.
 */
export function parseDueAt(input: string, tz: string): Date | null {
  const s = input.trim()
  const local = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
  if (local) {
    const [y, mo, d] = [+local[1], +local[2], +local[3]]
    const [h, mi, sec] = [local[4] === undefined ? 9 : +local[4], local[5] === undefined ? 0 : +local[5], local[6] === undefined ? 0 : +local[6]]
    if (!validCalendar(y, mo, d, h, mi, sec)) return null
    return wallTimeToInstant(tz, y, mo, d, h, mi, sec)
  }
  const full = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.exec(s)
  if (!full) return null
  if (!validCalendar(+full[1], +full[2], +full[3], +full[4], +full[5], full[6] === undefined ? 0 : +full[6])) return null
  const offset = full[7]
  if (offset !== 'Z' && +offset.slice(1, 3) > 23) return null
  const date = new Date(s.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? null : date
}
