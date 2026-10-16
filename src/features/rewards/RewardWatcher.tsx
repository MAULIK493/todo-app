import { useEffect, useRef } from 'react'
import { useToasts } from '@/stores/toasts'
import { useAchievementCatalog, useRewardMutations, useRewardSummary } from './api'
import { burst, chime, useCelebrations } from './celebrate'
import { describeGain, diffSummaries } from './events'
import { spawnXpFlyer } from './flyers'
import type { RewardSummary } from './types'

/**
 * Renders nothing. Watches the server-calculated reward summary and turns changes into feedback
 * (toast, confetti, sound, level-up and achievement screens). Also keeps the user's timezone in sync,
 * since streaks and goals roll over at the user's local midnight.
 */
export function RewardWatcher() {
  const { data } = useRewardSummary()
  const { data: catalog } = useAchievementCatalog()
  const { setTimezone } = useRewardMutations()
  const push = useToasts((s) => s.push)
  const celebrate = useCelebrations((s) => s.push)
  const prev = useRef<RewardSummary | null>(null)
  const tzSynced = useRef(false)
  const catalogRef = useRef(catalog)
  useEffect(() => { catalogRef.current = catalog })

  useEffect(() => {
    if (!data) return
    const before = prev.current
    prev.current = data

    if (!tzSynced.current) {
      tzSynced.current = true
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (tz && tz !== data.timezone) setTimezone.mutate(tz)
    }

    if (!before) return // first load: nothing to celebrate
    const events = diffSummaries(before, data)
    if (!events) return

    if (events.xp > 0) {
      push(describeGain(events))
      spawnXpFlyer(`+${events.xp} XP`)
    }
    burst(events.leveledUpTo ? 'big' : 'small')
    chime(events.leveledUpTo ? 'level' : 'xp')
    if (events.leveledUpTo) celebrate({ type: 'level', level: events.leveledUpTo })
    for (const code of events.newAchievements) {
      const a = catalogRef.current?.find((c) => c.code === code)
      if (a) celebrate({ type: 'achievement', name: a.name, description: a.description, icon: a.icon, xp: a.xp_reward, coins: a.coin_reward })
    }
  }, [data, push, celebrate, setTimezone])

  return null
}
