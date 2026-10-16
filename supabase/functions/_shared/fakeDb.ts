// In-memory Db used by the tests (kept as a module so the agent tests can reuse it).
import type { Db, NoteRow, TodoRow, WorkspaceInfo } from './types.ts'

export class FakeDb implements Db {
  todos: TodoRow[] = []
  notes: NoteRow[] = []
  calls: string[] = []
  access: Record<string, boolean> = {}
  ws: WorkspaceInfo[]
  constructor(ws: WorkspaceInfo[] = []) {
    this.ws = ws
  }

  async workspaces() { return this.ws }
  async workspaceAccess() { return this.access }
  async profile() { return { timezone: 'UTC', tone: 'friendly' as const, briefingEnabled: true } }

  async listTodos(q: Parameters<Db['listTodos']>[0]) {
    this.calls.push(`list:${q.workspaceIds.join(',')}:${q.view}`)
    return this.todos.filter((t) => q.workspaceIds.includes(t.workspace_id) && !t.parent_id).slice(0, q.limit)
  }
  async searchTodos(q: Parameters<Db['searchTodos']>[0]) {
    return this.todos.filter((t) => q.workspaceIds.includes(t.workspace_id) && t.title.toLowerCase().includes(q.query.toLowerCase())).slice(0, q.limit)
  }
  async getTodos(ids: string[]) { return this.todos.filter((t) => ids.includes(t.id)) }
  async createTodo(input: Parameters<Db['createTodo']>[0]) {
    this.calls.push(`create:${input.workspace_id}`)
    const id = `00000000-0000-0000-0000-${String(this.todos.length + 1).padStart(12, '0')}`
    this.todos.push({
      id, title: input.title, description: input.description ?? '', status: 'open', priority: (input.priority ?? 0) as 0, due_at: input.due_at ?? null,
      recurrence: input.recurrence ?? null, workspace_id: input.workspace_id, parent_id: null, tags: input.tags ?? [], subtask_count: 0,
    })
    return { id, title: input.title }
  }
  async updateTodo(id: string, patch: Parameters<Db['updateTodo']>[1]) { this.calls.push(`update:${id}`); Object.assign(this.todos.find((t) => t.id === id)!, patch) }
  async completeTodo(id: string) { this.calls.push(`complete:${id}`); this.todos.find((t) => t.id === id)!.status = 'done' }
  async addSubtasks(_p: string, _w: string, titles: string[]) { this.calls.push('subtasks'); return titles.length }
  async createNote(input: Parameters<Db['createNote']>[0]) {
    this.calls.push(`note:${input.workspace_id}`)
    const id = `10000000-0000-0000-0000-${String(this.notes.length + 1).padStart(12, '0')}`
    this.notes.push({ id, title: input.title, text: input.body, workspace_id: input.workspace_id, updated_at: '2026-10-15T00:00:00Z', pinned: false, tags: input.tags ?? [] })
    return { id, title: input.title }
  }
  async searchNotes(q: Parameters<Db['searchNotes']>[0]) {
    return this.notes.filter((n) => q.workspaceIds.includes(n.workspace_id) && (n.title + n.text).toLowerCase().includes(q.query.toLowerCase())).slice(0, q.limit)
  }
  async getNote(id: string) { return this.notes.find((n) => n.id === id) ?? null }
  async counts(workspaceIds: string[]) {
    return workspaceIds.map((workspace_id) => ({
      workspace_id,
      open: this.todos.filter((t) => t.workspace_id === workspace_id && t.status === 'open').length,
      in_progress: 0, overdue: 0, due_today: 0, completed_this_week: 0,
    }))
  }
  async rewards() { return null }
}

export const todo = (over: Partial<TodoRow> & Pick<TodoRow, 'id' | 'workspace_id'>): TodoRow => ({
  title: 'A todo', description: '', status: 'open', priority: 0, due_at: null, recurrence: null, parent_id: null, tags: [], subtask_count: 0, ...over,
})
