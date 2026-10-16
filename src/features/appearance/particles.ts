// Small, dependency-free particle maths for the animated backgrounds. The canvas code only draws what these produce.

export type Rng = () => number

export type Particle = { x: number; y: number; vx: number; vy: number; r: number; a: number }
export type Star = { x: number; y: number; z: number } // z: depth, 0 (far) to 1 (near)

/** How many particles to draw: grows with screen area, scaled by the effects level, with hard limits. */
export function countFor(width: number, height: number, density: number, perMegapixel = 90, max = 160): number {
  if (density <= 0) return 0
  return Math.min(max, Math.max(8, Math.round(((width * height) / 1_000_000) * perMegapixel * density)))
}

export function createParticles(n: number, w: number, h: number, rng: Rng = Math.random): Particle[] {
  return Array.from({ length: n }, () => ({
    x: rng() * w, y: rng() * h, vx: (rng() - 0.5) * 18, vy: (rng() - 0.5) * 18, r: 1 + rng() * 2.2, a: 0.25 + rng() * 0.5,
  }))
}

/** Advance by `dt` seconds; particles that leave one edge re-enter on the opposite one. */
export function stepParticles(ps: Particle[], dt: number, w: number, h: number) {
  const step = Math.min(dt, 0.05) // a long pause (tab in the background) must not fling everything across the screen
  for (const p of ps) {
    p.x = (((p.x + p.vx * step) % w) + w) % w
    p.y = (((p.y + p.vy * step) % h) + h) % h
  }
}

export function createStars(n: number, rng: Rng = Math.random): Star[] {
  return Array.from({ length: n }, () => ({ x: rng() * 2 - 1, y: rng() * 2 - 1, z: rng() }))
}

/** Stars drift toward the viewer and respawn at the back when they pass it. */
export function stepStars(stars: Star[], dt: number, speed = 0.06, rng: Rng = Math.random) {
  const step = Math.min(dt, 0.05)
  for (const s of stars) {
    s.z += speed * step * (0.4 + s.z)
    if (s.z >= 1) { s.z = 0; s.x = rng() * 2 - 1; s.y = rng() * 2 - 1 }
  }
}

/** Screen position and size of a star for a w x h canvas. */
export function projectStar(s: Star, w: number, h: number) {
  const scale = 0.35 + s.z * 0.9
  return { x: w / 2 + s.x * (w / 2) * scale, y: h / 2 + s.y * (h / 2) * scale, r: 0.4 + s.z * 1.6, a: 0.25 + s.z * 0.75 }
}
