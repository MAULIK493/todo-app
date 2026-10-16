export type TodoStatus = 'open' | 'in_progress' | 'done'

export type Recurrence = 'daily' | 'weekly' | 'monthly'

export type Todo = {
  id: string
  workspace_id: string
  parent_id: string | null
  title: string
  description: string
  status: TodoStatus
  priority: 0 | 1 | 2 | 3
  due_at: string | null
  reminder_at: string | null
  recurrence: Recurrence | null
  tags: string[]
  position: number
  completed_at: string | null
  created_at: string
  subtasks?: { count: number }[]
}

// 'todo' and 'doing' are the Kanban board's own columns; 'completed' doubles as its Done column.
export type TodoView = 'all' | 'today' | 'upcoming' | 'overdue' | 'completed' | 'todo' | 'doing'

export const VIEWS: { id: 'all' | 'today' | 'upcoming' | 'overdue' | 'completed'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Today' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'completed', label: 'Completed' },
]

export const PRIORITIES = [
  { value: 0, label: 'None', color: 'transparent' },
  { value: 1, label: 'Low', color: '#19c3ff' },
  { value: 2, label: 'Medium', color: '#f59e0b' },
  { value: 3, label: 'High', color: '#ef4444' },
] as const

export const BOARD_COLUMNS: { view: TodoView; label: string; status: TodoStatus }[] = [
  { view: 'todo', label: 'To do', status: 'open' },
  { view: 'doing', label: 'In progress', status: 'in_progress' },
  { view: 'completed', label: 'Done', status: 'done' },
]
