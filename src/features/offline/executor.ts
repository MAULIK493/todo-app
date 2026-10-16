import { supabase } from '@/lib/supabase'
import type { OutboxOp } from './outbox'

/** Carries out one queued change against the server. Throws the database error as it is, so the caller can classify it. */
export async function applyOp(op: OutboxOp): Promise<void> {
  if (op.kind === 'set_done') {
    const { error } = await supabase.rpc(op.done ? 'complete_todo' : 'reopen_todo', { p_id: op.id })
    if (error) throw error
    return
  }
  const { tags, ...row } = op.todo
  // The id is chosen by the app, so repeating this insert after an interrupted attempt is detected (23505) rather than duplicated.
  const { error } = await supabase.from('todos').insert({ ...row, parent_id: row.parent_id })
  if (error) throw error
  if (tags.length) {
    const r = await supabase.rpc('set_todo_tags', { p_todo: row.id, p_names: tags })
    if (r.error) throw r.error
  }
}
