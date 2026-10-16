import { motion } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

type Props = { onComplete: (nodes: number[]) => void; disabled?: boolean; shakeKey?: number; submitLabel?: string }

const SIZE = 300
const CENTER = [50, 150, 250]
const HIT_RADIUS = 38
const at = (i: number) => ({ x: CENTER[i % 3], y: CENTER[Math.floor(i / 3)] })

/**
 * 3x3 pattern lock. Draw with a finger or mouse; the pattern is submitted when you lift off.
 * Keyboard users focus a dot and press Enter/Space to add it, then choose "Done".
 */
export function PatternGrid({ onComplete, disabled, shakeKey = 0, submitLabel = 'Done' }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const [path, setPath] = useState<number[]>([])
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef(false)

  // Clear the drawn pattern shortly after it is submitted (or after a wrong attempt).
  useEffect(() => {
    if (!shakeKey) return
    const t = setTimeout(() => setPath([]), 450)
    return () => clearTimeout(t)
  }, [shakeKey])

  const locate = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) * SIZE) / r.width, y: ((e.clientY - r.top) * SIZE) / r.height }
  }

  const touch = (p: { x: number; y: number }) => {
    for (let i = 0; i < 9; i++) {
      const n = at(i)
      if (Math.hypot(n.x - p.x, n.y - p.y) < HIT_RADIUS) {
        setPath((cur) => (cur.includes(i) ? cur : [...cur, i]))
        return
      }
    }
  }

  const down = (e: PointerEvent) => {
    if (disabled) return
    svg.current!.setPointerCapture(e.pointerId)
    dragging.current = true
    setPath([])
    const p = locate(e)
    setPointer(p)
    touch(p)
  }
  const move = (e: PointerEvent) => {
    if (!dragging.current) return
    const p = locate(e)
    setPointer(p)
    touch(p)
  }
  const up = () => {
    if (!dragging.current) return
    dragging.current = false
    setPointer(null)
    setPath((cur) => {
      if (cur.length) queueMicrotask(() => onComplete(cur))
      return cur
    })
  }

  const keyAdd = (i: number) => (e: KeyboardEvent) => {
    if (disabled || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    setPath((cur) => (cur.includes(i) ? cur : [...cur, i]))
  }

  const points = path.map(at)
  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ')
  const last = points[points.length - 1]

  return (
    <div className="mx-auto w-full max-w-64 space-y-3">
      <motion.div key={shakeKey} animate={shakeKey ? { x: [0, -10, 10, -8, 8, 0] } : {}} transition={{ duration: 0.4 }} className="relative">
        <svg
          ref={svg} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Pattern grid: drag across the dots"
          className="glass aspect-square w-full touch-none select-none rounded-2xl"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        >
          <defs><filter id="pattern-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" /></filter></defs>
          {points.length > 1 && <polyline points={polyline} fill="none" stroke="var(--accent-2)" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} filter="url(#pattern-glow)" data-testid="pattern-glow" />}
          {points.length > 1 && <polyline points={polyline} fill="none" stroke="var(--accent)" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />}
          {last && pointer && <line x1={last.x} y1={last.y} x2={pointer.x} y2={pointer.y} stroke="var(--accent-2)" strokeWidth={4} strokeLinecap="round" opacity={0.6} />}
          {Array.from({ length: 9 }, (_, i) => {
            const n = at(i)
            const active = path.includes(i)
            return (
              <g key={i}>
                {active && <motion.circle cx={n.x} cy={n.y} r={26} fill="var(--accent)" opacity={0.25} initial={{ scale: 0 }} animate={{ scale: 1 }} style={{ transformOrigin: `${n.x}px ${n.y}px` }} />}
                <motion.circle
                  cx={n.x} cy={n.y} animate={{ r: active ? 14 : 9 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  fill={active ? 'var(--accent)' : 'var(--muted)'}
                />
              </g>
            )
          })}
        </svg>
        {/* Keyboard access: nine focusable dots laid over the drawing surface (ignored by the pointer). */}
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }, (_, i) => (
            <button
              key={i} type="button" aria-label={`Dot ${i + 1}${path.includes(i) ? ', selected' : ''}`} aria-pressed={path.includes(i)}
              onKeyDown={keyAdd(i)} disabled={disabled}
              className="m-3 rounded-full opacity-0 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent"
            />
          ))}
        </div>
      </motion.div>
      <div className="flex gap-2">
        <button type="button" onClick={() => setPath([])} disabled={disabled || !path.length} className="glass flex-1 rounded-xl py-2 text-sm disabled:opacity-50">Clear</button>
        <button
          type="button" onClick={() => { if (path.length) onComplete(path) }} disabled={disabled || !path.length}
          className="flex-1 rounded-xl bg-accent py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
      <p className="text-center text-xs text-muted">{path.length ? `${path.length} dot${path.length === 1 ? '' : 's'}` : 'Drag across the dots'}</p>
    </div>
  )
}
