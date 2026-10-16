import { create } from 'zustand'

export type OfflineStatus = {
  online: boolean
  /** Changes made offline that haven't reached the server yet. */
  pending: number
  syncing: boolean
  /** Sync paused because the sign-in expired (it resumes after signing in again). */
  needsSignIn: boolean
}

export const useOfflineStatus = create<OfflineStatus>(() => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  pending: 0,
  syncing: false,
  needsSignIn: false,
}))
