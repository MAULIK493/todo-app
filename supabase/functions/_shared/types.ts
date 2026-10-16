// Types shared by the assistant's Edge Functions and the browser client. No runtime imports here.

export type LockState = 'none' | 'encrypting' | 'locked' | 'decrypting'
export type Tone = 'friendly' | 'concise' | 'coach'
export type TodoStatus = 'open' | 'in_progress' | 'done'
export type Recurrence = 'daily' | 'weekly' | 'monthly'

export type WorkspaceInfo = { id: string; name: string; lock_state: LockState }

export type TodoRow = {
  id: string
  title: string
  description: string
  status: TodoStatus
  priority: 0 | 1 | 2 | 3
  due_at: string | null
  recurrence: Recurrence | null
  workspace_id: string
  parent_id: string | null
  tags: string[]
  subtask_count: number
}

export type NoteRow = {
  id: string
  title: string
  text: string
  workspace_id: string
  updated_at: string
  pinned: boolean
  tags: string[]
}

export type TodoView = 'open' | 'today' | 'overdue' | 'upcoming' | 'in_progress' | 'completed'

export type TodoQuery = {
  workspaceIds: string[]
  view: TodoView
  minPriority: number
  tag: string | null
  limit: number
  /** Start (inclusive) and end (exclusive) of the user's local today, plus the current instant. */
  today: { start: string; end: string; now: string }
}

export type WorkspaceCounts = {
  workspace_id: string
  open: number
  in_progress: number
  overdue: number
  due_today: number
  completed_this_week: number
}

export type RewardsSnapshot = {
  level: number
  xp: number
  coins: number
  streak: number
  longest_streak: number
  active_today: boolean
  today_done: number
  daily_goal: number
  week_done: number
  weekly_goal: number
} | null

/** Everything the assistant is allowed to do to the outside world. Real implementation: db.ts. */
export interface Db {
  workspaces(): Promise<WorkspaceInfo[]>
  /** workspace id -> explicit allow/deny from the user's AI settings (missing = default). */
  workspaceAccess(): Promise<Record<string, boolean>>
  profile(): Promise<{ timezone: string; tone: Tone; briefingEnabled: boolean }>

  listTodos(q: TodoQuery): Promise<TodoRow[]>
  searchTodos(q: { workspaceIds: string[]; query: string; includeDone: boolean; limit: number }): Promise<TodoRow[]>
  getTodos(ids: string[]): Promise<TodoRow[]>
  createTodo(input: {
    workspace_id: string; title: string; description?: string; priority?: number
    due_at?: string | null; recurrence?: Recurrence | null; tags?: string[]
  }): Promise<{ id: string; title: string }>
  updateTodo(id: string, patch: Partial<{
    title: string; description: string; priority: number; due_at: string | null; status: 'open' | 'in_progress'; recurrence: Recurrence | null
  }>): Promise<void>
  completeTodo(id: string): Promise<void>
  addSubtasks(parentId: string, workspaceId: string, titles: string[]): Promise<number>

  createNote(input: { workspace_id: string; title: string; body: string; tags?: string[] }): Promise<{ id: string; title: string }>
  searchNotes(q: { workspaceIds: string[]; query: string; limit: number }): Promise<NoteRow[]>
  getNote(id: string): Promise<NoteRow | null>

  counts(workspaceIds: string[], today: TodoQuery['today'], weekStart: string): Promise<WorkspaceCounts[]>
  rewards(): Promise<RewardsSnapshot>
}

/** What the assistant did, shown to the user as cards (some with Undo). */
export type Action =
  | { kind: 'todo_created'; id: string; title: string; workspace: string }
  | { kind: 'todo_completed'; id: string; title: string }
  | { kind: 'todo_updated'; id: string; title: string; changes: string[] }
  | { kind: 'subtasks_added'; parent_id: string; parent_title: string; count: number }
  | { kind: 'note_created'; id: string; title: string; workspace: string }

/** A destructive or bulk change the user must approve with a button; nothing has happened yet. */
export type ConfirmRequest = {
  id: string
  kind: 'delete_todos' | 'reschedule_todos'
  summary: string
  items: { id: string; title: string }[]
  due_at?: string
}

export type ServerEvent =
  | { type: 'text'; delta: string }
  /** The turn being streamed failed part-way and is being retried: keep only the first `keep` characters of text. */
  | { type: 'turn_reset'; keep: number }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error' }
  | { type: 'action'; action: Action }
  | { type: 'confirm'; confirm: ConfirmRequest }
  | { type: 'done'; conversationId: string; persisted: boolean; usage: { input: number; output: number } }
  | { type: 'error'; message: string; code?: 'rate_limited' | 'bad_request' | 'unauthorized' | 'server' }
