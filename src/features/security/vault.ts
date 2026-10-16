import { create } from 'zustand'
import { queryClient } from '@/lib/queryClient'
import type { LockState, Workspace } from '@/features/workspaces/types'
import {
  decryptJson, decryptText, encryptJson, encryptText, isEncrypted, isEncryptedJson, type EncryptedJson,
} from './crypto'

/**
 * In-memory only. Working keys are never written to storage, so a reload, closing the tab, signing out or
 * the auto-lock timer all require the code again.
 */
type VaultState = {
  /** Lock state of each workspace, learned from the workspaces query so non-React code can consult it. */
  states: Record<string, LockState>
  keys: Record<string, CryptoKey>
  setInfo: (workspaces: Pick<Workspace, 'id' | 'lock_state'>[]) => void
  unlock: (workspaceId: string, key: CryptoKey) => void
  lock: (workspaceId: string) => void
  lockAll: () => void
}

// Cached decrypted data lives in react-query. Drop it whenever a workspace locks.
const CONTENT_QUERIES = new Set(['todos', 'subtasks', 'notes', 'note', 'note-todos', 'todo-notes', 'link-todo-search'])

export function dropDecryptedData(workspaceId?: string) {
  queryClient.removeQueries({
    predicate: ({ queryKey }) => {
      const [root, second] = queryKey as [string, unknown]
      if (!CONTENT_QUERIES.has(root)) return false
      // ['todos', ws, ...] is workspace-scoped; the others aren't, so they are dropped whenever anything locks.
      return !workspaceId || root !== 'todos' || second === workspaceId
    },
  })
}

export const useVault = create<VaultState>((set, get) => ({
  states: {},
  keys: {},
  setInfo: (workspaces) => {
    const states: Record<string, LockState> = {}
    for (const w of workspaces) states[w.id] = w.lock_state
    // A workspace that stopped being private can't keep a key around.
    const keys = Object.fromEntries(Object.entries(get().keys).filter(([id]) => (states[id] ?? 'none') !== 'none'))
    set({ states, keys })
  },
  unlock: (workspaceId, key) => set((s) => ({ keys: { ...s.keys, [workspaceId]: key } })),
  lock: (workspaceId) => {
    set((s) => {
      const { [workspaceId]: _gone, ...keys } = s.keys
      return { keys }
    })
    dropDecryptedData(workspaceId)
  },
  lockAll: () => {
    if (Object.keys(get().keys).length === 0) return
    set({ keys: {} })
    dropDecryptedData()
  },
}))

export class LockedError extends Error {
  constructor() {
    super('This workspace is locked')
  }
}

/** Reactive version for components. */
export const useIsPrivate = (workspaceId: string) => useVault((s) => (s.states[workspaceId] ?? 'none') !== 'none')

export const isPrivateWorkspace = (workspaceId: string) => (useVault.getState().states[workspaceId] ?? 'none') !== 'none'

export const UNREADABLE = '⚠ Could not decrypt'

/** Field-level encryption bound to one workspace. */
export type Cipher = {
  text: (field: 'title' | 'description', plain: string) => Promise<string>
  readText: (field: 'title' | 'description', stored: string) => Promise<string>
  json: (value: unknown) => Promise<EncryptedJson>
  readJson: <T>(stored: unknown, fallback: T) => Promise<T>
}

/**
 * Returns the cipher for a private workspace, or null for a normal one (callers then read/write plaintext).
 * Throws LockedError if the workspace is private but its key isn't in memory.
 * A workspace being decrypted is treated as normal: its rows are converted to plaintext in batches.
 */
export function cipherFor(workspaceId: string): Cipher | null {
  const { states, keys } = useVault.getState()
  const state = states[workspaceId] ?? 'none'
  if (state === 'none' || state === 'decrypting') return null
  const key = keys[workspaceId]
  if (!key) throw new LockedError()

  return {
    text: (field, plain) => encryptText(key, workspaceId, field, plain),
    // Rows not converted yet (mid-conversion) are still plaintext and pass through.
    readText: async (field, stored) => {
      if (!isEncrypted(stored)) return stored
      try { return await decryptText(key, workspaceId, field, stored) } catch { return UNREADABLE }
    },
    json: (value) => encryptJson(key, workspaceId, 'content', value),
    readJson: async (stored, fallback) => {
      if (!isEncryptedJson(stored)) return stored as never
      try { return await decryptJson(key, workspaceId, 'content', stored) } catch { return fallback }
    },
  }
}
