import { parseDueAt } from '@shared/dates.ts'
import { FORMAT, FORMAT_VERSION, TODO_CSV_HEADER, unguardCell, type ExportFolder, type ExportNote, type ExportTodo, type ExportWorkspace } from './formats'

// Reading files back in. Everything here is untrusted input: sizes are capped, values are clamped, and anything that
// doesn't fit is dropped with a warning rather than failing the whole import.

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_TODOS = 50_000
export const MAX_NOTES = 5_000

// ---- CSV ----

/** RFC 4180 parser: quoted cells may contain commas, quotes ("") and line breaks; handles a BOM and CRLF/LF/CR. */
export function parseCsv(text: string, delimiter = ','): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let touched = false
  const endCell = () => { row.push(cell); cell = ''; touched = true }
  const endRow = () => { endCell(); if (!(row.length === 1 && row[0] === '' && !touched)) rows.push(row); row = []; touched = false }

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++ } else quoted = false } else cell += c
    } else if (c === '"' && cell === '') { quoted = true; touched = true }
    else if (c === delimiter) endCell()
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; endRow() }
    else cell += c
  }
  if (cell !== '' || row.length > 0 || touched) endRow()
  return rows.filter((r) => r.some((x) => x.trim() !== ''))
}

/** Picks comma, semicolon or tab by looking at the first line (spreadsheets in some regions export semicolons). */
export function detectDelimiter(text: string): string {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? ''
  const counts = [',', ';', '\t'].map((d) => ({ d, n: first.split(d).length - 1 }))
  const best = counts.sort((a, b) => b.n - a.n)[0]
  return best.n > 0 ? best.d : ','
}

// ---- what an import will do ----

export type PlanTodo = Omit<ExportTodo, 'workspace_id' | 'position' | 'created_at'> & { ref: string; created_at: string | null }
export type PlanNote = Omit<ExportNote, 'workspace_id' | 'created_at' | 'updated_at'> & { created_at: string | null; updated_at: string | null }
export type PlanGroup = {
  /** Name in the file; becomes a new workspace or is mapped to an existing one in the preview. */
  name: string
  color: string | null
  folders: { id: string; name: string }[]
  todos: PlanTodo[]
  notes: PlanNote[]
}
export type ImportPlan = { source: 'json' | 'csv'; groups: PlanGroup[]; warnings: string[] }
export type ParseResult = { ok: true; plan: ImportPlan } | { ok: false; error: string }

