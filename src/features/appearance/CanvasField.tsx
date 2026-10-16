import { useEffect, useRef } from 'react'
import { countFor, createStars, projectStar, stepStars, type Star } from './particles'

type Props = { density: number; running: boolean }

/**
 * The starfield: stars drift towards the viewer and respawn at the back. It draws a single still frame when `running`
 * is false (reduced effects, hidden tab), caps the device pixel ratio, and re-creates itself only when the size or
 * settings change.
 */
export function CanvasField({ density, running }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return // no canvas support: the plain background shows instead

    let raf = 0
    let w = 0
    let h = 0
    let stars: Star[] = []

    const setup = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const box = canvas.parentElement?.getBoundingClientRect()
      w = Math.max(1, Math.round(box?.width || window.innerWidth))
      h = Math.max(1, Math.round(box?.height || window.innerHeight))
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      stars = createStars(countFor(w, h, Math.max(density, 0.25), 160) * 2)
    }

    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (const s of stars) {
        const p = projectStar(s, w, h)
        ctx.fillStyle = `rgba(255,255,255,${p.a * 0.9})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    setup()
    draw()
    let last = performance.now()
    const frame = (t: number) => {
      const dt = (t - last) / 1000
      last = t
      stepStars(stars, dt)
      draw()
      raf = requestAnimationFrame(frame)
    }
    if (running) raf = requestAnimationFrame(frame)

    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const onResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { setup(); draw() }, 150) }
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(raf); clearTimeout(resizeTimer); window.removeEventListener('resize', onResize) }
  }, [density, running])

  return <canvas ref={ref} className="absolute inset-0 size-full" aria-hidden />
}
