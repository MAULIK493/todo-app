import { Check, Trash2 } from 'lucide-react'
import { motion, useDragControls, useMotionValue, useTransform } from 'motion/react'
import { useSyncExternalStore, type ReactNode } from 'react'
import { SWIPE_DISTANCE, swipeIntent } from './logic'

const query = '(pointer: coarse)'
/** True on touch screens, where there is no hover and swiping is the natural gesture. */
export function useCoarsePointer() {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

type Props = { enabled: boolean; onComplete: () => void; onDelete: () => void; children: ReactNode }

/**
 * Touch gesture around a list row: swipe right to complete, left to delete. Vertical scrolling is untouched, and
 * the drag handle used for reordering keeps working because it stops its press from reaching this wrapper.
 */
export function SwipeRow({ enabled, onComplete, onDelete, children }: Props) {
  const x = useMotionValue(0)
  const controls = useDragControls()
  const doneOpacity = useTransform(x, [0, SWIPE_DISTANCE * 0.6, SWIPE_DISTANCE], [0, 0.5, 1])
  const deleteOpacity = useTransform(x, [-SWIPE_DISTANCE, -SWIPE_DISTANCE * 0.6, 0], [1, 0.5, 0])
  if (!enabled) return <>{children}</>

  return (
    <div className="relative overflow-hidden" data-testid="swipe-row">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-5" aria-hidden>
        <motion.span style={{ opacity: doneOpacity }} className="flex items-center gap-2 text-sm font-medium text-green-400"><Check size={20} /> Done</motion.span>
        <motion.span style={{ opacity: deleteOpacity }} className="flex items-center gap-2 text-sm font-medium text-red-400">Delete <Trash2 size={20} /></motion.span>
      </div>
      <motion.div
        drag="x" dragListener={false} dragControls={controls} dragDirectionLock dragConstraints={{ left: 0, right: 0 }} dragElastic={0.45}
        style={{ x, touchAction: 'pan-y' }} onPointerDown={(e) => controls.start(e)}
        onDragEnd={(_, info) => {
          const intent = swipeIntent(info.offset.x, info.velocity.x)
          if (intent === 'complete') onComplete()
          else if (intent === 'delete') onDelete()
        }}
      >
        {children}
      </motion.div>
    </div>
  )
}
