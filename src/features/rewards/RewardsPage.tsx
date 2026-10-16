import { Coins, Flame, Snowflake, Volume2, VolumeX } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { fadeUp } from '@/lib/motion'
import { useToasts } from '@/stores/toasts'
import { AchievementsTab } from './AchievementsTab'
import { ActivityTab } from './ActivityTab'
import { AnimatedNumber } from './AnimatedNumber'
import { useRewardMutations, useRewardSummary } from './api'
import { useCelebrations } from './celebrate'
import { ShopTab } from './ShopTab'
import { STREAK_FREEZE_COST, type RewardSummary } from './types'

const TABS = ['Overview', 'Achievements', 'Shop', 'Activity'] as const

export function RewardsPage() {
  const { data: r, isLoading, error } = useRewardSummary()
  const [tab, setTab] = useState<(typeof TABS)[number]>('Overview')

  if (isLoading) return <div className="glass h-64 shimmer rounded-2xl" aria-busy />
  if (error || !r) return <p className="text-red-400" role="alert">Could not load rewards{error ? `: ${error.message}` : '.'}</p>

  return (
    <motion.section variants={fadeUp} initial="hidden" animate="show" className="mx-auto max-w-3xl space-y-4">
      <h1 className="gradient-text text-3xl font-bold">Rewards</h1>
      <div role="tablist" className="glass flex w-fit max-w-full overflow-x-auto rounded-xl p-1">
        {TABS.map((t) => (
          <button
            key={t} role="tab" aria-selected={t === tab} onClick={() => setTab(t)}
            className={cn('relative whitespace-nowrap rounded-lg px-4 py-1.5 text-sm', t === tab ? 'text-white' : 'text-muted')}
          >
            {t === tab && <motion.span layoutId="rewards-tab" className="absolute inset-0 rounded-lg bg-accent" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
            <span className="relative">{t}</span>
          </button>
        ))}
      </div>
      {tab === 'Overview' && <Overview r={r} />}
      {tab === 'Achievements' && <AchievementsTab r={r} />}
      {tab === 'Shop' && <ShopTab r={r} />}
      {tab === 'Activity' && <ActivityTab />}
    </motion.section>
  )
}

function Meter({ label, value, max, detail }: { label: string; value: number; max: number; detail?: string }) {
  const pct = Math.min(1, value / max)
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm"><span>{label}</span><span className="text-muted">{detail ?? `${value} / ${max}`}</span></div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <motion.div className={cn('h-full rounded-full', pct >= 1 ? 'bg-green-500' : 'bg-gradient-to-r from-accent to-accent-2')} initial={{ width: 0 }} animate={{ width: `${pct * 100}%` }} transition={{ type: 'spring', stiffness: 100, damping: 20 }} />
      </div>
    </div>
  )
}

