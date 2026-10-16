import { describe, expect, it } from 'vitest'
import { detectEnv, effectiveLevel, flagsFor, type Env } from './effects'
import { countFor, createParticles, createStars, projectStar, stepParticles, stepStars } from './particles'

describe('effects levels', () => {
  const calm: Env = { reducedMotion: false, lowEnd: false, saveData: false, lowBattery: false }

  it('the device can lower the level but never raise it', () => {
    expect(effectiveLevel('full', calm)).toBe('full')
    expect(effectiveLevel('full', { ...calm, reducedMotion: true })).toBe('minimal')
    expect(effectiveLevel('balanced', { ...calm, reducedMotion: true })).toBe('minimal')
    expect(effectiveLevel('off', { ...calm, reducedMotion: true })).toBe('off')
    expect(effectiveLevel('full', { ...calm, lowEnd: true })).toBe('balanced')
    expect(effectiveLevel('minimal', { ...calm, lowEnd: true })).toBe('minimal')
    expect(effectiveLevel('full', { ...calm, saveData: true, lowBattery: true })).toBe('balanced')
  })

  it('maps each level to what may animate', () => {
    expect(flagsFor('full')).toMatchObject({ animatedBackground: true, confetti: true, parallax: true, spotlight: true, tilt: true, slide: true, density: 1 })
    expect(flagsFor('balanced')).toMatchObject({ animatedBackground: true, confetti: true, parallax: false, spotlight: false, tilt: false, density: 0.5 })
    expect(flagsFor('minimal')).toMatchObject({ animatedBackground: false, confetti: false, flourishes: false, pageTransitions: true, slide: false, springs: false })
    expect(flagsFor('off')).toMatchObject({ animatedBackground: false, pageTransitions: false, springs: false, density: 0 })
  })

  it('reads device hints defensively', () => {
    const mm = (m: boolean) => () => ({ matches: m })
    expect(detectEnv({ matchMedia: mm(true) }).reducedMotion).toBe(true)
    expect(detectEnv({ navigator: { hardwareConcurrency: 2 } }).lowEnd).toBe(true)
    expect(detectEnv({ navigator: { hardwareConcurrency: 8, deviceMemory: 1 } }).lowEnd).toBe(true)
    expect(detectEnv({ navigator: { hardwareConcurrency: 8, deviceMemory: 8 } }).lowEnd).toBe(false)
    expect(detectEnv({ navigator: { connection: { saveData: true } } }).saveData).toBe(true)
    expect(detectEnv({}, { level: 0.1, charging: false }).lowBattery).toBe(true)
    expect(detectEnv({}, { level: 0.1, charging: true }).lowBattery).toBe(false)
    expect(detectEnv({})).toEqual({ reducedMotion: false, lowEnd: false, saveData: false, lowBattery: false })
  })
})

describe('particles', () => {
  const rng = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647) })()

  it('scales the count with screen size and effects level, within limits', () => {
    expect(countFor(1920, 1080, 0)).toBe(0)
    expect(countFor(1920, 1080, 1)).toBeGreaterThan(countFor(1920, 1080, 0.5))
    expect(countFor(300, 300, 1)).toBeGreaterThanOrEqual(8)
    expect(countFor(8000, 8000, 1)).toBeLessThanOrEqual(160)
  })

  it('keeps particles on screen by wrapping, and ignores huge time steps', () => {
    const ps = createParticles(50, 400, 300, rng)
    ps.forEach((p) => { p.vx = 5000; p.vy = -5000 })
    stepParticles(ps, 10, 400, 300)
    for (const p of ps) { expect(p.x).toBeGreaterThanOrEqual(0); expect(p.x).toBeLessThan(400); expect(p.y).toBeGreaterThanOrEqual(0); expect(p.y).toBeLessThan(300) }
    const slow = createParticles(1, 400, 300, rng)
    const before = slow[0].x
    slow[0].vx = 100
    stepParticles(slow, 99, 400, 300) // capped to a 0.05s step
    expect(Math.abs((((slow[0].x - before) % 400) + 400) % 400)).toBeLessThanOrEqual(5.01)
  })

  it('stars approach the viewer and respawn at the back', () => {
    const stars = createStars(30, rng)
    stars[0].z = 0.999
    stepStars(stars, 0.05, 5, rng)
    expect(stars[0].z).toBe(0)
    for (let i = 0; i < 400; i++) stepStars(stars, 0.016, 0.5, rng)
    expect(stars.every((s) => s.z >= 0 && s.z < 1)).toBe(true)
    const near = projectStar({ x: 0.5, y: 0.5, z: 0.9 }, 800, 600)
    const far = projectStar({ x: 0.5, y: 0.5, z: 0.1 }, 800, 600)
    expect(near.r).toBeGreaterThan(far.r)
    expect(near.a).toBeGreaterThan(far.a)
  })
})
