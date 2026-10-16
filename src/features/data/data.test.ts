import { describe, expect, it } from 'vitest'
import { csvCell, csvRow, FORMAT, JsonExport, noteCsvLine, TODO_CSV_HEADER, todoCsvLine, unguardCell, type ExportNote, type ExportTodo, type ExportWorkspace } from './formats'
import { detectDelimiter, MAX_TODOS, parseCsv, parseJsonExport, parseTodoCsv, sniffFormat, summarize } from './parse'

const todo = (over: Partial<ExportTodo> = {}): ExportTodo => ({
  id: 't1', workspace_id: 'w1', parent_id: null, title: 'Buy milk', description: '', status: 'open', priority: 0, due_at: null, reminder_at: null,
  recurrence: null, tags: [], position: 1, completed_at: null, created_at: '2026-10-01T10:00:00.000Z', ...over,
})
const WS: ExportWorkspace = { id: 'w1', name: 'Home', color: '#22c55e', icon: 'folder', position: 0, private: false }
const OPTS = { timeZone: 'Asia/Kolkata', defaultWorkspace: 'Imported' }

describe('CSV cells', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a, b')).toBe('"a, b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(5)).toBe('5')
    expect(csvRow(['a', 'b,c', undefined])).toBe('a,"b,c",')
  })

  it('defuses spreadsheet formulas', () => {
    for (const evil of ['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1']) {
      const cell = csvCell(evil)
      expect(cell.replace(/^"/, '').startsWith("'"), evil).toBe(true)
    }
    expect(csvCell('2026-10-01')).toBe('2026-10-01') // ordinary text is untouched
    expect(unguardCell("'=SUM(A1)")).toBe('=SUM(A1)')
    expect(unguardCell("'quoted by the user")).toBe("'quoted by the user") // only our own guard is removed
  })
})

describe('parseCsv', () => {
  it('reads quoted cells with commas, escaped quotes and line breaks', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\n"multi\nline",z\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', 'z']])
  })
  it('handles a BOM, old Mac line endings, a missing final newline, blank lines and ragged rows', () => {
    expect(parseCsv('﻿a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']])
    expect(parseCsv('a,b\n\n\nc')).toEqual([['a', 'b'], ['c']])
    expect(parseCsv('a,,c\n')).toEqual([['a', '', 'c']])
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('a;b\n1;2', ';')).toEqual([['a', 'b'], ['1', '2']])
  })
  it('detects the delimiter', () => {
    expect(detectDelimiter('title,due')).toBe(',')
    expect(detectDelimiter('title;due;priority')).toBe(';')
    expect(detectDelimiter('title\tdue')).toBe('\t')
    expect(detectDelimiter('title')).toBe(',')
  })
})

