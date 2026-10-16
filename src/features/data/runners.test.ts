import { describe, expect, it, vi } from 'vitest'
import { ExportCancelled, runExport, type ExportSource, type SourceWorkspace } from './exporter'
import type { ExportFolder, ExportNote, ExportTodo } from './formats'
import { ImportCancelled, ImportFailed, NOTE_BATCH, parentsFirst, runImport, TODO_BATCH, type ImportSink } from './importer'
import { parseJsonExport, type ImportPlan, type PlanNote, type PlanTodo } from './parse'

const ws = (id: string, name: string, over: Partial<SourceWorkspace> = {}): SourceWorkspace => ({ id, name, color: '#7c5cff', icon: 'folder', position: 0, private: false, locked: false, ...over })
const mkTodo = (id: string, workspace_id: string, over: Partial<ExportTodo> = {}): ExportTodo => ({
  id, workspace_id, parent_id: null, title: `Todo ${id}`, description: '', status: 'open', priority: 0, due_at: null, reminder_at: null, recurrence: null,
  tags: [], position: 0, completed_at: null, created_at: '2026-10-01T00:00:00.000Z', ...over,
})
const mkNote = (id: string, workspace_id: string): ExportNote => ({ id, workspace_id, folder_id: null, title: `Note ${id}`, content: null, text: 'text', pinned: false, tags: [], created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z' })

function source(data: { workspaces: SourceWorkspace[]; todos: ExportTodo[]; notes?: ExportNote[]; folders?: ExportFolder[] }) {
  const pages = { todo: vi.fn(), note: vi.fn() }
  const src: ExportSource = {
    workspaces: async () => data.workspaces,
    folders: async (id) => (data.folders ?? []).filter((f) => f.workspace_id === id),
    todoPage: async (id, after, limit) => { pages.todo(id, after, limit); return data.todos.filter((t) => t.workspace_id === id && (!after || t.id > after)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit) },
    notePage: async (id, after, limit) => { pages.note(id, after, limit); return (data.notes ?? []).filter((n) => n.workspace_id === id && (!after || n.id > after)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit) },
  }
  return { src, pages }
}
const base = { workspaceIds: null, includePrivate: false, appVersion: '1.0.0', now: new Date('2026-10-16T12:00:00Z') }

describe('runExport', () => {
  it('walks every page of a large workspace and the JSON reads back completely', async () => {
    const todos = Array.from({ length: 1234 }, (_, i) => mkTodo(`t${String(i).padStart(5, '0')}`, 'w1'))
    const { src, pages } = source({ workspaces: [ws('w1', 'Big')], todos, notes: [mkNote('n1', 'w1')] })
    const r = await runExport(src, { ...base, format: 'json' })
    expect(r.counts).toEqual({ todos: 1234, notes: 1 })
    expect(r.filename).toBe('todo-export-2026-10-16.json')
    expect(pages.todo).toHaveBeenCalledTimes(3) // 500 + 500 + 234
    const parsed = parseJsonExport(await r.blob.text())
    expect(parsed.ok && parsed.plan.groups[0].todos).toHaveLength(1234)
  })

  it('exports only the chosen workspaces', async () => {
    const { src } = source({ workspaces: [ws('w1', 'A'), ws('w2', 'B')], todos: [mkTodo('a', 'w1'), mkTodo('b', 'w2')] })
    const r = await runExport(src, { ...base, workspaceIds: ['w2'], format: 'csv-todos' })
    expect(r.counts.todos).toBe(1)
    const text = await r.blob.text()
    expect(text).toContain('Todo b')
    expect(text).not.toContain('Todo a')
  })

  it('writes CSV with a byte-order mark, a header row and CRLF line ends', async () => {
    const { src } = source({ workspaces: [ws('w1', 'Home')], todos: [mkTodo('a', 'w1', { title: 'Päivä, ok' })] })
    const { blob } = await runExport(src, { ...base, format: 'csv-todos' })
    expect([...new Uint8Array(await blob.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]) // UTF-8 byte-order mark (text() would hide it)
    const text = await blob.text()
    expect(text.split('\r\n')[0]).toMatch(/^workspace,title,description/)
    expect(text).toContain('Home,"Päivä, ok"')
  })

  it('skips private workspaces unless asked and unlocked, and says which', async () => {
    const todos = [mkTodo('a', 'w1'), mkTodo('s', 'w2'), mkTodo('l', 'w3')]
    const workspaces = [ws('w1', 'Plain'), ws('w2', 'Diary', { private: true }), ws('w3', 'Vault', { private: true, locked: true })]
    const { src } = source({ workspaces, todos })
    const off = await runExport(src, { ...base, format: 'csv-todos' })
    expect(off.counts.todos).toBe(1)
    expect(off.skippedPrivate).toEqual(['Diary', 'Vault'])
    const on = await runExport(src, { ...base, format: 'csv-todos', includePrivate: true })
    expect(on.counts.todos).toBe(2) // the unlocked one; the locked one can never be read
    expect(on.skippedPrivate).toEqual(['Vault'])
    const json = JSON.parse(await (await runExport(src, { ...base, format: 'json', includePrivate: true })).blob.text())
    expect(json.meta).toMatchObject({ includesPrivate: true, skippedPrivate: ['Vault'] })
  })

  it('can be cancelled between pages', async () => {
    const todos = Array.from({ length: 1200 }, (_, i) => mkTodo(`t${String(i).padStart(5, '0')}`, 'w1'))
    const { src } = source({ workspaces: [ws('w1', 'Big')], todos })
    const controller = new AbortController()
    await expect(runExport(src, { ...base, format: 'json', signal: controller.signal, onProgress: () => controller.abort() })).rejects.toBeInstanceOf(ExportCancelled)
  })

  it('reports progress as it goes', async () => {
    const todos = Array.from({ length: 600 }, (_, i) => mkTodo(`t${String(i).padStart(5, '0')}`, 'w1'))
    const { src } = source({ workspaces: [ws('w1', 'Big')], todos })
    const seen: number[] = []
    await runExport(src, { ...base, format: 'csv-todos', onProgress: (p) => seen.push(p.done) })
    expect(seen).toEqual([500, 600])
  })
})

// ---------------------------------------------------------------------------------------------------------------------

const pt = (id: string, over: Partial<PlanTodo> = {}): PlanTodo => ({
  ref: `r-${id}`, id, parent_id: null, title: `T${id}`, description: '', status: 'open', priority: 0, due_at: null, reminder_at: null, recurrence: null, tags: [], completed_at: null, created_at: null, ...over,
})
const pn = (id: string, over: Partial<PlanNote> = {}): PlanNote => ({ id, folder_id: null, title: id, content: null, text: '', pinned: false, tags: [], created_at: null, updated_at: null, ...over })
const plan = (todos: PlanTodo[], notes: PlanNote[] = [], folders: { id: string; name: string }[] = []): ImportPlan => ({ source: 'json', warnings: [], groups: [{ name: 'Home', color: '#22c55e', folders, todos, notes }] })

function sink() {
  const log = { workspaces: [] as string[], todoBatches: [] as { id: string; parent_id: string | null; position: number }[][], tags: [] as { todoId: string; tag: string }[][], notes: [] as string[][], noteTags: [] as string[], folders: [] as string[][] }
  const s: ImportSink = {
    createWorkspace: async (name) => { log.workspaces.push(name); return { id: 'new-ws' } },
    insertFolders: async (_w, f) => { log.folders.push(f.map((x) => x.name)) },
    insertTodos: async (_w, rows) => { log.todoBatches.push(rows.map((r) => ({ id: r.id, parent_id: r.parent_id, position: r.position }))) },
    linkTags: async (_w, links) => { log.tags.push(links) },
    insertNotes: async (_w, notes) => { log.notes.push(notes.map((n) => n.id)) },
    tagNotes: async (id) => { log.noteTags.push(id) },
  }
  return { s, log }
}
const existing = { kind: 'existing' as const, id: 'ws-1', name: 'Mine', private: false }

describe('runImport', () => {
  it('writes todos in batches, parents before subtasks, keeping the file\'s order', async () => {
    const todos = [pt('child', { parent_id: 'parent' }), pt('a'), pt('parent'), pt('b')]
    const { s, log } = sink()
    const r = await runImport(plan(todos), [existing], s)
    expect(r.todos).toBe(4)
    const order = log.todoBatches.flat().map((t) => t.id)
    expect(order).toEqual(['a', 'parent', 'b', 'child'])
    expect(order.indexOf('parent')).toBeLessThan(order.indexOf('child'))
    const pos = new Map(log.todoBatches.flat().map((t) => [t.id, t.position]))
    expect([pos.get('child')!, pos.get('a')!, pos.get('parent')!, pos.get('b')!]).toEqual([...[pos.get('child')!, pos.get('a')!, pos.get('parent')!, pos.get('b')!]].sort((x, y) => x - y)) // file order
    expect(pos.get('a')!).toBeLessThan(0) // sits at the top of the list, like a new todo
  })

  it('splits large imports into the agreed batch sizes', async () => {
    const todos = Array.from({ length: TODO_BATCH * 2 + 5 }, (_, i) => pt(`t${i}`))
    const notes = Array.from({ length: NOTE_BATCH + 1 }, (_, i) => pn(`n${i}`))
    const { s, log } = sink()
    await runImport(plan(todos, notes), [existing], s)
    expect(log.todoBatches.map((b) => b.length)).toEqual([TODO_BATCH, TODO_BATCH, 5])
    expect(log.notes.map((b) => b.length)).toEqual([NOTE_BATCH, 1])
  })

  it('creates a new workspace when asked, and attaches tags and folders', async () => {
    const { s, log } = sink()
    const r = await runImport(plan([pt('a', { tags: ['x', 'y'] })], [pn('n', { tags: ['z'] })], [{ id: 'f', name: 'Folder' }]), [{ kind: 'new', name: 'Imported', color: '#ff0000' }], s)
    expect(log.workspaces).toEqual(['Imported'])
    expect(r.workspacesCreated).toBe(1)
    expect(log.tags.flat()).toEqual([{ todoId: 'a', tag: 'x' }, { todoId: 'a', tag: 'y' }])
    expect(log.noteTags).toEqual(['n'])
    expect(log.folders).toEqual([['Folder']])
  })

  it('leaves tags and folders out of a private workspace, and says so', async () => {
    const { s, log } = sink()
    const r = await runImport(plan([pt('a', { tags: ['x'] })], [pn('n', { folder_id: 'f' })], [{ id: 'f', name: 'F' }]), [{ ...existing, private: true }], s)
    expect(log.tags).toEqual([])
    expect(log.folders).toEqual([])
    expect(log.noteTags).toEqual([])
    expect(r.warnings.join(' ')).toMatch(/private workspace.*no tags or folders/)
    expect(r.todos).toBe(1)
  })

  it('skips groups that have no target', async () => {
    const { s, log } = sink()
    const two: ImportPlan = { ...plan([pt('a')]), groups: [...plan([pt('a')]).groups, { ...plan([pt('b')]).groups[0], name: 'Second' }] }
    await runImport(two, [existing, undefined as never], s)
    expect(log.todoBatches.flat().map((t) => t.id)).toEqual(['a'])
  })

  it('reports progress', async () => {
    const { s } = sink()
    const seen: string[] = []
    await runImport(plan(Array.from({ length: 250 }, (_, i) => pt(`t${i}`)), [pn('n')]), [existing], s, { onProgress: (p) => seen.push(`${p.done}/${p.total}`) })
    expect(seen).toEqual(['200/251', '250/251', '251/251'])
  })

  it('stops cleanly when cancelled, saying what was already imported', async () => {
    const { s, log } = sink()
    const controller = new AbortController()
    const todos = Array.from({ length: TODO_BATCH * 3 }, (_, i) => pt(`t${i}`))
    const slow: ImportSink = { ...s, insertTodos: async (w, rows) => { await s.insertTodos(w, rows); controller.abort() } }
    const err = await runImport(plan(todos), [existing], slow, { signal: controller.signal }).catch((e) => e)
    expect(err).toBeInstanceOf(ImportCancelled)
    expect(err.result.todos).toBe(TODO_BATCH)
    expect(log.todoBatches).toHaveLength(1)
  })

  it('on failure, reports exactly how far it got', async () => {
    const { s } = sink()
    let calls = 0
    const flaky: ImportSink = { ...s, insertTodos: async (w, rows) => { if (++calls === 2) throw new Error('connection lost'); await s.insertTodos(w, rows) } }
    const err = await runImport(plan(Array.from({ length: TODO_BATCH * 3 }, (_, i) => pt(`t${i}`))), [existing], flaky).catch((e) => e)
    expect(err).toBeInstanceOf(ImportFailed)
    expect(err.message).toBe('connection lost')
    expect(err.result.todos).toBe(TODO_BATCH)
  })

  it('parentsFirst keeps relative order inside each group', () => {
    expect(parentsFirst([pt('c1', { parent_id: 'p' }), pt('p'), pt('c2', { parent_id: 'p' }), pt('q')]).map((t) => t.id)).toEqual(['p', 'q', 'c1', 'c2'])
  })
})
