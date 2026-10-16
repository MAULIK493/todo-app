import type { Transition, Variants } from 'motion/react'

// Shared springs and variants so every feature animates consistently.
export const spring: Transition = { type: 'spring', stiffness: 380, damping: 30 }
export const softSpring: Transition = { type: 'spring', stiffness: 200, damping: 24 }

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: softSpring },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
}

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
}
