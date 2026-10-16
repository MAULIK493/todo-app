import { motion } from 'motion/react'
import { cn } from '@/lib/cn'

export function AnimatedCheck({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <motion.button
      type="button" role="checkbox" aria-checked={checked} aria-label={label} whileTap={{ scale: 0.8 }}
      onClick={(e) => { e.stopPropagation(); onChange() }}
      className={cn(
        'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors',
        checked ? 'border-accent bg-accent' : 'border-muted hover:border-accent',
      )}
    >
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="white" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
        <motion.path d="M5 12.5l4.5 4.5L19 7" initial={false} animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }} transition={{ duration: 0.25 }} />
      </svg>
    </motion.button>
  )
}
