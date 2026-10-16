import { useSyncExternalStore } from 'react'

/** Whether a CSS media query currently matches, updating live. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => { const m = window.matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
