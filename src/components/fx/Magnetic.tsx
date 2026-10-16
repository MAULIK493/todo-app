import { motion, useMotionValue, useSpring } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { useEffectFlags } from '@/features/appearance/store'
import { magnetOffset } from './logic'

/** Leans its content toward the pointer when it gets close (Full effects, devices with a mouse). */
export function Magnetic({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const flags = useEffectFlags()
  const x = useSpring(useMotionValue(0), { stiffness: 220, damping: 18 })
  const y = useSpring(useMotionValue(0), { stiffness: 220, damping: 18 })

  useEffect(() => {
    if (!flags.tilt || !window.matchMedia('(hover: hover)').matches) { x.set(0); y.set(0); return }
    const move = (e: PointerEvent) => {
      const r = ref.current?.getBoundingClientRect()
      if (!r) return
      const o = magnetOffset(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2))
      x.set(o.x)
      y.set(o.y)
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => window.removeEventListener('pointermove', move)
  }, [flags.tilt, x, y])

  return <motion.div ref={ref} style={{ x, y }} className={className}>{children}</motion.div>
}
