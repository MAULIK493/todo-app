import { create } from 'zustand'
import { getFlags } from '@/features/appearance/store'

/** Confetti, from `origin` (fractions of the screen) when given. Skipped when the effects level or reduced motion says no. */
export function burst(size: 'small' | 'big', origin: { x: number; y: number } = { x: 0.5, y: 0.75 }) {
  if (!getFlags().confetti) return
  // Loaded the first time it is needed, not with the app.
  void import('canvas-confetti').then(({ default: confetti }) => confetti({
    particleCount: size === 'big' ? 160 : 36,
    spread: size === 'big' ? 110 : 55,
    startVelocity: size === 'big' ? 45 : 30,
    origin,
    disableForReducedMotion: true,
  })).catch(() => undefined)
}

// ---- sound: tiny synthesized chimes, off by default, no audio files ----
const SOUND_KEY = 'sound'
const readSound = () => {
  try { return localStorage.getItem(SOUND_KEY) === 'on' } catch { return false }
}

let ctx: AudioContext | null = null

export function chime(kind: 'xp' | 'level') {
  if (!readSound()) return
  try {
    ctx ??= new AudioContext()
    const notes = kind === 'level' ? [523, 659, 784, 1047] : [660, 880]
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator()
      const gain = ctx!.createGain()
      const t = ctx!.currentTime + i * 0.09
      osc.frequency.value = freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
      osc.connect(gain).connect(ctx!.destination)
      osc.start(t)
      osc.stop(t + 0.4)
    })
  } catch { /* audio unavailable (autoplay policy, no device) */ }
}

// ---- full-screen celebrations queue ----
export type Celebration =
  | { id: number; type: 'level'; level: number }
  | { id: number; type: 'achievement'; name: string; description: string; icon: string; xp: number; coins: number }

type Distribute<T> = T extends unknown ? Omit<T, 'id'> : never

type CelebrationState = {
  queue: Celebration[]
  soundOn: boolean
  push: (c: Distribute<Celebration>) => void
  dismiss: (id: number) => void
  setSound: (on: boolean) => void
}

let nextId = 1

export const useCelebrations = create<CelebrationState>((set) => ({
  queue: [],
  soundOn: readSound(),
  push: (c) => set((s) => ({ queue: [...s.queue, { ...c, id: nextId++ } as Celebration] })),
  dismiss: (id) => set((s) => ({ queue: s.queue.filter((c) => c.id !== id) })),
  setSound: (on) => {
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off') } catch { /* ignore */ }
    set({ soundOn: on })
  },
}))
