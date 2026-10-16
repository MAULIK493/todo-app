import { create } from 'zustand'

/** Set when someone gets in with a recovery key, so the app can offer to set a new code straight away. */
export const useRecoveryPrompt = create<{
  prompt: { workspaceId: string; recoveryKey: string } | null
  set: (p: { workspaceId: string; recoveryKey: string } | null) => void
}>((set) => ({ prompt: null, set: (prompt) => set({ prompt }) }))
