export type RewardMetric = 'total_completed' | 'high_priority' | 'on_time' | 'streak' | 'level'

export type RewardSummary = {
  xp: number
  level: number
  level_start_xp: number
  next_level_xp: number
  coins: number
  streak: number
  longest_streak: number
  freezes: number
  active_today: boolean
  daily_goal: number
  weekly_goal: number
  today_done: number
  week_done: number
  today_xp: number
  daily_xp_cap: number
  timezone: string
  metrics: Record<RewardMetric, number>
  achievements: { code: string; unlocked_at: string }[]
}

export type Achievement = {
  code: string
  name: string
  description: string
  icon: string
  metric: RewardMetric
  threshold: number
  xp_reward: number
  coin_reward: number
}

export type LedgerEntry = {
  id: number
  kind: 'complete' | 'subtask' | 'daily_goal' | 'weekly_goal' | 'achievement' | 'freeze_earned' | 'freeze_used' | 'redeem' | 'purchase'
  xp: number
  coins: number
  day: string
  meta: { title?: string; name?: string; item?: string; capped?: boolean; fast?: boolean; on_time?: boolean }
  created_at: string
}

export type ShopItem = { id: string; name: string; description: string; icon: string; cost_coins: number }
export type Redemption = { id: string; item_name: string; cost_coins: number; created_at: string }

export const STREAK_FREEZE_COST = 100
