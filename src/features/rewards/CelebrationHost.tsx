import { Trophy } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { burst, useCelebrations } from './celebrate'
import { iconFor } from './icons'

/** Full-screen level-up / achievement moments, shown one at a time. Click or wait to dismiss. */
export function CelebrationHost() {
  const current = useCelebrations((s) => s.queue[0])
  const dismiss = useCelebrations((s) => s.dismiss)

  useEffect(() => {
    if (!current) return
    if (current.type === 'level') burst('big')
    const t = setTimeout(() => dismiss(current.id), 4500)
    return () => clearTimeout(t)
  }, [current, dismiss])

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id} role="dialog" aria-live="assertive" aria-label={current.type === 'level' ? 'Level up' : 'Achievement unlocked'}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          onClick={() => dismiss(current.id)}
          className="fixed inset-0 z-[60] grid cursor-pointer place-items-center bg-black/60 p-6 backdrop-blur-sm"
        >
          <motion.div
            initial={{ scale: 0.6, rotate: -4, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="glass gradient-border relative w-full max-w-sm overflow-hidden rounded-3xl bg-surface-solid p-8 text-center"
          >
            {current.type === 'level' ? <LevelUp level={current.level} /> : <AchievementCard c={current} />}
            <p className="mt-6 text-xs text-muted">Click to continue</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function LevelUp({ level }: { level: number }) {
  return (
    <>
      <motion.div
        animate={{ rotate: [0, -8, 8, 0], scale: [1, 1.15, 1] }} transition={{ duration: 0.8, delay: 0.2 }}
        className="mx-auto grid size-20 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-white"
      >
        <Trophy size={40} />
      </motion.div>
      <p className="mt-4 text-sm uppercase tracking-widest text-muted">Level up!</p>
      <motion.p initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.15 }} className="gradient-text text-7xl font-black">
        {level}
      </motion.p>
    </>
  )
}

function AchievementCard({ c }: { c: Extract<ReturnType<typeof useCelebrations.getState>['queue'][number], { type: 'achievement' }> }) {
  const Icon = iconFor(c.icon)
  return (
    <>
      <div className="relative mx-auto grid size-20 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white">
        <Icon size={40} />
        {/* one-off shine sweep */}
        <motion.span
          aria-hidden initial={{ x: '-150%' }} animate={{ x: '150%' }} transition={{ duration: 1, delay: 0.4 }}
          className="absolute inset-0 -skew-x-12 bg-gradient-to-r from-transparent via-white/60 to-transparent"
        />
      </div>
      <p className="mt-4 text-sm uppercase tracking-widest text-muted">Achievement unlocked</p>
      <p className="mt-1 text-2xl font-bold">{c.name}</p>
      <p className="mt-1 text-muted">{c.description}</p>
      <p className="mt-3 text-sm text-accent-2">+{c.xp} XP · +{c.coins} coins</p>
    </>
  )
}
