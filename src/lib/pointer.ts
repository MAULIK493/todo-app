// Remembers where the user last pressed or touched, so effects can start from the thing they just used
// (e.g. an XP chip that flies out of the checkbox that was ticked).

let last = { x: 0, y: 0, at: 0 }
let installed = false

export function trackPointer() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('pointerdown', (e) => { last = { x: e.clientX, y: e.clientY, at: performance.now() } }, { passive: true, capture: true })
}

/** The last pointer position, if it was pressed recently; otherwise the lower middle of the screen. */
export function lastPointer(maxAgeMs = 4000): { x: number; y: number } {
  const fresh = last.at > 0 && performance.now() - last.at < maxAgeMs
  return fresh ? { x: last.x, y: last.y } : { x: window.innerWidth / 2, y: window.innerHeight * 0.75 }
}
