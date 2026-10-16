import { useEffect } from 'react'
import { useEffectFlags } from '@/features/appearance/store'

/** Moves the glow on `.spotlight` panels to follow the cursor (Full effects, pointer devices). One listener for the whole page. */
export function useSpotlight() {
  const on = useEffectFlags().spotlight
  useEffect(() => {
    if (!on || !window.matchMedia('(hover: hover)').matches) return
    let raf = 0
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const panel = (e.target as Element | null)?.closest?.<HTMLElement>('.spotlight')
        if (!panel) return
        const r = panel.getBoundingClientRect()
        panel.style.setProperty('--mx', `${e.clientX - r.left}px`)
        panel.style.setProperty('--my', `${e.clientY - r.top}px`)
      })
    }
    window.addEventListener('pointermove', move, { passive: true })
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', move) }
  }, [on])
}
