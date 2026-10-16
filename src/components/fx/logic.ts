// The decisions behind the motion effects, kept separate from the components so they can be tested directly.

export const SWIPE_DISTANCE = 96
export const SWIPE_VELOCITY = 600

export type SwipeIntent = 'complete' | 'delete' | null

/** Swipe right to complete, left to delete: far enough, or a quick flick that has started to move. */
export function swipeIntent(offsetX: number, velocityX: number): SwipeIntent {
  if (offsetX >= SWIPE_DISTANCE || (offsetX > 40 && velocityX >= SWIPE_VELOCITY)) return 'complete'
  if (offsetX <= -SWIPE_DISTANCE || (offsetX < -40 && velocityX <= -SWIPE_VELOCITY)) return 'delete'
  return null
}

/** How far a magnetic button leans toward the pointer: nothing outside the radius, a fraction of the gap inside it. */
export function magnetOffset(dx: number, dy: number, radius = 90, strength = 0.3): { x: number; y: number } {
  const dist = Math.hypot(dx, dy)
  if (dist === 0 || dist > radius) return { x: 0, y: 0 }
  return { x: dx * strength, y: dy * strength }
}

/**
 * The part of the address that identifies a screen for page transitions. Moving between notes inside the
 * notes screen is not a page change, so it must not replay the transition.
 */
export function routeKey(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean)
  return `/${parts.slice(0, 3).join('/')}`
}
