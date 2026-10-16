import { AnimatePresence, motion } from 'motion/react'
import { spring } from '@/lib/motion'
import { useToasts } from '@/stores/toasts'

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id} layout initial={{ y: 30, opacity: 0, scale: 0.95 }} animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }} transition={spring}
            className="glass pointer-events-auto flex items-center gap-3 rounded-xl bg-surface-solid px-4 py-2 text-sm shadow-lg"
          >
            <span>{t.message}</span>
            {t.action && (
              <button className="font-medium text-accent" onClick={() => { t.action!.onClick(); dismiss(t.id) }}>
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
