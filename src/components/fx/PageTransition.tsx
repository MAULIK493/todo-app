import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { useEffectFlags } from '@/features/appearance/store'

/** Fades (and slides slightly, at Full) between screens. With effects off it renders the page directly. */
export function PageTransition({ routeKey, children }: { routeKey: string; children: ReactNode }) {
  const flags = useEffectFlags()
  if (!flags.pageTransitions) return <>{children}</>
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={routeKey} className="h-full"
        initial={{ opacity: 0, y: flags.slide ? 10 : 0 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: flags.slide ? -6 : 0 }}
        transition={{ duration: 0.18 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}
