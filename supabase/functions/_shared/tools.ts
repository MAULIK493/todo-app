import { formatLocal, zonedDayRange, zonedWeekStart } from './dates.ts'
import { parseToolInput, type ToolInputs, type ToolName } from './schemas.ts'
import type { Action, ConfirmRequest, Db, TodoRow, WorkspaceInfo } from './types.ts'

export type ToolContext = {
  db: Db
  now: Date
  tz: string
  /** Only the workspaces the assistant may see. Everything below is limited to these. */
  workspaces: WorkspaceInfo[]
  newId: () => string
}

export type ToolOutcome = {
  /** JSON text handed back to the model. */
  content: string
  isError?: boolean
  actions?: Action[]
  confirm?: ConfirmRequest
}

/** A workspace is visible to the server-side assistant only if it is not private and the user hasn't turned it off. */
export function allowedWorkspaces(all: WorkspaceInfo[], access: Record<string, boolean>): WorkspaceInfo[] {
  return all.filter((w) => w.lock_state === 'none' && access[w.id] !== false)
}

const MAX_MUTATIONS = 25
const PRIORITY_NAMES = ['none', 'low', 'medium', 'high']

const json = (value: unknown): ToolOutcome => ({ content: JSON.stringify(value) })
const failure = (message: string): ToolOutcome => ({ content: JSON.stringify({ error: message }), isError: true })
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function createToolExecutor(ctx: ToolContext) {
  const { db, now, tz } = ctx
  const byId = new Map(ctx.workspaces.map((w) => [w.id, w]))
  let mutations = 0

  const today = () => {
    const { start, end } = zonedDayRange(tz, now)
    return { start: start.toISOString(), end: end.toISOString(), now: now.toISOString() }
  }

  const fmtTodo = (t: TodoRow) => ({
    id: t.id,
    title: clip(t.title, 200),
    status: t.status,
    priority: PRIORITY_NAMES[t.priority],
    due: t.due_at ? formatLocal(tz, new Date(t.due_at)) : null,
    due_iso: t.due_at,
    overdue: t.status !== 'done' && !!t.due_at && new Date(t.due_at) < now,
    repeats: t.recurrence,
    workspace: byId.get(t.workspace_id)?.name ?? null,
    tags: t.tags,
    subtasks: t.subtask_count,
    description_preview: t.description ? clip(t.description, 120) : undefined,
  })

  /** Resolve a name or id to one allowed workspace, or explain what the options are. */
  function resolve(ref: string | undefined): { ws: WorkspaceInfo } | { error: string } {
    const options = ctx.workspaces.map((w) => `"${w.name}"`).join(', ')
    if (ctx.workspaces.length === 0) return { error: 'No workspaces are available to the assistant. The user may have turned access off.' }
    if (!ref) {
      return ctx.workspaces.length === 1 ? { ws: ctx.workspaces[0] } : { error: `Which workspace? Options: ${options}.` }
    }
    const exactId = byId.get(ref)
    if (exactId) return { ws: exactId }
    const q = ref.trim().toLowerCase()
    const exact = ctx.workspaces.filter((w) => w.name.toLowerCase() === q)
    if (exact.length === 1) return { ws: exact[0] }
    const partial = exact.length ? exact : ctx.workspaces.filter((w) => w.name.toLowerCase().includes(q))
    if (partial.length === 1) return { ws: partial[0] }
    return { error: partial.length ? `"${ref}" matches several workspaces (${partial.map((w) => `"${w.name}"`).join(', ')}). Be more specific.` : `No workspace called "${ref}". Options: ${options}.` }
  }

  function scope(ref: string | undefined): { ids: string[] } | { error: string } {
    if (!ref) return { ids: ctx.workspaces.map((w) => w.id) }
    const r = resolve(ref)
    return 'error' in r ? r : { ids: [r.ws.id] }
  }

  /** Todos by id, restricted to workspaces the assistant may touch (a private todo's id is simply "not found"). */
  async function accessibleTodos(ids: string[]) {
    const rows = await db.getTodos(ids)
    return rows.filter((r) => byId.has(r.workspace_id))
  }

  function allowMutation(count = 1): ToolOutcome | null {
    if (mutations + count > MAX_MUTATIONS) return failure(`Stopped: at most ${MAX_MUTATIONS} changes per request. Ask the user whether to continue.`)
    mutations += count
    return null
  }

  const handlers: { [N in ToolName]: (input: ToolInputs[N]) => Promise<ToolOutcome> } = {
    async list_workspaces() {
      const counts = await db.counts(ctx.workspaces.map((w) => w.id), today(), zonedWeekStart(tz, now).toISOString())
      return json({
        workspaces: ctx.workspaces.map((w) => {
          const c = counts.find((x) => x.workspace_id === w.id)
          return { id: w.id, name: w.name, open_todos: (c?.open ?? 0) + (c?.in_progress ?? 0) }
        }),
      })
    },

    async list_todos(input) {
      const s = scope(input.workspace)
      if ('error' in s) return failure(s.error)
      const rows = await db.listTodos({
        workspaceIds: s.ids, view: input.view, minPriority: input.min_priority, tag: input.tag ?? null, limit: input.limit, today: today(),
      })
      return json({ view: input.view, count: rows.length, more_may_exist: rows.length === input.limit, todos: rows.map(fmtTodo) })
    },

    async search_todos(input) {
      const s = scope(input.workspace)
      if ('error' in s) return failure(s.error)
      const rows = await db.searchTodos({ workspaceIds: s.ids, query: input.query, includeDone: input.include_completed, limit: input.limit })
      return json({ count: rows.length, todos: rows.map(fmtTodo) })
    },

    async create_todo(input) {
      const r = resolve(input.workspace)
      if ('error' in r) return failure(r.error)
      const blocked = allowMutation()
      if (blocked) return blocked
      const created = await db.createTodo({
        workspace_id: r.ws.id,
        title: input.title,
        description: input.description,
        priority: input.priority,
        due_at: input.due_at?.toISOString() ?? null,
        recurrence: input.recurrence ?? null,
        tags: input.tags,
      })
      return {
        ...json({ created: true, id: created.id, title: created.title, workspace: r.ws.name, due: input.due_at ? formatLocal(tz, input.due_at) : null }),
        actions: [{ kind: 'todo_created', id: created.id, title: created.title, workspace: r.ws.name }],
      }
    },

    async update_todo(input) {
      const [row] = await accessibleTodos([input.id])
      if (!row) return failure('Todo not found.')
      const blocked = allowMutation()
      if (blocked) return blocked

      const changes: string[] = []
      const patch: Parameters<Db['updateTodo']>[1] = {}
      if (input.title !== undefined) { patch.title = input.title; changes.push('title') }
      if (input.description !== undefined) { patch.description = input.description; changes.push('description') }
      if (input.priority !== undefined) { patch.priority = input.priority; changes.push(`priority → ${PRIORITY_NAMES[input.priority]}`) }
      if (input.status !== undefined) { patch.status = input.status; changes.push(`status → ${input.status === 'open' ? 'to do' : 'in progress'}`) }
      if (input.due_at !== undefined) {
        patch.due_at = input.due_at ? input.due_at.toISOString() : null
        changes.push(input.due_at ? `due → ${formatLocal(tz, input.due_at)}` : 'due date removed')
      }
      if (input.recurrence !== undefined) {
        patch.recurrence = input.recurrence
        changes.push(input.recurrence ? `repeats ${input.recurrence}` : 'no longer repeats')
      }
      // The database requires a due date for recurring todos; say so instead of surfacing a constraint error.
      const finalDue = input.due_at !== undefined ? input.due_at : row.due_at
      const finalRecurrence = input.recurrence !== undefined ? input.recurrence : row.recurrence
      if (finalRecurrence && !finalDue) {
        mutations--
        return failure('A repeating todo needs a due date. Set due_at too, or stop it repeating.')
      }
      if (row.status === 'done') {
        mutations--
        return failure('That todo is already completed. Only open todos can be edited.')
      }

      await db.updateTodo(row.id, patch)
      return { ...json({ updated: true, id: row.id, changes }), actions: [{ kind: 'todo_updated', id: row.id, title: patch.title ?? row.title, changes }] }
    },

    async complete_todo(input) {
      const [row] = await accessibleTodos([input.id])
      if (!row) return failure('Todo not found.')
      if (row.status === 'done') return json({ completed: false, note: 'It was already completed.' })
      const blocked = allowMutation()
      if (blocked) return blocked
      await db.completeTodo(row.id)
      return { ...json({ completed: true, id: row.id, title: row.title, repeats: row.recurrence }), actions: [{ kind: 'todo_completed', id: row.id, title: row.title }] }
    },

    async add_subtasks(input) {
      const [parent] = await accessibleTodos([input.parent_id])
      if (!parent) return failure('Todo not found.')
      if (parent.parent_id) return failure('Subtasks cannot have their own subtasks.')
      const blocked = allowMutation()
      if (blocked) return blocked
      const count = await db.addSubtasks(parent.id, parent.workspace_id, input.titles)
      return { ...json({ added: count, parent: parent.title }), actions: [{ kind: 'subtasks_added', parent_id: parent.id, parent_title: parent.title, count }] }
    },

    async create_note(input) {
      const r = resolve(input.workspace)
      if ('error' in r) return failure(r.error)
      const blocked = allowMutation()
      if (blocked) return blocked
      const note = await db.createNote({ workspace_id: r.ws.id, title: input.title, body: input.body, tags: input.tags })
      return { ...json({ created: true, id: note.id, title: note.title, workspace: r.ws.name }), actions: [{ kind: 'note_created', id: note.id, title: note.title, workspace: r.ws.name }] }
    },

    async search_notes(input) {
      const s = scope(input.workspace)
      if ('error' in s) return failure(s.error)
      const rows = await db.searchNotes({ workspaceIds: s.ids, query: input.query, limit: input.limit })
      return json({
        count: rows.length,
        notes: rows.map((n) => ({ id: n.id, title: clip(n.title || 'Untitled', 150), workspace: byId.get(n.workspace_id)?.name ?? null, excerpt: clip(n.text, 300), tags: n.tags, pinned: n.pinned })),
      })
    },

    async get_note(input) {
      const note = await db.getNote(input.id)
      if (!note || !byId.has(note.workspace_id)) return failure('Note not found.')
      return json({ id: note.id, title: note.title || 'Untitled', workspace: byId.get(note.workspace_id)?.name, tags: note.tags, text: clip(note.text, 8000), truncated: note.text.length > 8000 })
    },

    async get_stats() {
      const counts = await db.counts(ctx.workspaces.map((w) => w.id), today(), zonedWeekStart(tz, now).toISOString())
      const rewards = await db.rewards()
      return json({
        workspaces: counts.map((c) => ({ workspace: byId.get(c.workspace_id)?.name, to_do: c.open, in_progress: c.in_progress, overdue: c.overdue, due_today: c.due_today, completed_this_week: c.completed_this_week })),
        progress: rewards,
      })
    },

    async propose_delete_todos(input) {
      const rows = await accessibleTodos(input.ids)
      if (rows.length === 0) return failure('None of those todos were found.')
      const confirm: ConfirmRequest = {
        id: ctx.newId(),
        kind: 'delete_todos',
        summary: `Delete ${rows.length} todo${rows.length === 1 ? '' : 's'}${input.reason ? ` (${input.reason})` : ''}`,
        items: rows.map((r) => ({ id: r.id, title: clip(r.title, 120) })),
      }
      return {
        ...json({ status: 'awaiting_user_confirmation', todos: rows.length, skipped: input.ids.length - rows.length, instruction: 'The user now sees Confirm and Cancel buttons. Nothing has been deleted. Say you are waiting for their confirmation.' }),
        confirm,
      }
    },

    async propose_reschedule_todos(input) {
      const rows = (await accessibleTodos(input.ids)).filter((r) => r.status !== 'done')
      if (rows.length === 0) return failure('None of those todos were found or they are already completed.')
      const confirm: ConfirmRequest = {
        id: ctx.newId(),
        kind: 'reschedule_todos',
        summary: `Move ${rows.length} todo${rows.length === 1 ? '' : 's'} to ${formatLocal(tz, input.due_at)}`,
        items: rows.map((r) => ({ id: r.id, title: clip(r.title, 120) })),
        due_at: input.due_at.toISOString(),
      }
      return {
        ...json({ status: 'awaiting_user_confirmation', todos: rows.length, instruction: 'The user now sees Confirm and Cancel buttons. Nothing has changed yet. Say you are waiting for their confirmation.' }),
        confirm,
      }
    },
  }

  return async function execute(name: string, rawInput: unknown): Promise<ToolOutcome> {
    if (!(name in handlers)) return failure(`Unknown tool "${name}".`)
    const parsed = parseToolInput(name as ToolName, rawInput, tz)
    if (!parsed.ok) return failure(`Invalid input: ${parsed.error}`)
    try {
      return await (handlers[name as ToolName] as (i: unknown) => Promise<ToolOutcome>)(parsed.value)
    } catch (e) {
      // Database errors are shown to the model as a short message; details stay in the server log.
      console.error(`tool ${name} failed`, e)
      return failure('That action failed. Tell the user it could not be completed.')
    }
  }
}
