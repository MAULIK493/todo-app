import { describe, expect, it } from 'vitest'
import { parseToolInput, TOOLS } from './schemas.ts'

const ID = '11111111-1111-1111-1111-111111111111'
const TZ = 'Asia/Kolkata'

describe('tool definitions', () => {
  it('are well formed and unique', () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length)
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(20)
      expect(t.input_schema.additionalProperties).toBe(false)
      expect(t.input_schema.required ?? []).toEqual((t.input_schema.required ?? []).filter((k) => k in t.input_schema.properties))
    }
  })
})

describe('parseToolInput', () => {
  it('applies defaults', () => {
    expect(parseToolInput('list_todos', {}, TZ)).toEqual({ ok: true, value: { view: 'open', min_priority: 0, limit: 25, workspace: undefined, tag: undefined } })
  })

  it('rejects non-objects and unknown fields (typos are not silently ignored)', () => {
    expect(parseToolInput('list_todos', null, TZ).ok).toBe(false)
    expect(parseToolInput('list_todos', [], TZ).ok).toBe(false)
    const r = parseToolInput('create_todo', { title: 'x', due: '2026-10-16' }, TZ)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/unknown field "due"/)
  })

  it('reports every problem at once', () => {
    const r = parseToolInput('create_todo', { title: '', priority: 9, due_at: 'tomorrow', tags: 'work' }, TZ)
    expect(r.ok).toBe(false)
    const msg = !r.ok ? r.error : ''
    expect(msg).toMatch(/title/)
    expect(msg).toMatch(/priority/)
    expect(msg).toMatch(/due_at/)
    expect(msg).toMatch(/tags/)
  })

  it('parses a complete todo, reading local dates in the user zone', () => {
    const r = parseToolInput('create_todo', { title: '  Call mom ', due_at: '2026-10-16T18:00', priority: 3, tags: ['#Family', 'family', ' Home '] }, TZ)
    expect(r.ok && r.value.title).toBe('Call mom')
    expect(r.ok && r.value.due_at?.toISOString()).toBe('2026-10-16T12:30:00.000Z')
    expect(r.ok && r.value.tags).toEqual(['family', 'home'])
  })

  it('requires a due date for recurrence', () => {
    const r = parseToolInput('create_todo', { title: 'x', recurrence: 'daily' }, TZ)
    expect(!r.ok && r.error).toMatch(/needs a "due_at"/)
  })

  it('validates ids so the model cannot pass names where ids belong', () => {
    expect(parseToolInput('complete_todo', { id: 'buy milk' }, TZ).ok).toBe(false)
    expect(parseToolInput('complete_todo', { id: ID }, TZ)).toEqual({ ok: true, value: { id: ID } })
    expect(parseToolInput('get_note', { id: ID }, TZ).ok).toBe(true)
  })

  it('update_todo needs a change, allows clearing the due date, and keeps null distinct from absent', () => {
    expect(parseToolInput('update_todo', { id: ID }, TZ).ok).toBe(false)
    const clear = parseToolInput('update_todo', { id: ID, due_at: null, recurrence: null }, TZ)
    expect(clear.ok && clear.value.due_at).toBeNull()
    expect(clear.ok && clear.value.recurrence).toBeNull()
    const set = parseToolInput('update_todo', { id: ID, status: 'in_progress' }, TZ)
    expect(set.ok && set.value.due_at).toBeUndefined()
    expect(parseToolInput('update_todo', { id: ID, status: 'done' }, TZ).ok).toBe(false)
  })

  it('bounds lists and dedupes ids', () => {
    expect(parseToolInput('add_subtasks', { parent_id: ID, titles: [] }, TZ).ok).toBe(false)
    expect(parseToolInput('add_subtasks', { parent_id: ID, titles: Array.from({ length: 21 }, (_, i) => `t${i}`) }, TZ).ok).toBe(false)
    const del = parseToolInput('propose_delete_todos', { ids: [ID, ID] }, TZ)
    expect(del.ok && del.value.ids).toEqual([ID])
    expect(parseToolInput('propose_delete_todos', { ids: [] }, TZ).ok).toBe(false)
    expect(parseToolInput('propose_delete_todos', { ids: ['nope'] }, TZ).ok).toBe(false)
    expect(parseToolInput('propose_reschedule_todos', { ids: [ID], due_at: '2026-10-16' }, TZ).ok).toBe(false) // bulk means 2+
  })

  it('caps limits', () => {
    expect(parseToolInput('list_todos', { limit: 500 }, TZ).ok).toBe(false)
    expect(parseToolInput('search_notes', { query: 'x', limit: 99 }, TZ).ok).toBe(false)
    expect(parseToolInput('search_todos', { query: '' }, TZ).ok).toBe(false)
  })
})
