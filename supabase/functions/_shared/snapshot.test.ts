import { describe, expect, it } from 'vitest'
import { formatSnapshot } from './snapshot.ts'

const now = new Date('2026-10-15T10:00:00Z')
const ws = [{ id: 'w1', name: 'Work', lock_state: 'none' as const }]
const todo = (o: object) => ({ id: 't1', title: 'Ship it', description: '', status: 'open', priority: 3, due_at: '2026-10-14T10:00:00Z', recurrence: null, workspace_id: 'w1', parent_id: null, tags: [], subtask_count: 0, ...o }) as never

describe('formatSnapshot', () => {
  it('lists todos with ids, overdue flag and progress', () => {
    const s = formatSnapshot({ todos: [todo({})], workspaces: ws, rewards: { level: 2, xp: 1, coins: 0, streak: 4, longest_streak: 4, active_today: true, today_done: 1, daily_goal: 3, week_done: 5, weekly_goal: 10 }, tz: 'UTC', now })
    expect(s).toContain('[t1] Ship it')
    expect(s).toContain('OVERDUE')
    expect(s).toContain('high priority')
    expect(s).toContain('4-day streak')
  })
  it('says so when nothing is open', () => {
    expect(formatSnapshot({ todos: [], workspaces: ws, rewards: null, tz: 'UTC', now })).toBe('No open todos.')
  })
})
