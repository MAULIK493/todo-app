import { beforeEach, describe, expect, it } from 'vitest'
import { FakeDb, todo } from './fakeDb.ts'
import { allowedWorkspaces, createToolExecutor } from './tools.ts'
import type { WorkspaceInfo } from './types.ts'

const NOW = new Date('2026-10-15T10:00:00Z')
const PERSONAL: WorkspaceInfo = { id: 'a0000000-0000-0000-0000-000000000001', name: 'Personal', lock_state: 'none' }
const WORK: WorkspaceInfo = { id: 'a0000000-0000-0000-0000-000000000002', name: 'Work', lock_state: 'none' }
const SECRET: WorkspaceInfo = { id: 'a0000000-0000-0000-0000-000000000003', name: 'Diary', lock_state: 'locked' }
const T1 = '11111111-1111-1111-1111-111111111111'
const T2 = '22222222-2222-2222-2222-222222222222'
const SECRET_TODO = '33333333-3333-3333-3333-333333333333'

let db: FakeDb
let run: ReturnType<typeof createToolExecutor>
const parse = (r: { content: string }) => JSON.parse(r.content)

function setup(workspaces = [PERSONAL, WORK]) {
  db = new FakeDb([PERSONAL, WORK, SECRET])
  db.todos = [
    todo({ id: T1, workspace_id: PERSONAL.id, title: 'Buy milk', due_at: '2026-10-15T08:00:00Z', priority: 2 }),
    todo({ id: T2, workspace_id: WORK.id, title: 'Send invoice' }),
    todo({ id: SECRET_TODO, workspace_id: SECRET.id, title: 'enc:v1:abc:def' }),
  ]
  let n = 0
  run = createToolExecutor({ db, now: NOW, tz: 'UTC', workspaces, newId: () => `confirm-${++n}` })
}
beforeEach(() => setup())

describe('which workspaces the assistant can see', () => {
  it('hides private workspaces always, and any the user switched off', () => {
    const all = [PERSONAL, WORK, SECRET]
    expect(allowedWorkspaces(all, {}).map((w) => w.name)).toEqual(['Personal', 'Work'])
    expect(allowedWorkspaces(all, { [WORK.id]: false }).map((w) => w.name)).toEqual(['Personal'])
    // Even an explicit "allow" can't expose a locked workspace to server-side tools: the server only holds ciphertext.
    expect(allowedWorkspaces(all, { [SECRET.id]: true }).map((w) => w.name)).toEqual(['Personal', 'Work'])
  })

  it('never lists, finds, reads or changes private todos, even by id', async () => {
    expect(JSON.stringify(parse(await run('list_todos', {})))).not.toContain('enc:v1')
    expect(parse(await run('list_workspaces', {})).workspaces.map((w: { name: string }) => w.name)).toEqual(['Personal', 'Work'])
    for (const [name, input] of [
      ['complete_todo', { id: SECRET_TODO }], ['update_todo', { id: SECRET_TODO, title: 'x' }], ['add_subtasks', { parent_id: SECRET_TODO, titles: ['x'] }],
      ['propose_delete_todos', { ids: [SECRET_TODO] }],
    ] as const) {
      const r = await run(name, input)
      expect(r.isError, name).toBe(true)
    }
    expect(db.calls.filter((c) => c.startsWith('complete') || c.startsWith('update') || c.startsWith('subtasks'))).toEqual([])
  })

  it('cannot create into a private or disabled workspace by naming it', async () => {
    expect((await run('create_todo', { title: 'x', workspace: 'Diary' })).isError).toBe(true)
    expect((await run('create_todo', { title: 'x', workspace: SECRET.id })).isError).toBe(true)
    expect(db.calls.filter((c) => c.startsWith('create'))).toEqual([])
  })
})

describe('workspace resolution', () => {
  it('matches by exact name, id or unique partial name, case-insensitively', async () => {
    expect((await run('create_todo', { title: 'a', workspace: 'work' })).isError).toBeUndefined()
    expect((await run('create_todo', { title: 'b', workspace: PERSONAL.id })).isError).toBeUndefined()
    expect((await run('create_todo', { title: 'c', workspace: 'pers' })).isError).toBeUndefined()
    expect(db.calls.filter((c) => c.startsWith('create'))).toEqual([`create:${WORK.id}`, `create:${PERSONAL.id}`, `create:${PERSONAL.id}`])
  })

  it('asks which workspace when it is ambiguous or missing and the choice is real', async () => {
    const r = await run('create_todo', { title: 'x' })
    expect(r.isError).toBe(true)
    expect(parse(r).error).toMatch(/Which workspace.*"Personal".*"Work"/)
    expect(parse(await run('create_todo', { title: 'x', workspace: 'Nope' })).error).toMatch(/No workspace called "Nope"/)
  })

  it('uses the only workspace when there is just one', async () => {
    setup([PERSONAL])
    expect((await run('create_todo', { title: 'solo' })).isError).toBeUndefined()
  })

  it('explains when nothing is available', async () => {
    setup([])
    expect(parse(await run('create_todo', { title: 'x' })).error).toMatch(/turned access off/)
  })
})

