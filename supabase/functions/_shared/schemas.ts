import { parseDueAt } from './dates.ts'
import type { Recurrence, TodoView } from './types.ts'

/** Tool definition as sent to the Messages API. */
export type ToolDef = {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties: false }
  // Tool inputs stream as they are generated. The API then no longer validates them, which is why every
  // call below goes through parseToolInput() before anything runs.
  eager_input_streaming: true
}

const WORKSPACE = { type: 'string', description: 'Workspace name or id. Optional only when the user has a single workspace.' }
const DUE = {
  type: 'string',
  description:
    'Due date/time. Prefer ISO 8601 with the user\'s UTC offset (e.g. 2026-10-16T18:00:00+05:30). A bare local time ("2026-10-16T18:00") is read in the user\'s time zone; a bare date means 09:00.',
}
const PRIORITY = { type: 'integer', minimum: 0, maximum: 3, description: '0 none, 1 low, 2 medium, 3 high' }
const ID = { type: 'string', description: 'The id returned by a previous list/search call' }

const def = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  name, description, input_schema: { type: 'object', properties, required, additionalProperties: false }, eager_input_streaming: true,
})

export const TOOLS: ToolDef[] = [
  def('list_workspaces', 'List the workspaces you can see, with their ids and how many open todos each has. Call this first if you are unsure which workspace the user means.', {}),
  def('list_todos', 'List todos. Use this for "what\'s pending / due today / overdue" questions. Returns the most relevant first (by due date or position).', {
    workspace: { ...WORKSPACE, description: 'Limit to one workspace (name or id). Omit for all visible workspaces.' },
    view: { type: 'string', enum: ['open', 'today', 'overdue', 'upcoming', 'in_progress', 'completed'], description: 'Default: open' },
    min_priority: { ...PRIORITY, description: 'Only todos at or above this priority' },
    tag: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 25' },
  }),
  def('search_todos', 'Search todo titles and descriptions by words.', {
    query: { type: 'string', description: 'Words to look for' },
    workspace: WORKSPACE,
    include_completed: { type: 'boolean', description: 'Default false' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  }, ['query']),
  def('create_todo', 'Create a todo. Use it when the user asks you to add, remind, or note a task. It is created immediately and the user sees an Undo button.', {
    title: { type: 'string', description: 'Short, imperative title' },
    workspace: WORKSPACE,
    description: { type: 'string' },
    priority: PRIORITY,
    due_at: DUE,
    recurrence: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'Needs due_at' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Up to 10 short tags' },
  }, ['title']),
  def('update_todo', 'Change a todo\'s title, description, priority, due date, recurrence or status (open / in_progress). Use complete_todo to finish one.', {
    id: ID,
    title: { type: 'string' },
    description: { type: 'string' },
    priority: PRIORITY,
    due_at: { ...DUE, description: DUE.description + ' Send null to remove the due date.', type: ['string', 'null'] },
    recurrence: { type: ['string', 'null'], enum: ['daily', 'weekly', 'monthly', null], description: 'null stops repeating' },
    status: { type: 'string', enum: ['open', 'in_progress'] },
  }, ['id']),
  def('complete_todo', 'Mark a todo as done. This earns the user XP, so only do it when they say it is finished.', { id: ID }, ['id']),
  def('add_subtasks', 'Break a todo down by adding subtasks to it.', {
    parent_id: ID,
    titles: { type: 'array', items: { type: 'string' }, description: '1 to 20 short subtask titles' },
  }, ['parent_id', 'titles']),
  def('create_note', 'Create a note. Use blank lines between paragraphs, "- " for bullets and "## " for headings.', {
    title: { type: 'string' },
    body: { type: 'string', description: 'The note text' },
    workspace: WORKSPACE,
    tags: { type: 'array', items: { type: 'string' } },
  }, ['title', 'body']),
  def('search_notes', 'Search notes by words. Returns titles and short excerpts; use get_note for the full text.', {
    query: { type: 'string' }, workspace: WORKSPACE, limit: { type: 'integer', minimum: 1, maximum: 20 },
  }, ['query']),
  def('get_note', 'Read the full text of one note.', { id: ID }, ['id']),
  def('get_stats', 'Progress overview: counts per workspace (open, overdue, due today, done this week) plus level, XP, coins, streak and goals.', {}),
  def('propose_delete_todos', 'Ask the user to confirm deleting todos. NOTHING is deleted until they press Confirm, so never say it is done. Deleting is the only way to remove todos; use it only when asked.', {
    ids: { type: 'array', items: ID, description: '1 to 100 todo ids' },
    reason: { type: 'string', description: 'Why, in a few words' },
  }, ['ids']),
  def('propose_reschedule_todos', 'Ask the user to confirm moving several todos to a new due date. Nothing changes until they press Confirm. For a single todo use update_todo instead.', {
    ids: { type: 'array', items: ID, description: '2 to 100 todo ids' },
    due_at: DUE,
  }, ['ids', 'due_at']),
]

export type ToolName =
  | 'list_workspaces' | 'list_todos' | 'search_todos' | 'create_todo' | 'update_todo' | 'complete_todo' | 'add_subtasks'
  | 'create_note' | 'search_notes' | 'get_note' | 'get_stats' | 'propose_delete_todos' | 'propose_reschedule_todos'

export type ToolInputs = {
  list_workspaces: Record<string, never>
  list_todos: { workspace?: string; view: TodoView; min_priority: number; tag?: string; limit: number }
  search_todos: { query: string; workspace?: string; include_completed: boolean; limit: number }
  create_todo: { title: string; workspace?: string; description?: string; priority?: number; due_at?: Date; recurrence?: Recurrence; tags: string[] }
  update_todo: {
    id: string; title?: string; description?: string; priority?: number; due_at?: Date | null; recurrence?: Recurrence | null; status?: 'open' | 'in_progress'
  }
  complete_todo: { id: string }
  add_subtasks: { parent_id: string; titles: string[] }
  create_note: { title: string; body: string; workspace?: string; tags: string[] }
  search_notes: { query: string; workspace?: string; limit: number }
  get_note: { id: string }
  get_stats: Record<string, never>
  propose_delete_todos: { ids: string[]; reason?: string }
  propose_reschedule_todos: { ids: string[]; due_at: Date }
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Small reader that collects every problem with an input so the model can fix them all in one retry. */
class Reader {
  errors: string[] = []
  private raw: Record<string, unknown>
  private tz: string
  constructor(raw: Record<string, unknown>, tz: string) {
    this.raw = raw
    this.tz = tz
  }

  private get(key: string) {
    return this.raw[key]
  }
  private fail(msg: string) {
    this.errors.push(msg)
  }

  /** Reject keys the schema doesn't define (a typo like "due" instead of "due_at" would otherwise be ignored silently). */
  only(allowed: string[]) {
    for (const k of Object.keys(this.raw)) if (!allowed.includes(k)) this.fail(`unknown field "${k}"`)
  }

  str(key: string, o: { max: number; required?: boolean }): string | undefined {
    const v = this.get(key)
    if (v === undefined || v === null) {
      if (o.required) this.fail(`"${key}" is required`)
      return undefined
    }
    if (typeof v !== 'string') return void this.fail(`"${key}" must be text`)
    const t = v.trim()
    if (o.required && t === '') return void this.fail(`"${key}" cannot be empty`)
    if (t.length > o.max) return void this.fail(`"${key}" is too long (max ${o.max} characters)`)
    return t
  }

  int(key: string, o: { min: number; max: number; fallback?: number }): number | undefined {
    const v = this.get(key)
    if (v === undefined || v === null) return o.fallback
    if (typeof v !== 'number' || !Number.isInteger(v) || v < o.min || v > o.max) return void this.fail(`"${key}" must be a whole number from ${o.min} to ${o.max}`)
    return v
  }

  bool(key: string, fallback: boolean): boolean {
    const v = this.get(key)
    if (v === undefined || v === null) return fallback
    if (typeof v !== 'boolean') this.fail(`"${key}" must be true or false`)
    return typeof v === 'boolean' ? v : fallback
  }

  oneOf<T extends string>(key: string, values: readonly T[], fallback?: T): T | undefined {
    const v = this.get(key)
    if (v === undefined || v === null) return fallback
    if (typeof v !== 'string' || !values.includes(v as T)) return void this.fail(`"${key}" must be one of: ${values.join(', ')}`)
    return v as T
  }

  uuid(key: string): string | undefined {
    const v = this.str(key, { max: 64, required: true })
    if (v !== undefined && !UUID.test(v)) return void this.fail(`"${key}" is not a valid id; use ids from list/search results`)
    return v
  }

  uuids(key: string, o: { min: number; max: number }): string[] {
    const v = this.get(key)
    if (!Array.isArray(v) || v.length < o.min || v.length > o.max) {
      this.fail(`"${key}" must be a list of ${o.min} to ${o.max} ids`)
      return []
    }
    const bad = v.filter((x) => typeof x !== 'string' || !UUID.test(x))
    if (bad.length) this.fail(`"${key}" contains values that are not valid ids`)
    return [...new Set(v.filter((x): x is string => typeof x === 'string' && UUID.test(x)))]
  }

  strings(key: string, o: { max: number; maxLen: number; min?: number; required?: boolean; map?: (s: string) => string }): string[] {
    const v = this.get(key)
    if (v === undefined || v === null) {
      if (o.required) this.fail(`"${key}" is required`)
      return []
    }
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      this.fail(`"${key}" must be a list of text`)
      return []
    }
    const clean = [...new Set(v.map((x: string) => (o.map ? o.map(x.trim()) : x.trim())).filter(Boolean))]
    if (clean.length > o.max) this.fail(`"${key}" can have at most ${o.max} items`)
    if (clean.length < (o.min ?? 0)) this.fail(`"${key}" needs at least ${o.min ?? 0} item(s)`)
    if (clean.some((x) => x.length > o.maxLen)) this.fail(`items in "${key}" are too long (max ${o.maxLen} characters)`)
    return clean
  }

  date(key: string, o: { required?: boolean; nullable?: boolean }): Date | null | undefined {
    const v = this.get(key)
    if (v === undefined) {
      if (o.required) this.fail(`"${key}" is required`)
      return undefined
    }
    if (v === null) {
      if (o.nullable) return null
      this.fail(`"${key}" cannot be null`)
      return undefined
    }
    if (typeof v !== 'string') return void this.fail(`"${key}" must be a date string`)
    const d = parseDueAt(v, this.tz)
    if (!d) return void this.fail(`"${key}" is not a valid date; use ISO 8601 like 2026-10-16T18:00:00+05:30`)
    return d
  }
}

const PRIORITY_RANGE = { min: 0, max: 3 }
const normTag = (t: string) => t.toLowerCase().replace(/^#/, '').slice(0, 40)

export function parseToolInput<N extends ToolName>(name: N, raw: unknown, tz: string): Parsed<ToolInputs[N]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, error: 'input must be an object' }
  const r = new Reader(raw as Record<string, unknown>, tz)
  const allowed = TOOLS.find((t) => t.name === name)
  if (!allowed) return { ok: false, error: `unknown tool ${name}` }
  r.only(Object.keys(allowed.input_schema.properties))

  let value: unknown
  switch (name as ToolName) {
    case 'list_workspaces':
    case 'get_stats':
      value = {}
      break
    case 'list_todos':
      value = {
        workspace: r.str('workspace', { max: 100 }),
        view: r.oneOf('view', ['open', 'today', 'overdue', 'upcoming', 'in_progress', 'completed'] as const, 'open'),
        min_priority: r.int('min_priority', { ...PRIORITY_RANGE, fallback: 0 }),
        tag: r.str('tag', { max: 40 }),
        limit: r.int('limit', { min: 1, max: 50, fallback: 25 }),
      }
      break
    case 'search_todos':
      value = {
        query: r.str('query', { max: 200, required: true }),
        workspace: r.str('workspace', { max: 100 }),
        include_completed: r.bool('include_completed', false),
        limit: r.int('limit', { min: 1, max: 50, fallback: 15 }),
      }
      break
    case 'create_todo': {
      const due = r.date('due_at', {})
      const recurrence = r.oneOf('recurrence', ['daily', 'weekly', 'monthly'] as const)
      if (recurrence && !due) r.errors.push('"recurrence" needs a "due_at" to repeat from')
      value = {
        title: r.str('title', { max: 500, required: true }),
        workspace: r.str('workspace', { max: 100 }),
        description: r.str('description', { max: 20000 }),
        priority: r.int('priority', PRIORITY_RANGE),
        due_at: due ?? undefined,
        recurrence,
        tags: r.strings('tags', { max: 10, maxLen: 40, map: normTag }),
      }
      break
    }
    case 'update_todo': {
      const v = {
        id: r.uuid('id'),
        title: r.str('title', { max: 500 }),
        description: r.str('description', { max: 20000 }),
        priority: r.int('priority', PRIORITY_RANGE),
        due_at: r.date('due_at', { nullable: true }),
        recurrence: (raw as Record<string, unknown>).recurrence === null ? null : r.oneOf('recurrence', ['daily', 'weekly', 'monthly'] as const),
        status: r.oneOf('status', ['open', 'in_progress'] as const),
      }
      const changed = Object.entries(v).filter(([k, x]) => k !== 'id' && x !== undefined)
      if (changed.length === 0) r.errors.push('nothing to change: send at least one field besides "id"')
      value = v
      break
    }
    case 'complete_todo':
    case 'get_note':
      value = { id: r.uuid('id') }
      break
    case 'add_subtasks':
      value = { parent_id: r.uuid('parent_id'), titles: r.strings('titles', { max: 20, min: 1, maxLen: 500, required: true }) }
      break
    case 'create_note':
      value = {
        title: r.str('title', { max: 300, required: true }),
        body: r.str('body', { max: 20000, required: true }),
        workspace: r.str('workspace', { max: 100 }),
        tags: r.strings('tags', { max: 10, maxLen: 40, map: normTag }),
      }
      break
    case 'search_notes':
      value = {
        query: r.str('query', { max: 200, required: true }),
        workspace: r.str('workspace', { max: 100 }),
        limit: r.int('limit', { min: 1, max: 20, fallback: 8 }),
      }
      break
    case 'propose_delete_todos':
      value = { ids: r.uuids('ids', { min: 1, max: 100 }), reason: r.str('reason', { max: 300 }) }
      break
    case 'propose_reschedule_todos':
      value = { ids: r.uuids('ids', { min: 2, max: 100 }), due_at: r.date('due_at', { required: true }) }
      break
  }
  if (r.errors.length) return { ok: false, error: r.errors.join('; ') }
  return { ok: true, value: value as ToolInputs[N] }
}
