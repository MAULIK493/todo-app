import { motion } from 'motion/react'
import { useEffectFlags } from '@/features/appearance/store'

export type OrbState = 'idle' | 'thinking' | 'listening' | 'speaking'

/** What the assistant is doing, for the orb. Listening wins over speaking, which wins over thinking. */
export function orbState(o: { busy: boolean; listening: boolean; speaking: boolean }): OrbState {
  return o.listening ? 'listening' : o.speaking ? 'speaking' : o.busy ? 'thinking' : 'idle'
}

const LABEL: Record<OrbState, string> = { idle: 'ready', thinking: 'thinking', listening: 'listening', speaking: 'speaking' }

/** The assistant's avatar: breathes when idle, spins while thinking, pulses with your voice, and ripples as it speaks. */
export function AssistantOrb({ state, level = 0 }: { state: OrbState; level?: number }) {
  const flags = useEffectFlags()
  const live = flags.flourishes
  const pulse = 1 + Math.min(level * 5, 0.35)

  const core =
    !live ? {} :
    state === 'thinking' ? { rotate: 360, scale: 1.05 } :
    state === 'listening' ? { scale: level > 0 ? pulse : [1, 1.18, 1] } :
    state === 'speaking' ? { scale: [1, 1.14, 0.96, 1.1, 1] } :
    { scale: [1, 1.06, 1] }
  const transition =
    state === 'thinking' ? { rotate: { repeat: Infinity, duration: 1.4, ease: 'linear' as const } } :
    state === 'listening' && level > 0 ? { type: 'spring' as const, stiffness: 300, damping: 15 } :
    { repeat: Infinity, duration: state === 'speaking' ? 0.8 : state === 'listening' ? 0.9 : 3.2, ease: 'easeInOut' as const }

  return (
    <span role="img" aria-label={`Assistant is ${LABEL[state]}`} className="relative grid size-8 shrink-0 place-items-center">
      {live && (state === 'listening' || state === 'speaking') && (
        <motion.span
          aria-hidden className="absolute inset-0 rounded-full border-2" style={{ borderColor: state === 'listening' ? '#ef4444' : 'var(--accent-2)' }}
          animate={{ scale: [1, 1.9], opacity: [0.6, 0] }} transition={{ repeat: Infinity, duration: 1.2, ease: 'easeOut' }}
        />
      )}
      <motion.span
        aria-hidden animate={core} transition={transition} data-state={state}
        className="size-6 rounded-full shadow-[0_0_14px_var(--accent)]"
        style={{ background: state === 'listening' ? 'conic-gradient(from 0deg, #ef4444, #f97316, #ef4444)' : 'conic-gradient(from 0deg, var(--accent), var(--accent-2), var(--accent))' }}
      />
    </span>
  )
}
