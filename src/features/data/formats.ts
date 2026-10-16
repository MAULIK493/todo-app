import type { JSONContent } from '@tiptap/react'

// The shapes of exported files. JSON keeps everything; CSV is for spreadsheets and other apps.

export const FORMAT = 'todo-app-export'
export const FORMAT_VERSION = 1

export type ExportWorkspace = { id: string; name: string; color: string; icon: string; position: number; private: boolean }
export type ExportFolder = { id: string; workspace_id: string; name: string; position: number }
export type ExportTodo = {
  id: string; workspace_id: string; parent_id: string | null; title: string; description: string; status: 'open' | 'in_progress' | 'done'
  priority: number; due_at: string | null; reminder_at: string | null; recurrence: 'daily' | 'weekly' | 'monthly' | null
  tags: string[]; position: number; completed_at: string | null; created_at: string
}
export type ExportNote = {
  id: string; workspace_id: string; folder_id: string | null; title: string; content: JSONContent | null; text: string
  pinned: boolean; tags: string[]; created_at: string; updated_at: string
}

// ---- CSV ----

/**
 * One CSV cell. Quotes and commas are handled per RFC 4180, and text that a spreadsheet would run as a formula
 * (starting with = + - @ or a control character) gets a leading apostrophe, so opening an export can't execute anything.
 */
export function csvCell(value: string | number | boolean | null | undefined): string {
  let s = value === null || value === undefined ? '' : String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Undo the apostrophe csvCell adds, so our own exports round-trip exactly. */
export const unguardCell = (s: string) => (/^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s)

export const csvRow = (cells: (string | number | boolean | null | undefined)[]) => cells.map(csvCell).join(',')

const PRIORITY = ['none', 'low', 'medium', 'high']

// Column names are unambiguous on purpose: other apps use "completed" as a yes/no flag, ours is a date (completed_at).
export const TODO_CSV_HEADER = ['workspace', 'title', 'description', 'status', 'priority', 'due', 'recurrence', 'tags', 'created_at', 'completed_at', 'id', 'parent_id']
export const NOTE_CSV_HEADER = ['workspace', 'title', 'text', 'tags', 'pinned', 'created_at', 'updated_at']

export function todoCsvLine(t: ExportTodo, workspaceName: string): string {
  return csvRow([workspaceName, t.title, t.description, t.status, PRIORITY[t.priority] ?? 'none', t.due_at, t.recurrence, t.tags.join('; '), t.created_at, t.completed_at, t.id, t.parent_id])
}

export function noteCsvLine(n: ExportNote, workspaceName: string): string {
  return csvRow([workspaceName, n.title, n.text, n.tags.join('; '), n.pinned, n.created_at, n.updated_at])
}

// ---- JSON, written in pieces so a very large export never has to exist as one giant string ----

export type ExportMeta = { exportedAt: string; app: string; includesPrivate: boolean; skippedPrivate: string[] }

export class JsonExport {
  private parts: string[] = []
  private counts = { todos: 0, notes: 0, folders: 0 }
  private open: 'todos' | 'notes' | 'folders' | null = null
  private first = true

  constructor(workspaces: ExportWorkspace[], meta: ExportMeta) {
    this.parts.push(`{"format":${JSON.stringify(FORMAT)},"version":${FORMAT_VERSION},"meta":${JSON.stringify(meta)},"workspaces":${JSON.stringify(workspaces)}`)
  }

  private add(section: 'todos' | 'notes' | 'folders', items: unknown[]) {
    if (items.length === 0) return
    if (this.open !== section) {
      if (this.open) this.parts.push(']')
      this.parts.push(`,"${section}":[`)
      this.open = section
      this.first = true
    }
    for (const item of items) {
      this.parts.push((this.first ? '' : ',') + JSON.stringify(item))
      this.first = false
    }
    this.counts[section] += items.length
  }

  addFolders(f: ExportFolder[]) { this.add('folders', f) }
  addTodos(t: ExportTodo[]) { this.add('todos', t) }
  addNotes(n: ExportNote[]) { this.add('notes', n) }

  finish(): { blob: Blob; counts: { todos: number; notes: number; folders: number } } {
    if (this.open) this.parts.push(']')
    this.open = null
    // Sections that never received an item are still present (empty), so readers can rely on the keys.
    const text = this.parts.join('')
    const filled = (k: string) => text.includes(`,"${k}":[`)
    const tail = ['folders', 'todos', 'notes'].filter((k) => !filled(k)).map((k) => `,"${k}":[]`).join('')
    return { blob: new Blob([text, tail, '}'], { type: 'application/json' }), counts: { ...this.counts } }
  }
}
