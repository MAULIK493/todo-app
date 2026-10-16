import type { LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffectFlags } from '@/features/appearance/store'

/** A friendly empty screen with a gently floating icon (still when effects are reduced). */
export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  const flags = useEffectFlags()
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center" role="status">
      <motion.div
        animate={flags.flourishes ? { y: [0, -8, 0], rotate: [0, -4, 4, 0] } : undefined}
        transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
        className="grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-accent/25 to-accent-2/25 text-accent"
      >
        <Icon size={30} aria-hidden />
      </motion.div>
      <p className="text-muted">{title}</p>
      {children}
    </div>
  )
}
