import { describe, expect, it } from 'vitest'
import { formatLocal, isValidTimeZone, localDate, localHour, parseDueAt, tzOffsetMs, utcOffsetLabel, zonedDayRange, zonedWeekStart } from './dates.ts'

const iso = (d: Date) => d.toISOString()

describe('time zones', () => {
  it('validates zone names', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true)
    expect(isValidTimeZone('Not/AZone')).toBe(false)
  })

  it('computes offsets, including half-hour zones and DST', () => {
    expect(tzOffsetMs('Asia/Kolkata', new Date('2026-10-15T00:00:00Z'))).toBe(5.5 * 3_600_000)
    expect(tzOffsetMs('America/New_York', new Date('2026-07-01T12:00:00Z'))).toBe(-4 * 3_600_000)
    expect(tzOffsetMs('America/New_York', new Date('2026-12-01T12:00:00Z'))).toBe(-5 * 3_600_000)
    expect(utcOffsetLabel('Asia/Kolkata', new Date('2026-10-15T00:00:00Z'))).toBe('+05:30')
    expect(utcOffsetLabel('America/New_York', new Date('2026-12-01T12:00:00Z'))).toBe('-05:00')
  })
})

describe('zonedDayRange', () => {
  it('uses the user local day, not UTC', () => {
    // 23:30 UTC on the 14th is already the 15th in India.
    const now = new Date('2026-10-14T23:30:00Z')
    const { start, end } = zonedDayRange('Asia/Kolkata', now)
    expect(iso(start)).toBe('2026-10-14T18:30:00.000Z')
    expect(iso(end)).toBe('2026-10-15T18:30:00.000Z')
    expect(localDate('Asia/Kolkata', now)).toBe('2026-10-15')
  })

  it('handles zones behind UTC', () => {
    const now = new Date('2026-10-15T02:00:00Z') // still the 14th in New York
    const { start, end } = zonedDayRange('America/New_York', now)
    expect(iso(start)).toBe('2026-10-14T04:00:00.000Z')
    expect(iso(end)).toBe('2026-10-15T04:00:00.000Z')
  })

  it('has 25-hour and 23-hour days across daylight saving changes', () => {
    const fall = zonedDayRange('America/New_York', new Date('2026-11-01T12:00:00Z'))
    expect((fall.end.getTime() - fall.start.getTime()) / 3_600_000).toBe(25)
    const spring = zonedDayRange('America/New_York', new Date('2026-03-08T15:00:00Z'))
    expect((spring.end.getTime() - spring.start.getTime()) / 3_600_000).toBe(23)
  })

  it('shifts by whole local days', () => {
    const now = new Date('2026-10-14T12:00:00Z')
    expect(iso(zonedDayRange('UTC', now, 1).start)).toBe('2026-10-15T00:00:00.000Z')
    expect(iso(zonedDayRange('UTC', now, -1).start)).toBe('2026-10-13T00:00:00.000Z')
    expect(iso(zonedDayRange('UTC', new Date('2026-12-31T12:00:00Z'), 1).start)).toBe('2027-01-01T00:00:00.000Z')
  })

  it('days tile without gaps or overlap', () => {
    const now = new Date('2026-11-01T12:00:00Z')
    expect(iso(zonedDayRange('America/New_York', now).end)).toBe(iso(zonedDayRange('America/New_York', now, 1).start))
  })
})

describe('week and display helpers', () => {
  it('starts the week on Monday', () => {
    // Wednesday 14 Oct 2026
    expect(iso(zonedWeekStart('UTC', new Date('2026-10-14T12:00:00Z')))).toBe('2026-10-12T00:00:00.000Z')
    // Sunday belongs to the week that began the previous Monday
    expect(iso(zonedWeekStart('UTC', new Date('2026-10-18T12:00:00Z')))).toBe('2026-10-12T00:00:00.000Z')
    expect(iso(zonedWeekStart('UTC', new Date('2026-10-12T00:00:00Z')))).toBe('2026-10-12T00:00:00.000Z')
  })

  it('formats local time and hour', () => {
    const at = new Date('2026-10-15T17:20:00Z')
    expect(formatLocal('Asia/Kolkata', at)).toMatch(/Thu.*15 Oct 2026.*22:50/)
    expect(localHour('Asia/Kolkata', at)).toBe(22)
  })
})

describe('parseDueAt', () => {
  it('reads timestamps that carry their own offset', () => {
    expect(iso(parseDueAt('2026-10-16T18:00:00+05:30', 'UTC')!)).toBe('2026-10-16T12:30:00.000Z')
    expect(iso(parseDueAt('2026-10-16T18:00:00Z', 'Asia/Kolkata')!)).toBe('2026-10-16T18:00:00.000Z')
  })

  it('reads bare local times in the user zone', () => {
    expect(iso(parseDueAt('2026-10-16T18:00', 'Asia/Kolkata')!)).toBe('2026-10-16T12:30:00.000Z')
    expect(iso(parseDueAt('2026-10-16 18:00:30', 'America/New_York')!)).toBe('2026-10-16T22:00:30.000Z')
  })

  it('accepts real edge dates', () => {
    expect(parseDueAt('2028-02-29', 'UTC')).not.toBeNull() // leap day
    expect(parseDueAt('2026-12-31T23:59:59Z', 'UTC')).not.toBeNull()
  })

  it('treats a bare date as 09:00 local', () => {
    expect(iso(parseDueAt('2026-10-16', 'Asia/Kolkata')!)).toBe('2026-10-16T03:30:00.000Z')
  })

  it('rejects anything else', () => {
    for (const bad of ['tomorrow', '16/10/2026', '2026-13-45T10:00', '2026-10-16T25:99', '', '2026-10-16T18:00:00+99', 'next friday', '2026-02-30', '2026-02-29T10:00:00Z', '2026-04-31T10:00']) {
      expect(parseDueAt(bad, 'UTC')).toBeNull()
    }
  })
})
