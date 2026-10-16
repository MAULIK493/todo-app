/** Mirrors level_for_xp() in supabase/migrations/0006_rewards.sql: level L starts at 50*L*(L-1) XP. */
export const xpForLevel = (level: number) => 50 * level * (level - 1)

export const levelForXp = (xp: number) => Math.max(1, Math.floor((1 + Math.sqrt(1 + xp / 12.5)) / 2))
