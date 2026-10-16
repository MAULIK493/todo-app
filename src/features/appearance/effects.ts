// How much motion to use. The user picks a level; the device can only lower it (reduced motion, weak hardware...).

export type EffectsLevel = 'full' | 'balanced' | 'minimal' | 'off'
export const EFFECT_LEVELS: EffectsLevel[] = ['full', 'balanced', 'minimal', 'off']

export type Env = { reducedMotion: boolean; lowEnd: boolean; saveData: boolean; lowBattery: boolean }

const ORDER: EffectsLevel[] = ['off', 'minimal', 'balanced', 'full']
const lower = (a: EffectsLevel, b: EffectsLevel) => ORDER[Math.min(ORDER.indexOf(a), ORDER.indexOf(b))]

/** The level actually used. */
export function effectiveLevel(chosen: EffectsLevel, env: Env): EffectsLevel {
  let level = chosen
  if (env.reducedMotion) level = lower(level, 'minimal') // reduced motion keeps simple fades, nothing travelling or looping
  if (env.lowEnd || env.saveData || env.lowBattery) level = lower(level, 'balanced')
  return level
}

export type EffectFlags = {
  level: EffectsLevel
  /** Looping backgrounds: starfield, particles, waves, video. */
  animatedBackground: boolean
  /** Multiplier for how many particles to draw. */
  density: number
  confetti: boolean
  /** Things that fly or celebrate: XP chips, completion sweeps. */
  flourishes: boolean
  parallax: boolean
  spotlight: boolean
  tilt: boolean
  /** Screen changes fade (or slide when full). */
  pageTransitions: boolean
  slide: boolean
  /** Spring physics vs. instant changes. */
  springs: boolean
}

export function flagsFor(level: EffectsLevel): EffectFlags {
  const on = level === 'full' || level === 'balanced'
  return {
    level,
    animatedBackground: on,
    density: level === 'full' ? 1 : level === 'balanced' ? 0.5 : 0,
    confetti: on,
    flourishes: on,
    parallax: level === 'full',
    spotlight: level === 'full',
    tilt: level === 'full',
    pageTransitions: level !== 'off',
    slide: on,
    springs: on,
  }
}

type NavLike = { hardwareConcurrency?: number; deviceMemory?: number; connection?: { saveData?: boolean } }

/** Reads the device's hints. Pass `battery` when known (Chrome only). */
export function detectEnv(win: { matchMedia?: (q: string) => { matches: boolean }; navigator?: NavLike }, battery?: { level: number; charging: boolean }): Env {
  const nav = win.navigator ?? {}
  return {
    reducedMotion: !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    lowEnd: (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 2) || (nav.deviceMemory !== undefined && nav.deviceMemory <= 2),
    saveData: !!nav.connection?.saveData,
    lowBattery: !!battery && !battery.charging && battery.level <= 0.2,
  }
}
