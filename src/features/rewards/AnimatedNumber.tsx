import { animate } from 'motion/react'
import { useEffect, useRef } from 'react'

/** Counts up/down to `value`. Writes straight to the DOM so it doesn't re-render every frame. */
export function AnimatedNumber({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const from = useRef(value)

  useEffect(() => {
    const controls = animate(from.current, value, {
      duration: 0.7,
      ease: 'easeOut',
      onUpdate: (v) => { if (ref.current) ref.current.textContent = Math.round(v).toLocaleString() },
    })
    from.current = value
    return () => controls.stop()
  }, [value])

  return <span ref={ref}>{value.toLocaleString()}</span>
}
