import type { LockType } from './crypto'

export const PIN_MIN = 6
export const PIN_MAX = 12
export const PATTERN_MIN = 6
export const PASSWORD_MIN = 8

/** A pattern is the ordered list of grid nodes touched (0-8, row-major on the 3x3 grid). */
export const encodePattern = (nodes: number[]) => nodes.join('-')

export const LOCK_LABELS: Record<LockType, string> = { pin: 'PIN', pattern: 'Pattern', password: 'Password' }
/** The code type as it reads mid-sentence ("PIN" stays capitalised). */
export const LOCK_NOUN: Record<LockType, string> = { pin: 'PIN', pattern: 'pattern', password: 'password' }

/**
 * Honest strength guidance. PINs and patterns have few possible values, so someone who copied the
 * encrypted data could try them all offline (the 600,000-round key stretching only slows that down).
 * A long password is the only choice that stays strong against that.
 */
export const STRENGTH_NOTE: Record<LockType, string> = {
  pin: 'Good against someone using your device. A PIN has few combinations, so it is weak if the encrypted data itself is stolen.',
  pattern: 'Quick to draw and good against someone using your device. Like a PIN, it has few combinations.',
  password: 'The strongest option. A long, unique password protects your data even if the encrypted data is stolen.',
}

/** Returns a reason the code is unacceptable, or null if it is fine. */
export function validateSecret(type: LockType, secret: string): string | null {
  if (type === 'pin') {
    if (!/^\d+$/.test(secret)) return 'A PIN can only contain digits.'
    if (secret.length < PIN_MIN) return `Use at least ${PIN_MIN} digits.`
    if (secret.length > PIN_MAX) return `Use at most ${PIN_MAX} digits.`
    if (/^(\d)\1+$/.test(secret)) return 'That PIN is too easy to guess (one repeated digit).'
    if ('0123456789'.includes(secret) || '9876543210'.includes(secret)) return 'That PIN is too easy to guess (a straight run of digits).'
    return null
  }
  if (type === 'pattern') {
    const nodes = secret.split('-').map(Number)
    if (nodes.some((n) => !Number.isInteger(n) || n < 0 || n > 8)) return 'Invalid pattern.'
    if (new Set(nodes).size !== nodes.length) return 'A dot can only be used once.'
    if (nodes.length < PATTERN_MIN) return `Connect at least ${PATTERN_MIN} dots.`
    return null
  }
  if (secret.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (/^\s+$/.test(secret)) return 'Password cannot be only spaces.'
  return null
}

// ---- failed-attempt throttling ----
// Stored in localStorage, so it deters someone using this browser, not an attacker with the encrypted data
// (they can try codes offline). That is why the key derivation itself is slow too.

/** How long to wait after this many consecutive failures. */
export function throttleDelayMs(failures: number): number {
  if (failures < 3) return 0
  if (failures < 5) return 30_000
  if (failures < 7) return 2 * 60_000
  if (failures < 9) return 10 * 60_000
  return 60 * 60_000
}

export type AttemptState = { failures: number; blockedUntil: number }

const key = (workspaceId: string) => `lock-attempts:${workspaceId}`

export function readAttempts(workspaceId: string): AttemptState {
  try {
    const raw = JSON.parse(localStorage.getItem(key(workspaceId)) ?? 'null') as Partial<AttemptState> | null
    if (raw && Number.isFinite(raw.failures) && Number.isFinite(raw.blockedUntil)) return raw as AttemptState
  } catch { /* storage unavailable or corrupt */ }
  return { failures: 0, blockedUntil: 0 }
}

function writeAttempts(workspaceId: string, state: AttemptState) {
  try { localStorage.setItem(key(workspaceId), JSON.stringify(state)) } catch { /* ignore */ }
}

export function recordFailure(workspaceId: string, now = Date.now()): AttemptState {
  const failures = readAttempts(workspaceId).failures + 1
  const state = { failures, blockedUntil: now + throttleDelayMs(failures) }
  writeAttempts(workspaceId, state)
  return state
}

export function clearAttempts(workspaceId: string) {
  try { localStorage.removeItem(key(workspaceId)) } catch { /* ignore */ }
}

export const msRemaining = (s: AttemptState, now = Date.now()) => Math.max(0, s.blockedUntil - now)

export function formatWait(ms: number) {
  const s = Math.ceil(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.ceil(s / 60)
  return m < 60 ? `${m} min` : `${Math.ceil(m / 60)} h`
}
