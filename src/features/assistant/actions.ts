import type { Action, ConfirmRequest } from '@shared/types.ts'
import { queryClient } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase'

const check = (e: { message: string } | null) => {
  if (e) throw new Error(e.message)
}

/** The assistant changed data behind the app's back: reload everything that may show it (and notice any XP earned). */
export function refreshAfterAssistant() {
  for (const key of ['todos', 'subtasks', 'notes', 'note', 'tags', 'rewards', 'note-todos', 'todo-notes']) {
    queryClient.invalidateQueries({ queryKey: [key] })
  }
}

export const canUndo = (a: Action) => a.kind === 'todo_created' || a.kind === 'todo_completed' || a.kind === 'note_created'

export async function undoAction(a: Action) {
  switch (a.kind) {
    case 'todo_created':
      check((await supabase.from('todos').delete().eq('id', a.id)).error)
      break
    case 'todo_completed':
      check((await supabase.rpc('reopen_todo', { p_id: a.id })).error)
      break
    case 'note_created':
      check((await supabase.from('notes').delete().eq('id', a.id)).error)
      break
    default:
      return
  }
  refreshAfterAssistant()
}

/** Carries out a change the user approved with the Confirm button. Returns a short result line. */
export async function runConfirm(c: ConfirmRequest): Promise<string> {
  const ids = c.items.map((i) => i.id)
  if (c.kind === 'delete_todos') {
    check((await supabase.rpc('delete_todos', { p_ids: ids })).error)
    refreshAfterAssistant()
    return `Deleted ${ids.length} todo${ids.length === 1 ? '' : 's'}.`
  }
  check((await supabase.from('todos').update({ due_at: c.due_at }).in('id', ids)).error)
  refreshAfterAssistant()
  return `Moved ${ids.length} todos.`
}
