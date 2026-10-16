import { supabase } from '@/lib/supabase'
import type { LockParams } from './crypto'

const check = (e: { message: string } | null) => {
  if (e) throw new Error(e.message)
}

const lockArgs = (ws: string, p: LockParams) => ({
  p_ws: ws, p_type: p.lock_type, p_salt: p.lock_salt, p_iter: p.lock_iterations, p_wrapped: p.wrapped_key,
  p_rec_salt: p.recovery_salt, p_rec_wrapped: p.recovery_wrapped_key,
})

export const startLock = async (ws: string, p: LockParams) => check((await supabase.rpc('start_workspace_lock', lockArgs(ws, p))).error)
export const rewrapKey = async (ws: string, p: LockParams) => check((await supabase.rpc('rewrap_workspace_key', lockArgs(ws, p))).error)
export const finishLock = async (ws: string) => check((await supabase.rpc('finish_workspace_lock', { p_ws: ws })).error)
export const startUnlock = async (ws: string) => check((await supabase.rpc('start_workspace_unlock', { p_ws: ws })).error)
export const finishUnlock = async (ws: string) => check((await supabase.rpc('finish_workspace_unlock', { p_ws: ws })).error)

export type PendingCounts = { plain_todos: number; plain_notes: number; enc_todos: number; enc_notes: number }
export type TodoRow = { id: string; title: string; description: string }
export type NoteRow = { id: string; title: string; content: unknown }
export type PendingBatch = { todos: TodoRow[]; notes: NoteRow[] }

export async function pendingCounts(ws: string): Promise<PendingCounts> {
  const { data, error } = await supabase.rpc('pending_counts', { p_ws: ws })
  check(error)
  return data as PendingCounts
}

export async function pendingBatch(kind: 'encryption' | 'decryption', ws: string, limit: number): Promise<PendingBatch> {
  const { data, error } = await supabase.rpc(kind === 'encryption' ? 'pending_encryption' : 'pending_decryption', { p_ws: ws, p_limit: limit })
  check(error)
  return data as PendingBatch
}

export async function applyBatch(
  ws: string,
  todos: TodoRow[],
  notes: (NoteRow & { content_text: string })[],
): Promise<{ todos: number; notes: number }> {
  const { data, error } = await supabase.rpc('apply_batch', { p_ws: ws, p_todos: todos, p_notes: notes })
  check(error)
  return data as { todos: number; notes: number }
}
