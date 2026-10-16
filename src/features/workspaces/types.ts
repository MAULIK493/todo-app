import type { LockParams } from '@/features/security/crypto'

export type LockState = 'none' | 'encrypting' | 'locked' | 'decrypting'

export type Workspace = {
  id: string
  name: string
  color: string
  icon: string
  position: number
  background: unknown | null
  lock_state: LockState
  lock_type: LockParams['lock_type'] | null
  lock_salt: string | null
  lock_iterations: number | null
  wrapped_key: string | null
  recovery_salt: string | null
  recovery_wrapped_key: string | null
}

export const isPrivateState = (s: LockState) => s !== 'none'

/** The server-stored lock material, or null for a normal workspace. */
export function lockParamsOf(w: Workspace): LockParams | null {
  if (w.lock_state === 'none' || !w.lock_type || !w.lock_salt || !w.lock_iterations || !w.wrapped_key) return null
  return {
    lock_type: w.lock_type, lock_salt: w.lock_salt, lock_iterations: w.lock_iterations, wrapped_key: w.wrapped_key,
    recovery_salt: w.recovery_salt, recovery_wrapped_key: w.recovery_wrapped_key,
  }
}

export const WORKSPACE_COLORS = ['#7c5cff', '#19c3ff', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#64748b']
export const WORKSPACE_SUGGESTIONS = ['Personal', 'Professional']
