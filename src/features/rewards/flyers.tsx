import { AnimatePresence, motion } from 'motion/react'
import { create } from 'zustand'
import { getFlags } from '@/features/appearance/store'
import { lastPointer } from '@/lib/pointer'

type Flyer = { id: number; from: { x: number; y: number }; text: string }

const useFlyers = create<{ items: Flyer[]; remove: (id: number) => void }>((set) => ({ items: [], remove: (id) => set((s) => ({ items: s.items.filter((f) => f.id !== id) })) }))
let nextId = 1

/** A small "+15 XP" chip that rises from where the user just pressed and flies into the level badge. */
export function spawnXpFlyer(text: string) {
  if (!getFlags().flourishes) return
  const id = nextId++
  useFlyers.setState((s) => ({ items: [...s.items.slice(-4), { id, from: lastPointer(), text }] }))
}

const target = () => {
  const el = document.querySelector('[data-xp-target]')?.getBoundingClientRect()
  return el ? { x: el.left + el.width / 2, y: el.top + el.height / 2 } : { x: 60, y: 60 }
}

export function FlyerHost() {
  const items = useFlyers((s) => s.items)
  const remove = useFlyers((s) => s.remove)
  return (
    <div className="pointer-events-none fixed inset-0 z-[55]" aria-hidden>
      <AnimatePresence>
        {items.map((f) => {
          const to = target()
          return (
            <motion.span
              key={f.id}
              className="absolute rounded-full bg-accent px-2.5 py-1 text-xs font-bold text-white shadow-lg"
              style={{ left: 0, top: 0 }}
              initial={{ x: f.from.x - 24, y: f.from.y - 10, opacity: 0, scale: 0.6 }}
              // rise first so it reads as coming out of the thing that was ticked, then fly to the badge
              animate={{ x: [f.from.x - 24, f.from.x - 24, to.x - 20], y: [f.from.y - 10, f.from.y - 56, to.y - 10], opacity: [0, 1, 1, 0], scale: [0.6, 1.15, 1, 0.5] }}
              transition={{ duration: 1.1, times: [0, 0.35, 1], ease: 'easeInOut' }}
              onAnimationComplete={() => remove(f.id)}
            >
              {f.text}
            </motion.span>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
