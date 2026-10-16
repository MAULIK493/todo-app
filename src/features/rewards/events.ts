import type { RewardSummary } from './types'

export type RewardEvents = {
  xp: number
  coins: number
  leveledUpTo: number | null
  streak: number | null
  dailyGoal: boolean
  weeklyGoal: boolean
  newAchievements: string[]
}

/**
 * What happened between two summaries? Completions are rewarded on the server, so the UI works out
 * celebrations from the change in state. Returns null when nothing was earned (e.g. after spending coins).
 */
export function diffSummaries(prev: RewardSummary, next: RewardSummary): RewardEvents | null {
  const known = new Set(prev.achievements.map((a) => a.code))
  const newAchievements = next.achievements.filter((a) => !known.has(a.code)).map((a) => a.code)
  if (next.xp <= prev.xp && newAchievements.length === 0) return null

  return {
    xp: Math.max(0, next.xp - prev.xp),
    coins: Math.max(0, next.coins - prev.coins),
    leveledUpTo: next.level > prev.level ? next.level : null,
    streak: next.streak > prev.streak ? next.streak : null,
    dailyGoal: prev.today_done < prev.daily_goal && next.today_done >= next.daily_goal,
    weeklyGoal: prev.week_done < prev.weekly_goal && next.week_done >= next.weekly_goal,
    newAchievements,
  }
}

export function describeGain(e: RewardEvents) {
  const parts = [`+${e.xp} XP`, `+${e.coins} coins`]
  if (e.streak) parts.push(`${e.streak}-day streak`)
  if (e.dailyGoal) parts.push('daily goal reached!')
  if (e.weeklyGoal) parts.push('weekly goal reached!')
  return parts.join(' · ')
}