const HEX = /^#[0-9a-fA-F]{6}$/
const STATUS = new Set(['open', 'in_progress', 'done'])
const RECURRENCE = new Set(['daily', 'weekly', 'monthly'])
const clip = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const isoOrNull = (v: unknown) => {
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
const ref = (() => { let n = 0; return () => `r${++n}` })()
const uuid = () => crypto.randomUUID()

class Warnings {
  private seen = new Map<string, number>()
  add(msg: string) { this.seen.set(msg, (this.seen.get(msg) ?? 0) + 1) }
  list() { return [...this.seen].map(([m, n]) => (n > 1 ? `${m} (${n} times)` : m)) }
}

// ---- CSV todos ----

const ALIASES: Record<string, string[]> = {
  title: ['title', 'task', 'content', 'name', 'summary', 'todo', 'item'],
  description: ['description', 'notes', 'details', 'body', 'note'],
  status: ['status', 'state', 'completed', 'done'],
  priority: ['priority', 'prio', 'importance'],
  due: ['due', 'due date', 'due_date', 'duedate', 'deadline', 'date', 'due_at'],
  recurrence: ['recurrence', 'repeat', 'repeats', 'recurring'],
  tags: ['tags', 'labels', 'label', 'tag'],
  workspace: ['workspace', 'project', 'list', 'folder', 'category'],
  completed: ['completed_at', 'completion date', 'date completed', 'done_at'],
  created: ['created', 'created_at', 'date added', 'added'],
  id: ['id'],
  parent_id: ['parent_id', 'parent id', 'parent'],
}

/** Which column holds each field (-1 when the file has none), matching common header names case-insensitively. */
function columnIndex(header: string[]): Record<string, number> {
  const norm = header.map((h) => h.trim().toLowerCase())
  const find = (key: string) => ALIASES[key].map((alias) => norm.indexOf(alias)).find((i) => i >= 0) ?? -1
  return Object.fromEntries(Object.keys(ALIASES).map((k) => [k, find(k)]))
}

const RECURRENCE_WORDS: Record<string, PlanTodo['recurrence']> = { day: 'daily', daily: 'daily', week: 'weekly', weekly: 'weekly', month: 'monthly', monthly: 'monthly' }
const DONE = /^(done|completed|complete|closed|true|yes|1|x|checked)$/i
const DOING = /^(in[ _-]?progress|doing|started|wip)$/i

function mapPriority(raw: string, w: Warnings): number {
  const v = raw.trim().toLowerCase()
  if (v === '' || v === 'none' || v === 'normal' || v === '0') return 0
  if (/^(low|l|minor)$/.test(v)) return 1
  if (/^(medium|med|m|normal priority)$/.test(v)) return 2
  if (/^(high|h|urgent|critical|major)$/.test(v)) return 3
  if (/^[1-3]$/.test(v)) return Number(v)
  w.add(`Unrecognised priority "${raw.slice(0, 20)}" was imported as none`)
  return 0
}

export function parseTodoCsv(text: string, opts: { timeZone: string; defaultWorkspace: string }): ParseResult {
  if (text.length > MAX_FILE_BYTES) return { ok: false, error: 'That file is too large (limit 25 MB).' }
  const rows = parseCsv(text, detectDelimiter(text))
  if (rows.length < 2) return { ok: false, error: 'The file needs a header row and at least one todo.' }
  const col = columnIndex(rows[0])
  if (col.title < 0) return { ok: false, error: `No title column found. Add a column named one of: ${ALIASES.title.join(', ')}.` }
  if (rows.length - 1 > MAX_TODOS) return { ok: false, error: `Too many rows (limit ${MAX_TODOS.toLocaleString()} per import). Split the file and import it in parts.` }

  const w = new Warnings()
  const groups = new Map<string, PlanGroup>()
  const idMap = new Map<string, string>() // id in the file -> new ref
  const pendingParents: { todo: PlanTodo; parent: string }[] = []

  rows.slice(1).forEach((r, i) => {
    const cell = (k: string) => (col[k] >= 0 ? unguardCell((r[col[k]] ?? '').trim()) : '')
    const title = clip(cell('title'), 500)
    if (!title) { w.add(`Row ${i + 2} has no title and was skipped`); return }

    const name = cell('workspace').slice(0, 60) || opts.defaultWorkspace
    const group = groups.get(name) ?? { name, color: null, folders: [], todos: [], notes: [] }
    groups.set(name, group)

    const statusRaw = cell('status')
    const status: PlanTodo['status'] = DONE.test(statusRaw) ? 'done' : DOING.test(statusRaw) ? 'in_progress' : 'open'
    const dueRaw = cell('due')
    let due: string | null = null
    if (dueRaw) {
      const parsed = parseDueAt(dueRaw, opts.timeZone)
      if (parsed) due = parsed.toISOString()
      else w.add(`Could not read the date "${dueRaw.slice(0, 20)}" (use YYYY-MM-DD); imported without a due date`)
    }
    const recurrence = RECURRENCE_WORDS[cell('recurrence').toLowerCase().replace(/^every\s+/, '').trim()] ?? null
    const completedRaw = cell('completed')
    const completedAt = status === 'done' ? (isoOrNull(completedRaw) ?? new Date().toISOString()) : null

    const todo: PlanTodo = {
      ref: ref(), id: uuid(), parent_id: null, title, description: clip(cell('description'), 20_000), status,
      priority: mapPriority(cell('priority'), w), due_at: due, reminder_at: null, recurrence: due ? recurrence : null,
      tags: cell('tags').split(/[;,|]/).map((t) => t.trim().toLowerCase().replace(/^#/, '').slice(0, 40)).filter(Boolean).slice(0, 10),
      completed_at: completedAt, created_at: isoOrNull(cell('created')),
    }
    group.todos.push(todo)
    const fileId = cell('id')
    if (fileId) idMap.set(fileId, todo.id)
    const parent = cell('parent_id')
    if (parent) pendingParents.push({ todo, parent })
  })

  // Subtasks: only our own export carries ids, so a parent column holding something else is simply ignored.
  for (const { todo, parent } of pendingParents) {
    const target = idMap.get(parent)
    if (target) todo.parent_id = target
  }
  const total = [...groups.values()].reduce((n, g) => n + g.todos.length, 0)
  if (total === 0) return { ok: false, error: 'No todos with a title were found in that file.' }
  return { ok: true, plan: { source: 'csv', groups: [...groups.values()], warnings: w.list() } }
}

// ---- JSON (our own export) ----

type Raw = Record<string, unknown>
const isObj = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v)
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isObj) : [])

