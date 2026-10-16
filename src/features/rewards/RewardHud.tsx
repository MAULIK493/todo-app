import { Coins, Flame } from 'lucide-react'
import { motion } from 'motion/react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { AnimatedNumber } from './AnimatedNumber'
import { useRewardSummary } from './api'

/** Compact level / XP / coins / streak card shown in the sidebar. */
export function RewardHud({ compact = false }: { compact?: boolean }) {
  const { data: r } = useRewardSummary()
  if (!r) return null
  const span = r.next_level_xp - r.level_start_xp
  const progress = Math.min(1, Math.max(0, (r.xp - r.level_start_xp) / span))

  if (compact) {
    // Slim rail: just the level badge, with the progress ring around it.
    return (
      <NavLink to="/rewards" aria-label={`Rewards: level ${r.level}, ${r.streak} day streak`} title={`Level ${r.level} · ${r.coins} coins · ${r.streak} day streak`} className="mb-3 block">
        <div data-xp-target className="grid size-11 place-items-center rounded-full font-bold text-white" style={{ background: `conic-gradient(var(--accent-2) ${progress * 360}deg, rgba(255,255,255,0.15) 0)` }}>
          <span className="grid size-9 place-items-center rounded-full bg-accent">{r.level}</span>
        </div>
      </NavLink>
    )
  }

  return (
    <NavLink to="/rewards" aria-label="Rewards" className="glass spotlight mb-3 block rounded-xl p-3 transition-transform hover:scale-[1.02]">
      <div className="flex items-center gap-3">
        <div data-xp-target className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 font-bold text-white">
          {r.level}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Level {r.level}</span>
            <span><AnimatedNumber value={r.xp - r.level_start_xp} /> / {span} XP</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="XP to next level">
            <motion.div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2" initial={false} animate={{ width: `${progress * 100}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="flex items-center gap-1 text-amber-400"><Coins size={14} /> <AnimatedNumber value={r.coins} /></span>
        <span className={cn('flex items-center gap-1', r.streak > 0 && r.active_today ? 'text-orange-400' : 'text-muted')} title={r.active_today ? 'Streak is safe for today' : 'Complete a todo today to keep your streak'}>
          <motion.span animate={r.streak > 0 && r.active_today ? { scale: [1, 1.2, 1] } : {}} transition={{ repeat: Infinity, duration: 1.6 }}><Flame size={14} /></motion.span>
          {r.streak}
        </span>
      </div>
    </NavLink>
  )
}
