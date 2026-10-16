import { Trophy } from 'lucide-react'
import { EmptyState } from '@/components/fx/EmptyState'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/dates'
import { useLedger } from './api'
import type { LedgerEntry } from './types'

function describe(e: LedgerEntry) {
  const m = e.meta
  switch (e.kind) {
    case 'complete': return `Completed "${m.title ?? 'a todo'}"`
    case 'subtask': return `Finished subtask "${m.title ?? ''}"`
    case 'daily_goal': return 'Daily goal reached'
    case 'weekly_goal': return 'Weekly goal reached'
    case 'achievement': return `Unlocked ${m.name ?? 'an achievement'}`
    case 'freeze_earned': return 'Earned a streak freeze'
    case 'freeze_used': return 'A streak freeze saved your streak'
    case 'redeem': return `Redeemed ${m.item ?? 'a reward'}`
    case 'purchase': return `Bought ${m.item ?? 'an item'}`
  }
}

function note(e: LedgerEntry) {
  if (e.meta.capped) return 'Daily XP cap reached'
  if (e.meta.fast) return 'Finished too quickly to earn full XP'
  if (e.kind === 'complete' && e.meta.on_time) return 'On time bonus'
  return null
}

export function ActivityTab() {
  const { data = [], isLoading, error } = useLedger()
  if (isLoading) return <div className="glass h-40 shimmer rounded-2xl" aria-busy />
  if (error) return <p className="text-red-400" role="alert">Could not load activity: {error.message}</p>
  if (!data.length) return <div className="glass rounded-2xl"><EmptyState icon={Trophy} title="Complete a todo to start earning." /></div>

  return (
    <ul className="space-y-1">
      {data.map((e) => (
        <li key={e.id} className="glass flex items-center gap-3 rounded-xl px-3 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate">{describe(e)}</p>
            <p className="text-xs text-muted">{timeAgo(e.created_at)}{note(e) ? ` · ${note(e)}` : ''}</p>
          </div>
          <div className="shrink-0 text-right text-sm">
            {e.xp > 0 && <p className="text-accent-2">+{e.xp} XP</p>}
            {e.coins !== 0 && <p className={cn(e.coins > 0 ? 'text-amber-400' : 'text-muted')}>{e.coins > 0 ? '+' : ''}{e.coins} coins</p>}
          </div>
        </li>
      ))}
    </ul>
  )
}