describe('todo CSV import', () => {
  it('imports our own export exactly, including subtasks, tags and awkward text', () => {
    const parent = todo({ id: 'p', title: '=cmd|calc', description: 'line1\nline2, "quoted"', priority: 3, due_at: '2026-10-20T03:30:00.000Z', recurrence: 'weekly', tags: ['work', 'urgent'] })
    const child = todo({ id: 'c', parent_id: 'p', title: 'Sub task', status: 'done', completed_at: '2026-10-02T09:00:00.000Z' })
    const csv = [TODO_CSV_HEADER.join(','), todoCsvLine(parent, 'Home'), todoCsvLine(child, 'Home')].join('\n')

    const r = parseTodoCsv(csv, OPTS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [g] = r.plan.groups
    expect(g.name).toBe('Home')
    const [p, c] = g.todos
    expect(p).toMatchObject({ title: '=cmd|calc', description: 'line1\nline2, "quoted"', priority: 3, due_at: '2026-10-20T03:30:00.000Z', recurrence: 'weekly', tags: ['work', 'urgent'], status: 'open' })
    expect(c).toMatchObject({ title: 'Sub task', status: 'done', completed_at: '2026-10-02T09:00:00.000Z', parent_id: p.id })
  })

  it('understands other apps\' headers and values', () => {
    const csv = 'Task,Project,Priority,Due Date,Labels,Completed\nCall bank,Money,High,2026-10-16,errands; phone,yes\nRead,Money,low,,,no\nBad row,,,,,'
    const r = parseTodoCsv(csv, OPTS)
    expect(r.ok && r.plan.groups.map((g) => g.name)).toEqual(['Money', 'Imported'])
    if (!r.ok) return
    const bank = r.plan.groups[0].todos[0]
    expect(bank).toMatchObject({ title: 'Call bank', priority: 3, status: 'done', tags: ['errands', 'phone'] })
    expect(bank.due_at).toBe('2026-10-16T03:30:00.000Z') // a bare date is 09:00 in the user's zone
    expect(r.plan.groups[0].todos[1]).toMatchObject({ status: 'open', priority: 1, due_at: null })
  })

  it('reads semicolon-separated files and "in progress" statuses', () => {
    const r = parseTodoCsv('title;status\nOne;doing\nTwo;Done', OPTS)
    expect(r.ok && r.plan.groups[0].todos.map((t) => t.status)).toEqual(['in_progress', 'done'])
  })

  it('warns about what it could not understand instead of failing', () => {
    const r = parseTodoCsv('title,priority,due\nA,urgentish,next friday\nB,3,2026-02-30\n,1,\n', OPTS)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.plan.groups[0].todos).toHaveLength(2)
    expect(r.plan.groups[0].todos.every((t) => t.due_at === null)).toBe(true)
    const warnings = r.plan.warnings.join(' | ')
    expect(warnings).toMatch(/Unrecognised priority "urgentish"/)
    expect(warnings).toMatch(/Could not read the date "next friday"/)
    expect(warnings).toMatch(/Could not read the date "2026-02-30"/)
    expect(warnings).toMatch(/Row 4 has no title/)
  })

  it('clamps and cleans values', () => {
    const r = parseTodoCsv(`title,tags,recurrence,due\n${'x'.repeat(900)},"#A, b ,c,d,e,f,g,h,i,j,k,l",every week,\nB,,daily,2026-10-16`, OPTS)
    if (!r.ok) throw new Error(r.error)
    const [a, b] = r.plan.groups[0].todos
    expect(a.title).toHaveLength(500)
    expect(a.tags).toHaveLength(10)
    expect(a.tags[0]).toBe('a')
    expect(a.recurrence).toBeNull() // repeating needs a due date
    expect(b.recurrence).toBe('daily')
  })

  it('gives clear errors for files it cannot use', () => {
    expect(parseTodoCsv('', OPTS)).toMatchObject({ ok: false, error: expect.stringMatching(/header row/) })
    expect(parseTodoCsv('foo,bar\n1,2', OPTS)).toMatchObject({ ok: false, error: expect.stringMatching(/No title column/) })
    expect(parseTodoCsv('title\n\n', OPTS)).toMatchObject({ ok: false })
    expect(parseTodoCsv('title\n' + 'a\n'.repeat(MAX_TODOS + 1), OPTS)).toMatchObject({ ok: false, error: expect.stringMatching(/Too many rows/) })
  })
})

