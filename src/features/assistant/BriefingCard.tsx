import { Sunrise, Sunset } from 'lucide-react'
import { motion } from 'motion/react'
import { useAiPrefs, useBriefing } from './api'
import { RichText } from './RichTextView'

/** Morning before midday, evening after 5 pm, generated once per day and then cached. */
export function BriefingCard() {
  const { data: prefs } = useAiPrefs()
  const hour = new Date().getHours()
  const kind = hour >= 5 && hour < 12 ? 'morning' : hour >= 17 ? 'evening' : null
  const { data, isLoading, error } = useBriefing(kind, prefs?.briefing_enabled !== false)

  if (!kind || prefs?.briefing_enabled === false) return null
  const Icon = kind === 'morning' ? Sunrise : Sunset
  // A missing API key or a busy service should not put an error in the user's face before they've asked anything.
  if (error) return null
  // Nothing to show yet: no key added, or nothing cached for today.
  if (!isLoading && !data) return null

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} aria-label={kind === 'morning' ? 'Morning briefing' : 'Evening recap'} className="glass rounded-2xl p-3.5">
      <h2 className="mb-1.5 flex items-center gap-2 text-sm font-semibold"><Icon size={16} className="text-amber-400" aria-hidden /> {kind === 'morning' ? 'Your morning briefing' : 'Your evening recap'}</h2>
      {isLoading ? (
        <div className="space-y-2" aria-busy aria-label="Writing your briefing">{[90, 75, 60].map((w) => <div key={w} className="h-3 shimmer rounded bg-white/10" style={{ width: `${w}%` }} />)}</div>
      ) : data ? <RichText text={data} /> : null}
    </motion.section>
  )
}
