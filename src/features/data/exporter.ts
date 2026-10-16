import { JsonExport, NOTE_CSV_HEADER, noteCsvLine, TODO_CSV_HEADER, todoCsvLine, csvRow, type ExportFolder, type ExportNote, type ExportTodo, type ExportWorkspace } from './formats'

export type SourceWorkspace = Omit<ExportWorkspace, 'private'> & { private: boolean; locked: boolean }

/** Everything the exporter needs from the outside world. Private workspaces come back already decrypted. */
export interface ExportSource {
  workspaces(): Promise<SourceWorkspace[]>
  /** Todos after `afterId` (by id), up to `limit`. */
  todoPage(workspaceId: string, afterId: string | null, limit: number): Promise<ExportTodo[]>
  notePage(workspaceId: string, afterId: string | null, limit: number): Promise<ExportNote[]>
  folders(workspaceId: string): Promise<ExportFolder[]>
}

export type ExportFormat = 'json' | 'csv-todos' | 'csv-notes'
export type ExportOptions = {
  /** Workspace ids to export, or null for all. */
  workspaceIds: string[] | null
  format: ExportFormat
  /** Private workspaces are decrypted into the file, so they are only included when this is true and they are unlocked. */
  includePrivate: boolean
  appVersion: string
  now?: Date
  onProgress?: (p: { phase: string; done: number }) => void
  signal?: AbortSignal
}
export type ExportResult = { blob: Blob; filename: string; counts: { todos: number; notes: number }; skippedPrivate: string[] }

const PAGE = 500

export class ExportCancelled extends Error {
  constructor() { super('Export cancelled') }
}

export async function runExport(src: ExportSource, o: ExportOptions): Promise<ExportResult> {
  const check = () => { if (o.signal?.aborted) throw new ExportCancelled() }
  const all = await src.workspaces()
  const chosen = all.filter((w) => !o.workspaceIds || o.workspaceIds.includes(w.id))

  const skippedPrivate: string[] = []
  const included = chosen.filter((w) => {
    if (!w.private) return true
    if (o.includePrivate && !w.locked) return true
    skippedPrivate.push(w.name)
    return false
  })
  const names = new Map(included.map((w) => [w.id, w.name]))
  const now = o.now ?? new Date()
  const date = now.toISOString().slice(0, 10)
  let todos = 0
  let notes = 0
  const progress = (phase: string) => o.onProgress?.({ phase, done: todos + notes })

  if (o.format === 'json') {
    const json = new JsonExport(
      included.map((w) => ({ id: w.id, name: w.name, color: w.color, icon: w.icon, position: w.position, private: w.private })),
      { exportedAt: now.toISOString(), app: `Todo App ${o.appVersion}`, includesPrivate: included.some((w) => w.private), skippedPrivate },
    )
    for (const w of included) {
      check()
      json.addFolders(await src.folders(w.id))
      for (let after: string | null = null; ; ) {
        check()
        const page: ExportTodo[] = await src.todoPage(w.id, after, PAGE)
        if (!page.length) break
        json.addTodos(page); todos += page.length; progress(`Todos in ${w.name}`)
        after = page[page.length - 1].id
        if (page.length < PAGE) break
      }
      for (let after: string | null = null; ; ) {
        check()
        const page: ExportNote[] = await src.notePage(w.id, after, PAGE)
        if (!page.length) break
        json.addNotes(page); notes += page.length; progress(`Notes in ${w.name}`)
        after = page[page.length - 1].id
        if (page.length < PAGE) break
      }
    }
    return { blob: json.finish().blob, filename: `todo-export-${date}.json`, counts: { todos, notes }, skippedPrivate }
  }

  // CSV: a byte-order mark first so Excel reads accents and non-Latin scripts correctly.
  const lines: string[] = ['﻿' + csvRow(o.format === 'csv-todos' ? TODO_CSV_HEADER : NOTE_CSV_HEADER)]
  for (const w of included) {
    for (let after: string | null = null; ; ) {
      check()
      const page: (ExportTodo | ExportNote)[] = o.format === 'csv-todos' ? await src.todoPage(w.id, after, PAGE) : await src.notePage(w.id, after, PAGE)
      if (!page.length) break
      for (const row of page) lines.push(o.format === 'csv-todos' ? todoCsvLine(row as ExportTodo, names.get(w.id)!) : noteCsvLine(row as ExportNote, names.get(w.id)!))
      if (o.format === 'csv-todos') todos += page.length; else notes += page.length
      progress(w.name)
      after = page[page.length - 1].id
      if (page.length < PAGE) break
    }
  }
  return { blob: new Blob([lines.join('\r\n'), '\r\n'], { type: 'text/csv;charset=utf-8' }), filename: `todo-${o.format === 'csv-todos' ? 'todos' : 'notes'}-${date}.csv`, counts: { todos, notes }, skippedPrivate }
}
