import { useMemo } from 'react'
import { create } from 'zustand'
import { effectiveLevel, flagsFor, detectEnv, type EffectFlags, type EffectsLevel, type Env } from './effects'

// The app has one look: a dark starfield. The only thing that varies is how much may animate, which the device
// decides (reduced motion, low battery, data saver, weak hardware) rather than the person.

type State = {
  effects: EffectsLevel
  /** Hints from the device; the level can only be lowered by them. */
  env: Env
  setEffects: (e: EffectsLevel) => void
  setEnv: (e: Env) => void
}

const initialEnv: Env = typeof window === 'undefined'
  ? { reducedMotion: false, lowEnd: false, saveData: false, lowBattery: false }
  : detectEnv(window as unknown as Parameters<typeof detectEnv>[0])

export const useAppearance = create<State>((set) => ({
  effects: 'full',
  env: initialEnv,
  setEffects: (effects) => set({ effects }),
  setEnv: (env) => set({ env }),
}))

/** What may animate right now. */
export const selectFlags = (s: Pick<State, 'effects' | 'env'>): EffectFlags => flagsFor(effectiveLevel(s.effects, s.env))
export const getFlags = () => selectFlags(useAppearance.getState())

/** Component hook; re-renders when the level changes. */
export function useEffectFlags(): EffectFlags {
  const effects = useAppearance((s) => s.effects)
  const env = useAppearance((s) => s.env)
  const level = effectiveLevel(effects, env)
  // Same object between renders unless the level changes, so it is safe in effect dependency lists.
  return useMemo(() => flagsFor(level), [level])
}
