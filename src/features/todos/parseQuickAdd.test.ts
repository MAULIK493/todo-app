import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from './parseQuickAdd'

// Wednesday 2026-10-14 10:00 local
const now = new Date(2026, 9, 14, 10, 0, 0)
const local = (iso: string | null) => (iso ? new Date(iso) : null)

describe('parseQuickAdd', () => {
  it('leaves plain text alone', () => {
    const r = parseQuickAdd('Buy milk', now)
    expect(r).toMatchObject({ title: 'Buy milk', due_at: null, priority: 0, tags: [], recurrence: null })
  })

  it('parses date, time, priority and tags together', () => {
    const r = parseQuickAdd('call mom tomorrow 6pm !high #family', now)
    expect(r.title).toBe('call mom')
    expect(r.priority).toBe(3)
    expect(r.tags).toEqual(['family'])
    const d = local(r.due_at)!
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([15, 18, 0])
  })

  it('moves a weekday to its next occurrence', () => {
    const d = local(parseQuickAdd('report on friday at 14:30', now).due_at)!
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([16, 14, 30])
    // Same weekday means next week, not today.
    expect(local(parseQuickAdd('standup wednesday', now).due_at)!.getDate()).toBe(21)
  })

  it('treats a passed bare time as tomorrow', () => {
    expect(local(parseQuickAdd('gym 8am', now).due_at)!.getDate()).toBe(15)
    expect(local(parseQuickAdd('lunch 1pm', now).due_at)!.getDate()).toBe(14)
  })

  it('handles relative dates and 12am/12pm', () => {
    expect(local(parseQuickAdd('x in 3 days', now).due_at)!.getDate()).toBe(17)
    expect(local(parseQuickAdd('x tomorrow 12am', now).due_at)!.getHours()).toBe(0)
    expect(local(parseQuickAdd('x tomorrow 12pm', now).due_at)!.getHours()).toBe(12)
  })

  it('parses recurrence and gives it a due date', () => {
    const r = parseQuickAdd('water plants every week', now)
    expect(r.title).toBe('water plants')
    expect(r.recurrence).toBe('weekly')
    expect(r.due_at).not.toBeNull()
  })

  it('keeps #words in the title when tags are switched off', () => {
    const r = parseQuickAdd('call mom #family tomorrow', now, { tags: false })
    expect(r.tags).toEqual([])
    expect(r.title).toBe('call mom #family')
  })

  it('does not eat words that merely contain tokens', () => {
    expect(parseQuickAdd('plan todayish trip', now).title).toBe('plan todayish trip')
  })

  it('falls back to the raw input when everything is a token', () => {
    expect(parseQuickAdd('tomorrow', now).title).toBe('tomorrow')
  })
})