export function parseJsonExport(text: string): ParseResult {
  if (text.length > MAX_FILE_BYTES) return { ok: false, error: 'That file is too large (limit 25 MB).' }
  let data: unknown
  try { data = JSON.parse(text) } catch { return { ok: false, error: "That isn't a valid JSON file." } }
  if (!isObj(data) || data.format !== FORMAT) return { ok: false, error: "That file wasn't exported from this app." }
  if (typeof data.version !== 'number' || data.version > FORMAT_VERSION) return { ok: false, error: 'That file was made by a newer version of the app. Update the app and try again.' }

  const w = new Warnings()
  const workspaces = arr(data.workspaces)
  const todos = arr(data.todos)
  const notes = arr(data.notes)
  const folders = arr(data.folders)
  if (todos.length > MAX_TODOS) return { ok: false, error: `Too many todos (limit ${MAX_TODOS.toLocaleString()} per import).` }
  if (notes.length > MAX_NOTES) return { ok: false, error: `Too many notes (limit ${MAX_NOTES.toLocaleString()} per import).` }

  const groups = new Map<string, PlanGroup>()
  for (const ws of workspaces) {
    const id = clip(ws.id, 64)
    if (!id) continue
    groups.set(id, { name: clip(ws.name, 60).trim() || 'Imported', color: typeof ws.color === 'string' && HEX.test(ws.color) ? ws.color.toLowerCase() : null, folders: [], todos: [], notes: [] })
  }
  const groupOf = (wsId: unknown) => groups.get(clip(wsId, 64))

  const folderIds = new Map<string, string>() // old id -> new id
  for (const f of folders) {
    const g = groupOf(f.workspace_id)
    const name = clip(f.name, 60).trim()
    if (!g || !name || typeof f.id !== 'string') continue
    const id = uuid()
    folderIds.set(f.id, id)
    g.folders.push({ id, name })
  }

  const idMap = new Map<string, string>()
  const kept: { raw: Raw; todo: PlanTodo; group: PlanGroup }[] = []
  for (const t of todos) {
    const group = groupOf(t.workspace_id)
    const title = clip(t.title, 500).trim()
    if (!group) { w.add('A todo belonged to a workspace that is not in the file and was skipped'); continue }
    if (!title) { w.add('A todo with no title was skipped'); continue }
    const status = STATUS.has(t.status as string) ? (t.status as PlanTodo['status']) : 'open'
    const due = isoOrNull(t.due_at)
    const todo: PlanTodo = {
      ref: ref(), id: uuid(), parent_id: null, title, description: clip(t.description, 20_000), status,
      priority: Number.isInteger(t.priority) && (t.priority as number) >= 0 && (t.priority as number) <= 3 ? (t.priority as number) : 0,
      due_at: due, reminder_at: isoOrNull(t.reminder_at), recurrence: due && RECURRENCE.has(t.recurrence as string) ? (t.recurrence as PlanTodo['recurrence']) : null,
      tags: Array.isArray(t.tags) ? t.tags.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 40).toLowerCase()).slice(0, 10) : [],
      completed_at: status === 'done' ? isoOrNull(t.completed_at) ?? new Date().toISOString() : null, created_at: isoOrNull(t.created_at),
    }
    if (typeof t.id === 'string') idMap.set(t.id, todo.id)
    kept.push({ raw: t, todo, group })
  }
  for (const { raw, todo, group } of kept) {
    const parent = typeof raw.parent_id === 'string' ? idMap.get(raw.parent_id) : undefined
    if (typeof raw.parent_id === 'string' && !parent) w.add('A subtask whose parent is missing was imported as a normal todo')
    todo.parent_id = parent ?? null
    group.todos.push(todo)
  }

  for (const n of notes) {
    const group = groupOf(n.workspace_id)
    if (!group) { w.add('A note belonged to a workspace that is not in the file and was skipped'); continue }
    const content = isObj(n.content) && n.content.type === 'doc' ? (n.content as unknown as PlanNote['content']) : null
    group.notes.push({
      id: uuid(), folder_id: typeof n.folder_id === 'string' ? folderIds.get(n.folder_id) ?? null : null, title: clip(n.title, 300), content,
      text: clip(n.text, 500_000), pinned: n.pinned === true, tags: Array.isArray(n.tags) ? n.tags.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 40).toLowerCase()).slice(0, 10) : [],
      created_at: isoOrNull(n.created_at), updated_at: isoOrNull(n.updated_at),
    })
  }

  const list = [...groups.values()].filter((g) => g.todos.length || g.notes.length)
  if (list.length === 0) return { ok: false, error: 'That file has no todos or notes to import.' }
  return { ok: true, plan: { source: 'json', groups: list, warnings: w.list() } }
}

/** Works out the file type from its name or first character. */
export function sniffFormat(name: string, text: string): 'json' | 'csv' {
  if (/\.json$/i.test(name) || /^\s*[{[]/.test(text)) return 'json'
  return 'csv'
}

export const summarize = (plan: ImportPlan) => ({
  todos: plan.groups.reduce((n, g) => n + g.todos.length, 0),
  notes: plan.groups.reduce((n, g) => n + g.notes.length, 0),
  workspaces: plan.groups.length,
})

export { TODO_CSV_HEADER }
export type { ExportWorkspace, ExportFolder }