describe('reading', () => {
  it('formats todos in the user time zone with overdue flags', async () => {
    const out = parse(await run('list_todos', { view: 'overdue' }))
    const milk = out.todos.find((t: { title: string }) => t.title === 'Buy milk')
    expect(milk).toMatchObject({ priority: 'medium', overdue: true, workspace: 'Personal' })
    expect(milk.due).toMatch(/15 Oct 2026/)
  })

  it('scopes to one workspace', async () => {
    const out = parse(await run('list_todos', { workspace: 'Work' }))
    expect(out.todos.map((t: { title: string }) => t.title)).toEqual(['Send invoice'])
  })

  it('searches and truncates long text', async () => {
    db.todos[0].title = 'x'.repeat(500)
    db.todos[0].description = 'y'.repeat(500)
    const out = parse(await run('search_todos', { query: 'xxx' }))
    expect(out.todos[0].title.length).toBeLessThanOrEqual(200)
    expect(out.todos[0].description_preview.length).toBeLessThanOrEqual(120)
  })

  it('does not hand over notes from private workspaces', async () => {
    db.notes = [
      { id: '10000000-0000-0000-0000-00000000000a', title: 'Trip', text: 'pack bags', workspace_id: PERSONAL.id, updated_at: 'x', pinned: false, tags: [] },
      { id: '10000000-0000-0000-0000-00000000000b', title: 'Trip secret', text: 'pack bags', workspace_id: SECRET.id, updated_at: 'x', pinned: false, tags: [] },
    ]
    expect(parse(await run('search_notes', { query: 'pack' })).notes.map((n: { title: string }) => n.title)).toEqual(['Trip'])
    expect((await run('get_note', { id: '10000000-0000-0000-0000-00000000000b' })).isError).toBe(true)
    expect((await run('get_note', { id: '10000000-0000-0000-0000-00000000000a' })).isError).toBeUndefined()
  })
})

describe('changing things', () => {
  it('creates a todo and reports an Undo-able action', async () => {
    const r = await run('create_todo', { title: 'Call mom', workspace: 'Personal', due_at: '2026-10-16T18:00:00Z', priority: 3 })
    expect(r.actions).toEqual([{ kind: 'todo_created', id: expect.any(String), title: 'Call mom', workspace: 'Personal' }])
    expect(db.todos.at(-1)).toMatchObject({ title: 'Call mom', priority: 3, due_at: '2026-10-16T18:00:00.000Z' })
  })

  it('completes a todo, and is idempotent for finished ones', async () => {
    expect((await run('complete_todo', { id: T1 })).actions?.[0]).toMatchObject({ kind: 'todo_completed', title: 'Buy milk' })
    const again = await run('complete_todo', { id: T1 })
    expect(again.actions).toBeUndefined()
    expect(db.calls.filter((c) => c.startsWith('complete'))).toHaveLength(1)
  })

  it('updates with a readable change list and protects the recurrence rule', async () => {
    const r = await run('update_todo', { id: T2, priority: 3, due_at: '2026-10-20T09:00:00Z', recurrence: 'weekly' })
    expect(r.actions?.[0]).toMatchObject({ kind: 'todo_updated', changes: ['priority → high', expect.stringMatching(/due → .*20 Oct/), 'repeats weekly'] })
    const bad = await run('update_todo', { id: T1, due_at: null, recurrence: 'daily' })
    expect(bad.isError).toBe(true)
    expect((await run('update_todo', { id: T1, recurrence: 'daily' })).isError).toBeUndefined() // T1 already has a due date
    expect(parse(await run('update_todo', { id: T2, recurrence: 'daily', due_at: null })).error).toMatch(/needs a due date/)
  })

  it('refuses to edit a completed todo', async () => {
    db.todos[0].status = 'done'
    expect(parse(await run('update_todo', { id: T1, title: 'x' })).error).toMatch(/already completed/)
  })

  it('returns validation errors to the model instead of throwing', async () => {
    const r = await run('create_todo', { title: 'x', priority: 7, workspace: 'Work' })
    expect(r.isError).toBe(true)
    expect(parse(r).error).toMatch(/Invalid input.*priority/)
    expect(db.calls.filter((c) => c.startsWith('create'))).toEqual([])
    expect((await run('nope', {})).isError).toBe(true)
  })

  it('caps how many changes one request can make', async () => {
    for (let i = 0; i < 25; i++) expect((await run('create_todo', { title: `t${i}`, workspace: 'Work' })).isError).toBeUndefined()
    const r = await run('create_todo', { title: 'one too many', workspace: 'Work' })
    expect(r.isError).toBe(true)
    expect(parse(r).error).toMatch(/at most 25/)
  })

  it('turns database failures into a safe message', async () => {
    db.createTodo = async () => { throw new Error('duplicate key value violates constraint "secret_internal_name"') }
    const r = await run('create_todo', { title: 'x', workspace: 'Work' })
    expect(r.isError).toBe(true)
    expect(r.content).not.toContain('secret_internal_name')
  })
})

describe('destructive actions need the user', () => {
  it('delete only proposes: nothing is deleted and the model is told to wait', async () => {
    const r = await run('propose_delete_todos', { ids: [T1, T2, SECRET_TODO], reason: 'old' })
    expect(r.confirm).toMatchObject({ id: 'confirm-1', kind: 'delete_todos', summary: 'Delete 2 todos (old)' })
    expect(r.confirm?.items.map((i) => i.title)).toEqual(['Buy milk', 'Send invoice'])
    expect(parse(r)).toMatchObject({ status: 'awaiting_user_confirmation', skipped: 1 })
    expect(db.todos).toHaveLength(3)
  })

  it('reschedule proposes with the new time and skips finished todos', async () => {
    db.todos[1].status = 'done'
    const r = await run('propose_reschedule_todos', { ids: [T1, T2], due_at: '2026-10-20T09:00:00Z' })
    expect(r.confirm?.items.map((i) => i.id)).toEqual([T1])
    expect(r.confirm?.due_at).toBe('2026-10-20T09:00:00.000Z')
    expect(db.calls.filter((c) => c.startsWith('update'))).toEqual([])
  })
})