describe('JSON export and import', () => {
  const notes: ExportNote[] = [{ id: 'n1', workspace_id: 'w1', folder_id: 'f1', title: 'Trip', content: { type: 'doc', content: [{ type: 'paragraph' }] }, text: 'pack', pinned: true, tags: ['travel'], created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-02T00:00:00.000Z' }]

  function build(todos: ExportTodo[], ns = notes) {
    const x = new JsonExport([WS], { exportedAt: '2026-10-16T00:00:00Z', app: 'Todo App 1.0.0', includesPrivate: false, skippedPrivate: [] })
    x.addFolders([{ id: 'f1', workspace_id: 'w1', name: 'Travel', position: 0 }])
    for (let i = 0; i < todos.length; i += 2) x.addTodos(todos.slice(i, i + 2)) // chunked, as the exporter writes it
    x.addNotes(ns)
    return x.finish()
  }

  it('produces valid JSON whatever was written, even when sections are empty', async () => {
    const empty = new JsonExport([], { exportedAt: 'x', app: 'a', includesPrivate: false, skippedPrivate: [] }).finish()
    expect(JSON.parse(await empty.blob.text())).toMatchObject({ format: FORMAT, workspaces: [], folders: [], todos: [], notes: [] })
    const full = build([todo({ id: 'a' }), todo({ id: 'b' }), todo({ id: 'c', title: 'quote " and \\ and \n newline' })])
    expect(full.counts).toEqual({ todos: 3, notes: 1, folders: 1 })
    expect(JSON.parse(await full.blob.text()).todos).toHaveLength(3)
  })

  it('round-trips a workspace: nothing is lost or changed', async () => {
    const todos = [
      todo({ id: 'p', title: 'Parent', priority: 2, due_at: '2026-10-20T03:30:00.000Z', recurrence: 'monthly', tags: ['a'], description: 'details' }),
      todo({ id: 'c', parent_id: 'p', title: 'Child', status: 'done', completed_at: '2026-10-05T00:00:00.000Z' }),
      todo({ id: 'd', title: 'Doing', status: 'in_progress' }),
    ]
    const r = parseJsonExport(await build(todos).blob.text())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(summarize(r.plan)).toEqual({ todos: 3, notes: 1, workspaces: 1 })
    const g = r.plan.groups[0]
    expect(g).toMatchObject({ name: 'Home', color: '#22c55e' })
    const [p, c, d] = g.todos
    expect(p).toMatchObject({ title: 'Parent', priority: 2, due_at: '2026-10-20T03:30:00.000Z', recurrence: 'monthly', tags: ['a'], description: 'details' })
    expect(c).toMatchObject({ status: 'done', completed_at: '2026-10-05T00:00:00.000Z', parent_id: p.id })
    expect(d.status).toBe('in_progress')
    expect(new Set([p.id, c.id, d.id]).size).toBe(3)
    expect(p.id).not.toBe('p') // new ids, so importing never collides with existing todos
    expect(g.notes[0]).toMatchObject({ title: 'Trip', pinned: true, tags: ['travel'], text: 'pack', folder_id: g.folders[0].id })
    expect(r.plan.warnings).toEqual([])
  })

  it('rejects files that are not ours, are newer, or are broken', () => {
    expect(parseJsonExport('{nope')).toMatchObject({ ok: false, error: expect.stringMatching(/valid JSON/) })
    expect(parseJsonExport('{"hello":1}')).toMatchObject({ ok: false, error: expect.stringMatching(/exported from this app/) })
    expect(parseJsonExport(JSON.stringify({ format: FORMAT, version: 99 }))).toMatchObject({ ok: false, error: expect.stringMatching(/newer version/) })
    expect(parseJsonExport(JSON.stringify({ format: FORMAT, version: 1, workspaces: [WS], todos: [], notes: [] }))).toMatchObject({ ok: false, error: expect.stringMatching(/no todos or notes/) })
  })

  it('drops bad rows with a warning and repairs dangling references', () => {
    const file = {
      format: FORMAT, version: 1, workspaces: [WS],
      todos: [
        { id: 'a', workspace_id: 'w1', title: 'ok', status: 'weird', priority: 99, due_at: 'garbage', recurrence: 'daily', tags: [1, 'T'] },
        { id: 'b', workspace_id: 'missing', title: 'orphan' },
        { id: 'c', workspace_id: 'w1', title: '' },
        { id: 'd', workspace_id: 'w1', title: 'orphaned subtask', parent_id: 'gone' },
        'not an object',
      ],
      notes: [{ workspace_id: 'nowhere', title: 'x' }],
    }
    const r = parseJsonExport(JSON.stringify(file))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const [a, d] = r.plan.groups[0].todos
    expect(a).toMatchObject({ status: 'open', priority: 0, due_at: null, recurrence: null, tags: ['t'] })
    expect(d.parent_id).toBeNull()
    expect(r.plan.groups[0].todos).toHaveLength(2)
    const w = r.plan.warnings.join(' | ')
    expect(w).toMatch(/workspace that is not in the file/)
    expect(w).toMatch(/no title/)
    expect(w).toMatch(/parent is missing/)
  })

  it('cannot be used to smuggle unsafe values in', () => {
    const file = { format: FORMAT, version: 1, workspaces: [{ id: 'w', name: 'X'.repeat(200), color: 'url(javascript:1)' }], todos: [{ id: 'a', workspace_id: 'w', title: 'T', description: 'd'.repeat(30000) }] }
    const r = parseJsonExport(JSON.stringify(file))
    if (!r.ok) throw new Error(r.error)
    expect(r.plan.groups[0].name).toHaveLength(60)
    expect(r.plan.groups[0].color).toBeNull()
    expect(r.plan.groups[0].todos[0].description).toHaveLength(20000)
  })

  it('exports notes for spreadsheets too', () => {
    expect(noteCsvLine(notes[0], 'Home')).toBe('Home,Trip,pack,travel,true,2026-10-01T00:00:00.000Z,2026-10-02T00:00:00.000Z')
  })

  it('picks the right reader from the file', () => {
    expect(sniffFormat('backup.json', '')).toBe('json')
    expect(sniffFormat('x.csv', 'title\n1')).toBe('csv')
    expect(sniffFormat('noextension', '  {"format":1}')).toBe('json')
  })
})
