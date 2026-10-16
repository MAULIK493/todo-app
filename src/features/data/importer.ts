import type { ImportPlan, PlanGroup, PlanNote, PlanTodo } from './parse'

export type Target = { kind: 'existing'; id: string; name: string; private: boolean } | { kind: 'new'; name: string; color: string }

/** What the importer writes to. The real one encrypts for private workspaces; tests use an in-memory one. */
export interface ImportSink {
  createWorkspace(name: string, color: string): Promise<{ id: string }>
  insertFolders(workspaceId: string, folders: { id: string; name: string }[]): Promise<void>
  insertTodos(workspaceId: string, rows: (Omit<PlanTodo, 'ref' | 'created_at' | 'tags'> & { position: number })[]): Promise<void>
  linkTags(workspaceId: string, links: { todoId: string; tag: string }[]): Promise<void>
  insertNotes(workspaceId: string, notes: Omit<PlanNote, 'tags'>[]): Promise<void>
  tagNotes(noteId: string, tags: string[]): Promise<void>
}

export type ImportResult = { todos: number; notes: number; workspacesCreated: number; warnings: string[] }
export type ImportOptions = { onProgress?: (p: { done: number; total: number }) => void; signal?: AbortSignal }

export class ImportCancelled extends Error {
  result: ImportResult
  constructor(result: ImportResult) { super('Import cancelled'); this.result = result }
}
/** The import stopped part-way; `result` says what already went in so nothing is imported twice by accident. */
export class ImportFailed extends Error {
  result: ImportResult
  constructor(message: string, result: ImportResult) { super(message); this.result = result }
}

export const TODO_BATCH = 200
export const TAG_BATCH = 500
export const NOTE_BATCH = 25

const chunks = <T,>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))

/** Parents must exist before their subtasks, and the file's own order is kept within each group. */
export const parentsFirst = (todos: PlanTodo[]) => [...todos.filter((t) => !t.parent_id), ...todos.filter((t) => t.parent_id)]

export async function runImport(plan: ImportPlan, targets: Target[], sink: ImportSink, o: ImportOptions = {}): Promise<ImportResult> {
  const result: ImportResult = { todos: 0, notes: 0, workspacesCreated: 0, warnings: [] }
  const total = plan.groups.reduce((n, g) => n + g.todos.length + g.notes.length, 0)
  let done = 0
  const tick = (n: number) => { done += n; o.onProgress?.({ done, total }) }
  const check = () => { if (o.signal?.aborted) throw new ImportCancelled(result) }

  try {
    for (const [i, group] of plan.groups.entries()) {
      const target = targets[i]
      if (!target) continue
      check()
      const workspaceId = target.kind === 'new' ? (result.workspacesCreated++, (await sink.createWorkspace(target.name, target.color)).id) : target.id
      const isPrivate = target.kind === 'existing' && target.private
      await importGroup(group, workspaceId, isPrivate, sink, result, check, tick)
    }
  } catch (e) {
    if (e instanceof ImportCancelled) throw e
    throw new ImportFailed(e instanceof Error ? e.message : 'The import failed', result)
  }
  return result
}

async function importGroup(g: PlanGroup, ws: string, isPrivate: boolean, sink: ImportSink, result: ImportResult, check: () => void, tick: (n: number) => void) {
  // Private workspaces have no tags or folders (their names would be visible to the server), so those are left out.
  if (isPrivate && (g.folders.length || g.todos.some((t) => t.tags.length) || g.notes.some((n) => n.tags.length || n.folder_id))) {
    result.warnings.push(`“${g.name}” was imported into a private workspace, which has no tags or folders, so those were left out.`)
  }
  if (!isPrivate && g.folders.length) await sink.insertFolders(ws, g.folders)

  // Newest-first lists order by position, so imported todos sit at the top in the order they had in the file.
  const base = -Date.now() / 1000
  const ordered = parentsFirst(g.todos)
  const positionOf = new Map(g.todos.map((t, i) => [t.id, base + i * 0.0001]))

  for (const batch of chunks(ordered, TODO_BATCH)) {
    check()
    await sink.insertTodos(ws, batch.map(({ ref: _r, created_at: _c, tags: _t, ...t }) => ({ ...t, position: positionOf.get(t.id)! })))
    result.todos += batch.length
    tick(batch.length)
  }

  if (!isPrivate) {
    const links = g.todos.flatMap((t) => t.tags.map((tag) => ({ todoId: t.id, tag })))
    for (const batch of chunks(links, TAG_BATCH)) { check(); await sink.linkTags(ws, batch) }
  }

  for (const batch of chunks(g.notes, NOTE_BATCH)) {
    check()
    await sink.insertNotes(ws, batch.map(({ tags: _t, ...n }) => (isPrivate ? { ...n, folder_id: null } : n)))
    if (!isPrivate) for (const n of batch) if (n.tags.length) await sink.tagNotes(n.id, n.tags)
    result.notes += batch.length
    tick(batch.length)
  }
}
