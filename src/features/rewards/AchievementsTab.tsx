import { Lock } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { stagger, fadeUp } from '@/lib/motion'
import { useAchievementCatalog } from './api'
import { iconFor } from './icons'
import type { RewardSummary } from './types'

export function AchievementsTab({ r }: { r: RewardSummary }) {
  const { data: catalog = [], isLoading, error } = useAchievementCatalog()
  const unlocked = new Map(r.achievements.map((a) => [a.code, a.unlocked_at]))

  if (isLoading) return <div className="glass h-40 shimmer rounded-2xl" aria-busy />
  if (error) return <p className="text-red-400" role="alert">Could not load achievements: {error.message}</p>

  return (
    <>
      <p className="mb-3 text-sm text-muted">{unlocked.size} of {catalog.length} unlocked</p>
      <motion.ul variants={stagger} initial="hidden" animate="show" className="grid gap-3 sm:grid-cols-2">
        {catalog.map((a) => {
          const at = unlocked.get(a.code)
          const value = Math.min(r.metrics[a.metric] ?? 0, a.threshold)
          const Icon = iconFor(a.icon)
          return (
            <motion.li key={a.code} variants={fadeUp} className={cn('glass flex gap-3 rounded-2xl p-4', !at && 'opacity-80')}>
              <div className={cn('grid size-12 shrink-0 place-items-center rounded-full text-white', at ? 'bg-gradient-to-br from-amber-400 to-orange-500' : 'bg-white/10 text-muted')}>
                {at ? <Icon size={22} /> : <Lock size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{a.name}</p>
                <p className="text-sm text-muted">{a.description}</p>
                {at ? (
                  <p className="mt-1 text-xs text-green-400">Unlocked {new Date(at).toLocaleDateString()}</p>
                ) : (
                  <div className="mt-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={`${a.name} progress`} aria-valuenow={value} aria-valuemin={0} aria-valuemax={a.threshold}>
                      <div className="h-full rounded-full bg-accent" style={{ width: `${(value / a.threshold) * 100}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-muted">{value} / {a.threshold} · reward +{a.xp_reward} XP, +{a.coin_reward} coins</p>
                  </div>
                )}
              </div>
            </motion.li>
          )
        })}
      </motion.ul>
    </>
  )
}
