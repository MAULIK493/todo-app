import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { spring } from '@/lib/motion'

const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'

type Props = { title: string; onClose: () => void; children: ReactNode; dismissible?: boolean; className?: string }

/** Accessible dialog: labelled, Esc and backdrop close it (unless not dismissible), focus moves in and is restored. */
export function Modal({ title, onClose, children, dismissible = true, className }: Props) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    return () => previous?.focus?.()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) { onClose(); return }
      if (e.key !== 'Tab' || !panel.current) return
      // Keep Tab inside the dialog: wrap from the last control to the first and back.
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('disabled'))
      if (items.length === 0) { e.preventDefault(); panel.current.focus(); return }
      const first = items[0], last = items[items.length - 1], active = document.activeElement
      if (e.shiftKey && (active === first || active === panel.current)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (active === last || !panel.current.contains(active))) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dismissible, onClose])

  return (
    <motion.div
      className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-black/60 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onMouseDown={(e) => { if (dismissible && e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        initial={{ scale: 0.95, y: 12, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} transition={spring}
        className={cn('glass w-full max-w-md rounded-2xl bg-surface-solid p-6 outline-none', className)}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-lg font-semibold">{title}</h2>
          {dismissible && <button aria-label="Close" onClick={onClose} className="rounded-lg p-1 hover:bg-white/10 min-h-6 min-w-6"><X size={18} /></button>}
        </div>
        {children}
      </motion.div>
    </motion.div>
  )
}
