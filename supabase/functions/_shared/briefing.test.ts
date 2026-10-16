import { describe, expect, it } from 'vitest'
import { buildBriefingFacts, suggestedKind } from './briefing.ts'
import { FakeDb, todo } from './fakeDb.ts'

const WS = { id: 'a0000000-0000-0000-0000-000000000001', name: 'Work', lock_state: 'none' as const }
const NOW = new Date('2026-10-15T06:00:00Z')

describe('buildBriefingFacts', () => {
  it('summarises the visible workspaces only and never invents data', async () => {
    const db = new FakeDb([WS])
    db.todos = [
      todo({ id: '1', workspace_id: WS.id, title: 'File taxes', priority: 3, due_at: '2026-10-14T10:00:00Z' }),
      todo({ id: '2', workspace_id: 'other-private-ws', title: 'enc:v1:xx:yy' }),
    ]
    const facts = JSON.parse(await buildBriefingFacts(db, { kind: 'morning', now: NOW, tz: 'UTC', tone: 'coach', workspaces: [WS] }))
    expect(facts.kind).toBe('morning')
    expect(facts.tone).toMatch(/coach/)
    expect(JSON.stringify(facts)).not.toContain('enc:v1')
    expect(facts.completed_recently).toBeUndefined()
    expect(facts.now).toMatch(/15 Oct 2026/)
  })

  it('includes recent wins in the evening', async () => {
    const db = new FakeDb([WS])
    const facts = JSON.parse(await buildBriefingFacts(db, { kind: 'evening', now: NOW, tz: 'UTC', tone: 'friendly', workspaces: [WS] }))
    expect(facts.completed_recently).toEqual([])
  })

  it('copes with no visible workspaces', async () => {
    const facts = JSON.parse(await buildBriefingFacts(new FakeDb(), { kind: 'morning', now: NOW, tz: 'UTC', tone: 'friendly', workspaces: [] }))
    expect(facts.totals).toEqual({ open: 0, overdue: 0, due_today: 0 })
  })

  it('suggests a briefing by local time of day', () => {
    expect([3, 5, 11, 12, 16, 17, 23].map(suggestedKind)).toEqual([null, 'morning', 'morning', null, null, 'evening', 'evening'])
  })
})
