import { describe, expect, it } from 'vitest'
import { describeGain, diffSummaries } from './events'
import type { RewardSummary } from './types'

const base: RewardSummary = {
  xp: 100, level: 2, level_start_xp: 100, next_level_xp: 300, coins: 20, streak: 1, longest_streak: 1, freezes: 0,
  active_today: true, daily_goal: 3, weekly_goal: 15, today_done: 1, week_done: 1, today_xp: 15, daily_xp_cap: 500,
  timezone: 'UTC', achievements: [],
  metrics: { total_completed: 1, high_priority: 0, on_time: 0, streak: 1, level: 2 },
}

describe('diffSummaries', () => {
  it('returns null when nothing was earned', () => {
    expect(diffSummaries(base, { ...base })).toBeNull()
    // spending coins is not a gain
    expect(diffSummaries(base, { ...base, coins: 5 })).toBeNull()
  })

  it('reports xp and coins gained', () => {
    const e = diffSummaries(base, { ...base, xp: 115, coins: 23 })!
    expect(e).toMatchObject({ xp: 15, coins: 3, leveledUpTo: null, streak: null })
    expect(describeGain(e)).toBe('+15 XP · +3 coins')
  })

  it('detects level-ups, streak growth and goals', () => {
    const e = diffSummaries(base, { ...base, xp: 310, level: 3, streak: 2, today_done: 3, week_done: 15 })!
    expect(e.leveledUpTo).toBe(3)
    expect(e.streak).toBe(2)
    expect(e.dailyGoal).toBe(true)
    expect(e.weeklyGoal).toBe(true)
  })

  it('does not repeat a goal that was already reached', () => {
    const reached = { ...base, today_done: 3 }
    expect(diffSummaries(reached, { ...reached, xp: 120, today_done: 4 })!.dailyGoal).toBe(false)
  })

  it('lists newly unlocked achievements only', () => {
    const before = { ...base, achievements: [{ code: 'first_step', unlocked_at: 'x' }] }
    const after = { ...before, xp: 140, achievements: [...before.achievements, { code: 'getting_going', unlocked_at: 'y' }] }
    expect(diffSummaries(before, after)!.newAchievements).toEqual(['getting_going'])
  })
})
