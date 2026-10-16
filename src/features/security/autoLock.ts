import { useEffect } from 'react'
import { useVault } from './vault'

/** Device-level preferences (kept in localStorage; they don't need to follow the user around). */
export type AutoLockSettings = { idleMinutes: number; lockOnHide: boolean }

const KEY = 'auto-lock'
const DEFAULTS: AutoLockSettings = { idleMinutes: 5, lockOnHide: true }
export const IDLE_CHOICES = [1, 5, 15, 30, 0] as const // 0 = never
const HIDE_GRACE_MS = 15_000

export function readAutoLock(): AutoLockSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AutoLockSettings> | null
    if (raw && (IDLE_CHOICES as readonly number[]).includes(raw.idleMinutes as number) && typeof raw.lockOnHide === 'boolean') return raw as AutoLockSettings
  } catch { /* storage unavailable or corrupt */ }
  return DEFAULTS
}

export function writeAutoLock(s: AutoLockSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

/**
 * Decides whether keys should be dropped. Pure so it can be tested: `idleFor` is how long since the last
 * interaction, `hiddenFor` how long the tab has been in the background (null when visible).
 */
export function shouldLock(s: AutoLockSettings, idleFor: number, hiddenFor: number | null): boolean {
  if (s.idleMinutes > 0 && idleFor >= s.idleMinutes * 60_000) return true
  return s.lockOnHide && hiddenFor !== null && hiddenFor >= HIDE_GRACE_MS
}

/** Locks every open private workspace after inactivity or when the tab has been in the background. */
export function useAutoLock() {
  useEffect(() => {
    let lastActive = Date.now()
    let hiddenSince: number | null = document.visibilityState === 'hidden' ? Date.now() : null

    const touch = () => { lastActive = Date.now() }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenSince = Date.now()
      else { hiddenSince = null; lastActive = Date.now() }
    }
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)

    // Polling (rather than one long timer) survives sleep/suspend: the check uses real elapsed time.
    const timer = setInterval(() => {
      if (Object.keys(useVault.getState().keys).length === 0) return
      const now = Date.now()
      if (shouldLock(readAutoLock(), now - lastActive, hiddenSince === null ? null : now - hiddenSince)) useVault.getState().lockAll()
    }, 5_000)

    return () => {
      events.forEach((e) => window.removeEventListener(e, touch))
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(timer)
    }
  }, [])
}
