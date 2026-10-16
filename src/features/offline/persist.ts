import type { Persister } from '@tanstack/query-persist-client-core'
import type { LockState } from '@/features/workspaces/types'
import { createKV, type KV } from './kv'

// The app keeps a copy of the lists it has loaded on this device, so it can open and show them with no connection.
// That copy is stored unencrypted, so it must never contain content from private workspaces (those are only ever
// decrypted in memory), chat history, or anything else sensitive. This allow-list decides what may be saved.

const ROOTS = new Set(['workspaces', 'todos', 'subtasks', 'notes', 'note', 'tags', 'note-folders', 'rewards'])

export type WorkspaceStates = Record<string, LockState>

const plain = (states: WorkspaceStates, id: unknown) => typeof id === 'string' && states[id] === 'none'

/** True if this query's data may be written to the device. Anything unclear is left out. */
export function shouldPersist(queryKey: readonly unknown[], data: unknown, states: WorkspaceStates): boolean {
  const [root, second, third] = queryKey as [string, unknown, unknown]
  if (!ROOTS.has(root)) return false
  switch (root) {
    case 'workspaces':
    case 'rewards':
      return true
    case 'todos':
    case 'tags':
    case 'note-folders':
      return plain(states, second)
    case 'notes':
      return plain(states, (third as { workspaceId?: unknown } | null)?.workspaceId)
    case 'note':
      return plain(states, (data as { workspace_id?: unknown } | null | undefined)?.workspace_id)
    case 'subtasks':
      // Keyed by parent, not workspace: check where the subtasks actually live.
      return Array.isArray(data) && data.every((t) => plain(states, (t as { workspace_id?: unknown })?.workspace_id))
    default:
      return false
  }
}

const KEY = 'client'

export function createPersister(kv: KV = createKV()): Persister {
  return {
    persistClient: (client) => kv.set('cache', KEY, client),
    restoreClient: () => kv.get('cache', KEY),
    removeClient: () => kv.delete('cache', KEY),
  }
}

export const persister = createPersister()