function Overview({ r }: { r: RewardSummary }) {
  const { buyFreeze, setGoals } = useRewardMutations()
  const push = useToasts((s) => s.push)
  const { soundOn, setSound } = useCelebrations()
  const [daily, setDaily] = useState(r.daily_goal)
  const [weekly, setWeekly] = useState(r.weekly_goal)
  const span = r.next_level_xp - r.level_start_xp

  const field = 'glass w-20 rounded-lg px-2 py-1 text-center outline-none focus:ring-2 focus:ring-accent'
  const goalsChanged = daily !== r.daily_goal || weekly !== r.weekly_goal
  const goalsValid = daily >= 1 && daily <= 100 && weekly >= 1 && weekly <= 700

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="glass spotlight space-y-3 rounded-2xl p-5 md:col-span-2">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-sm text-muted">Level</p>
            <p className="gradient-text text-5xl font-black"><AnimatedNumber value={r.level} /></p>
          </div>
          <p className="flex items-center gap-1 text-xl text-amber-400"><Coins size={20} /> <AnimatedNumber value={r.coins} /></p>
        </div>
        <Meter label="XP to next level" value={r.xp - r.level_start_xp} max={span} detail={`${(r.next_level_xp - r.xp).toLocaleString()} XP to go`} />
        <p className="text-xs text-muted">{r.xp.toLocaleString()} XP total</p>
      </div>

      <div className="glass space-y-3 rounded-2xl p-5">
        <h2 className="flex items-center gap-2 font-semibold"><Flame className={r.streak > 0 ? 'text-orange-400' : 'text-muted'} size={18} /> Streak</h2>
        <p className="text-4xl font-black">{r.streak} <span className="text-base font-normal text-muted">day{r.streak === 1 ? '' : 's'}</span></p>
        <p className="text-sm text-muted">
          {r.active_today ? 'Safe for today.' : r.streak > 0 ? 'Complete a todo today to keep it going.' : 'Complete a todo to start a streak.'} Best: {r.longest_streak}.
        </p>
        <div className="flex items-center gap-2 text-sm">
          <span className="flex items-center gap-1" aria-label={`${r.freezes} of 2 streak freezes`}>
            {[0, 1].map((i) => <Snowflake key={i} size={18} className={i < r.freezes ? 'text-accent-2' : 'text-muted/40'} />)}
          </span>
          <span className="text-muted">A freeze covers one missed day.</span>
        </div>
        <button
          disabled={buyFreeze.isPending || r.freezes >= 2 || r.coins < STREAK_FREEZE_COST}
          onClick={() => buyFreeze.mutate(undefined, { onSuccess: () => push('Streak freeze added'), onError: (e) => push(`Could not buy: ${e.message}`) })}
          className="glass flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm disabled:opacity-50"
        >
          <Snowflake size={14} /> Buy freeze · <Coins size={12} /> {STREAK_FREEZE_COST}
        </button>
      </div>

      <div className="glass space-y-3 rounded-2xl p-5">
        <h2 className="font-semibold">Goals</h2>
        <Meter label="Today" value={r.today_done} max={r.daily_goal} />
        <Meter label="This week" value={r.week_done} max={r.weekly_goal} />
        <form
          className="flex flex-wrap items-end gap-3 pt-1 text-sm"
          onSubmit={(e) => {
            e.preventDefault()
            if (goalsChanged && goalsValid) setGoals.mutate({ daily_goal: daily, weekly_goal: weekly }, { onSuccess: () => push('Goals updated'), onError: (err) => push(`Could not save: ${err.message}`) })
          }}
        >
          <label className="space-y-1 text-xs text-muted">Daily
            <input type="number" min={1} max={100} className={field} value={daily} onChange={(e) => setDaily(Number(e.target.value))} />
          </label>
          <label className="space-y-1 text-xs text-muted">Weekly
            <input type="number" min={1} max={700} className={field} value={weekly} onChange={(e) => setWeekly(Number(e.target.value))} />
          </label>
          <button disabled={!goalsChanged || !goalsValid || setGoals.isPending} className="rounded-lg bg-accent px-3 py-1.5 text-white disabled:opacity-50">Save</button>
        </form>
        <p className="text-xs text-muted">Hit your daily goal for +20 coins, your weekly goal for +100.</p>
      </div>

      <div className="glass space-y-3 rounded-2xl p-5 md:col-span-2">
        <Meter label="XP earned today" value={r.today_xp} max={r.daily_xp_cap} />
        <p className="text-xs text-muted">
          Each todo earns 10 XP plus bonuses for priority, finishing on time and completed subtasks. To keep rewards fair, XP is capped at
          {' '}{r.daily_xp_cap} a day, and todos finished within seconds of being created earn almost nothing. Days roll over at midnight in {r.timezone}.
        </p>
        <button onClick={() => setSound(!soundOn)} aria-pressed={soundOn} className="glass flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm">
          {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />} Sound effects {soundOn ? 'on' : 'off'}
        </button>
      </div>
    </div>
  )
}
