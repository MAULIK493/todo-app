import type { Action, ConfirmRequest, ServerEvent } from '@shared/types.ts'

export type ConfirmState = ConfirmRequest & { state: 'pending' | 'running' | 'done' | 'cancelled' | 'error'; note?: string }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  actions: Action[]
  confirms: ConfirmState[]
  status: 'streaming' | 'done' | 'error'
  /** What the assistant is doing right now ("Looking at your todos…"). */
  activity: string | null
  error?: string
  /** True when this exchange used shared private content and so was not saved to the server. */
  unsaved?: boolean
}

export const newMessage = (id: string, role: ChatMessage['role'], text = ''): ChatMessage => ({
  id, role, text, actions: [], confirms: [], status: role === 'assistant' ? 'streaming' : 'done', activity: null,
})

const ACTIVITY: Record<string, string> = {
  list_workspaces: 'Checking your workspaces…',
  list_todos: 'Looking at your todos…',
  search_todos: 'Searching your todos…',
  create_todo: 'Adding a todo…',
  update_todo: 'Updating a todo…',
  complete_todo: 'Marking it done…',
  add_subtasks: 'Adding subtasks…',
  create_note: 'Writing a note…',
  search_notes: 'Searching your notes…',
  get_note: 'Reading a note…',
  get_stats: 'Checking your progress…',
  propose_delete_todos: 'Preparing a confirmation…',
  propose_reschedule_todos: 'Preparing a confirmation…',
}

/** Folds one server event into the assistant message being streamed. Pure, so the stream logic is easy to test. */
export function applyServerEvent(m: ChatMessage, e: ServerEvent): ChatMessage {
  switch (e.type) {
    case 'text':
      return { ...m, text: m.text + e.delta, activity: null }
    case 'turn_reset':
      return { ...m, text: m.text.slice(0, e.keep) }
    case 'tool':
      return { ...m, activity: e.status === 'running' ? ACTIVITY[e.name] ?? 'Working…' : null }
    case 'action':
      return { ...m, actions: [...m.actions, e.action] }
    case 'confirm':
      return { ...m, confirms: [...m.confirms, { ...e.confirm, state: 'pending' }] }
    case 'done':
      return { ...m, status: 'done', activity: null }
    case 'error':
      return { ...m, status: 'error', activity: null, error: e.message }
  }
}
