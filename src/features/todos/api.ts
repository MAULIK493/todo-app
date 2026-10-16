import { onlineManager, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query'
import { addDays, startOfDay } from '@/lib/dates'
import { applyOp } from '@/features/offline/executor'
import { classifyError, type OutboxOp } from '@/features/offline/outbox'
import { enqueueOffline } from '@/features/offline/sync'
import { cipherFor, isPrivateWorkspace } from '@/features/security/vault'
import { matchesSearch } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import type { ParsedTodo } from './parseQuickAdd'
import type { Todo, TodoStatus, TodoView } from './types'

export const PAGE_SIZE = 50

const COLUMNS =
  'id, workspace_id, parent_id, title, description, status, priority, due_at, reminder_at, recurrence, position, completed_at, created_at'
const TAGS_EMBED = 'todo_tags(tags(name))'

// Each view sorts on one indexed column; (column, id) forms the keyset cursor.
type SortColumn = 'position' | 'due_at' | 'completed_at'
const SORT: Record<TodoView, { column: SortColumn; ascending: boolean }> = {
  all: { column: 'position', ascending: true },
  todo: { column: 'position', ascending: true },
  doing: { column: 'position', ascending: true },
  today: { column: 'due_at', ascending: true },
  upcoming: { column: 'due_at', ascending: true },
  overdue: { column: 'due_at', ascending: true },
  completed: { column: 'completed_at', ascending: false },
}

type Cursor = { value: string | number; id: string }
type Raw = Omit<Todo, 'tags'> & { todo_tags?: { tags: { name: string } | null }[] }
type Pages = InfiniteData<Todo[], Cursor | null>

const normalize = ({ todo_tags, ...rest }: Raw): Todo => ({
  ...rest,
  tags: (todo_tags ?? []).flatMap((x) => (x.tags ? [x.tags.name] : [])).sort(),
})

/** Turns "foo bar" into a prefix tsquery "foo:* & bar:*"; null when nothing searchable. */
export function toTsQuery(input: string) {
  const words = input.match(/[\p{L}\p{N}]+/gu)
  return words ? words.map((w) => `${w}:*`).join(' & ') : null
}

// Private workspaces can't be searched by the server, so they're scanned and filtered here.
const SCAN_BATCH = 200
const SCAN_LIMIT = 10_000

async function decryptTodos(workspaceId: string, rows: Todo[]): Promise<Todo[]> {
  const c = cipherFor(workspaceId)
  if (!c) return rows
  return Promise.all(rows.map(async (t) => ({
    ...t,
    title: await c.readText('title', t.title),
    description: await c.readText('description', t.description),
  })))
}

export function useTodos(workspaceId: string, view: TodoView, search: string, enabled = true) {
  const privateSearch = isPrivateWorkspace(workspaceId) && search.trim() !== ''

  const fetchRaw = async (cursor: Cursor | null, limit: number, serverSearch: string): Promise<Todo[]> => {
    const now = new Date()
    const today = startOfDay(now).toISOString()
    const tomorrow = addDays(startOfDay(now), 1).toISOString()
    const sort = SORT[view]

    let q = supabase
      .from('todos')
      .select(`${COLUMNS}, subtasks:todos!parent_id(count), ${TAGS_EMBED}`)
      .eq('workspace_id', workspaceId)
      .is('parent_id', null)

    // `<> done` (not IN) so the planner can use the partial indexes.
    if (view === 'completed') q = q.eq('status', 'done')
    else if (view === 'todo') q = q.eq('status', 'open')
    else if (view === 'doing') q = q.eq('status', 'in_progress')
    else q = q.neq('status', 'done')

    if (view === 'today') q = q.gte('due_at', today).lt('due_at', tomorrow)
    if (view === 'upcoming') q = q.gte('due_at', tomorrow)
    if (view === 'overdue') q = q.lt('due_at', now.toISOString())

    const tsQuery = toTsQuery(serverSearch)
    if (tsQuery) q = q.textSearch('search', tsQuery, { config: 'simple' })

    if (cursor) {
      const op = sort.ascending ? 'gt' : 'lt'
      const v = String(cursor.value)
      q = q.or(`${sort.column}.${op}."${v}",and(${sort.column}.eq."${v}",id.${op}."${cursor.id}")`)
    }

    const { data, error } = await q
      .order(sort.column, { ascending: sort.ascending })
      .order('id', { ascending: sort.ascending })
      .limit(limit)
    if (error) throw new Error(error.message)
    return (data as unknown as Raw[]).map(normalize)
  }

  const cursorAfter = (row: Todo): Cursor => ({ value: row[SORT[view].column] as string | number, id: row.id })

  return useInfiniteQuery({
    queryKey: ['todos', workspaceId, view, search],
    enabled,
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam }): Promise<Todo[]> => {
      if (!privateSearch) return decryptTodos(workspaceId, await fetchRaw(pageParam, PAGE_SIZE, search))

      // Encrypted: scan the workspace in batches, decrypt, and keep the matches (a single page).
      const matches: Todo[] = []
      let cursor: Cursor | null = null
      for (let scanned = 0; scanned < SCAN_LIMIT; scanned += SCAN_BATCH) {
        const batch = await decryptTodos(workspaceId, await fetchRaw(cursor, SCAN_BATCH, ''))
        matches.push(...batch.filter((t) => matchesSearch(search, t.title, t.description)))
        if (batch.length < SCAN_BATCH) break
        cursor = cursorAfter(batch[batch.length - 1])
      }
      return matches
    },
    getNextPageParam: (last): Cursor | undefined => {
      if (privateSearch || last.length < PAGE_SIZE) return undefined
      return cursorAfter(last[last.length - 1])
    },
  })
}

export function useSubtasks(parentId: string, workspaceId: string) {
  return useQuery({
    queryKey: ['subtasks', parentId],
    queryFn: async (): Promise<Todo[]> => {
      const { data, error } = await supabase
        .from('todos').select(`${COLUMNS}, ${TAGS_EMBED}`).eq('parent_id', parentId).order('created_at').limit(200)
      if (error) throw new Error(error.message)
      return decryptTodos(workspaceId, (data as unknown as Raw[]).map(normalize))
    },
  })
}

export function useTags(workspaceId: string) {
  return useQuery({
    queryKey: ['tags', workspaceId],
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.from('tags').select('name').eq('workspace_id', workspaceId).order('name').limit(500)
      if (error) throw new Error(error.message)
      return data.map((t: { name: string }) => t.name)
    },
  })
}

// ---- cache helpers: keep the UI instant, then let the refetch on settle correct any drift ----

const patchPages = (qc: QueryClient, queryKey: unknown[], fn: (pages: Todo[][]) => Todo[][]) =>
  qc.setQueriesData<Pages>({ queryKey }, (old) => old && { ...old, pages: fn(old.pages) })

const without = (pages: Todo[][], ids: Set<string>) => pages.map((p) => p.filter((t) => !ids.has(t.id)))

function insertAfter(pages: Todo[][], todo: Todo, afterId: string | null) {
  if (!afterId) return pages.length ? [[todo, ...pages[0]], ...pages.slice(1)] : [[todo]]
  let placed = false
  const out = pages.map((p) => {
    const i = p.findIndex((t) => t.id === afterId)
    if (i < 0) return p
    placed = true
    return [...p.slice(0, i + 1), todo, ...p.slice(i + 1)]
  })
  return placed ? out : pages // anchor not loaded in this cache; the refetch will place it
}

const asError = (e: { message: string }) => new Error(e.message)

export function useTodoMutations() {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['todos'] })
    qc.invalidateQueries({ queryKey: ['subtasks'] })
    qc.invalidateQueries({ queryKey: ['tags'] })
    qc.invalidateQueries({ queryKey: ['rewards'] })
  }
  const removeFromCache = (ids: Set<string>) => patchPages(qc, ['todos'], (pages) => without(pages, ids))

  /**
   * Runs a change now if there is a connection; otherwise (or if the connection drops mid-way) it goes into the offline
   * queue and is sent later. Returns whether it was queued, so the caller knows not to refetch while offline.
   */
  const sendOrQueue = async (op: OutboxOp): Promise<{ queued: boolean }> => {
    if (!onlineManager.isOnline()) { await enqueueOffline(op); return { queued: true } }
    try {
      await applyOp(op)
      return { queued: false }
    } catch (e) {
      if (classifyError(e) === 'network') { await enqueueOffline(op); return { queued: true } }
      throw asError(e as { message: string })
    }
  }

  // Shows a new todo in the lists straight away (also while offline), at the top like the database would place it.
  const addOptimistic = (todo: Todo) =>
    qc.setQueriesData<Pages>(
      { queryKey: ['todos', todo.workspace_id], predicate: (q) => ['all', 'todo'].includes(q.queryKey[2] as string) && q.queryKey[3] === '' },
      (old) => old && { ...old, pages: old.pages.length ? [[todo, ...old.pages[0]], ...old.pages.slice(1)] : [[todo]] },
    )

  const create = useMutation({
    // Must run even without a connection: that is how it reaches the offline queue.
    networkMode: 'always',
    mutationFn: async ({ tags, ...row }: Partial<ParsedTodo> & { workspace_id: string; title: string; parent_id?: string }) => {
      const c = cipherFor(row.workspace_id)
      const id = crypto.randomUUID()
      const position = -Date.now() / 1000 // same scale as the database default: newest on top
      const title = c ? await c.text('title', row.title) : row.title
      // Tag names would be visible to the server, so private workspaces have no tags.
      const op: OutboxOp = {
        kind: 'create_todo',
        todo: {
          id, workspace_id: row.workspace_id, parent_id: row.parent_id ?? null, title, description: '', priority: row.priority ?? 0,
          due_at: row.due_at ?? null, recurrence: row.recurrence ?? null, position, tags: c ? [] : (tags ?? []),
        },
      }
      if (!row.parent_id) {
        addOptimistic({
          id, workspace_id: row.workspace_id, parent_id: null, title: row.title, description: '', status: 'open', priority: (row.priority ?? 0) as Todo['priority'],
          due_at: row.due_at ?? null, reminder_at: null, recurrence: row.recurrence ?? null, tags: c ? [] : (tags ?? []), position, completed_at: null,
          created_at: new Date().toISOString(),
        })
      }
      return sendOrQueue(op)
    },
    onSettled: (data) => { if (!data?.queued) refresh() },
  })

  const update = useMutation({
    mutationFn: async ({ id, workspace_id, tags, ...patch }: Partial<Omit<Todo, 'tags'>> & { id: string; workspace_id: string; tags?: string[] }) => {
      const c = cipherFor(workspace_id)
      if (c) {
        if (patch.title !== undefined) patch.title = await c.text('title', patch.title)
        if (patch.description) patch.description = await c.text('description', patch.description)
      }
      if (Object.keys(patch).length) {
        const { error } = await supabase.from('todos').update(patch).eq('id', id)
        if (error) throw asError(error)
      }
      if (tags && !c) {
        const r = await supabase.rpc('set_todo_tags', { p_todo: id, p_names: tags })
        if (r.error) throw asError(r.error)
      }
    },
    onSettled: refresh,
  })

  // `delayMs` lets a row play its completion animation: the change is still sent to the server immediately,
  // only the row's disappearance from the screen waits.
  const toggle = useMutation({
    networkMode: 'always', // see `create`
    mutationFn: ({ id, done }: { id: string; done: boolean; delayMs?: number }) => sendOrQueue({ kind: 'set_done', id, done }),
    onMutate: ({ id, delayMs }) => {
      if (delayMs) setTimeout(() => removeFromCache(new Set([id])), delayMs)
      else removeFromCache(new Set([id]))
    },
    onSettled: (data, _error, { delayMs }) => {
      if (data?.queued) return // offline: the list already shows the change, and refetching now would fail
      if (delayMs) setTimeout(refresh, delayMs)
      else refresh()
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('todos').delete().eq('id', id)
      if (error) throw asError(error)
    },
    onMutate: (id) => removeFromCache(new Set([id])),
    onSettled: refresh,
  })

  // Re-insert deleted todos with their original ids, positions and tags (used by Undo).
  const restore = useMutation({
    mutationFn: async (todos: Todo[]) => {
      const rows = await Promise.all(todos.map(async ({ subtasks: _s, tags: _t, ...row }) => {
        const c = cipherFor(row.workspace_id)
        if (!c) return row
        return { ...row, title: await c.text('title', row.title), description: row.description ? await c.text('description', row.description) : '' }
      }))
      const { error } = await supabase.from('todos').insert(rows)
      if (error) throw asError(error)
      await Promise.all(
        todos.filter((t) => t.tags.length && !isPrivateWorkspace(t.workspace_id))
          .map((t) => supabase.rpc('set_todo_tags', { p_todo: t.id, p_names: t.tags })),
      )
    },
    onSettled: refresh,
  })

  /**
   * Drag-and-drop move. `afterId` is the todo that should sit directly above (null = top of the list).
   * `status` is set when a card moves to another Kanban column.
   */
  const move = useMutation({
    mutationFn: async (v: { todo: Todo; afterId: string | null; fromView: TodoView; toView: TodoView; status?: Exclude<TodoStatus, 'done'> }) => {
      const { error } = await supabase.rpc('move_todo', { p_id: v.todo.id, p_after: v.afterId, p_status: v.status ?? null })
      if (error) throw asError(error)
    },
    onMutate: ({ todo, afterId, fromView, toView, status }) => {
      const moved: Todo = status ? { ...todo, status, completed_at: null } : todo
      const ids = new Set([todo.id])
      const ws = todo.workspace_id
      if (fromView === toView) {
        patchPages(qc, ['todos', ws, toView], (pages) => insertAfter(without(pages, ids), moved, afterId))
      } else {
        patchPages(qc, ['todos', ws, fromView], (pages) => without(pages, ids))
        patchPages(qc, ['todos', ws, toView], (pages) => insertAfter(pages, moved, afterId))
      }
    },
    onSettled: refresh,
  })

  return { create, update, toggle, remove, restore, move }
}

type Ids = { ids: string[] }

export function useBulkMutations() {
  const qc = useQueryClient()
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['todos'] })
    qc.invalidateQueries({ queryKey: ['tags'] })
    qc.invalidateQueries({ queryKey: ['rewards'] })
  }
  const dropFromCache = ({ ids }: Ids) => patchPages(qc, ['todos'], (pages) => without(pages, new Set(ids)))
  const rpc = (fn: string, args: Record<string, unknown>) => async () => {
    const { error } = await supabase.rpc(fn, args)
    if (error) throw asError(error)
  }

  const complete = useMutation({ mutationFn: (v: Ids) => rpc('complete_todos', { p_ids: v.ids })(), onMutate: dropFromCache, onSettled: refresh })
  const reopen = useMutation({ mutationFn: (v: Ids) => rpc('reopen_todos', { p_ids: v.ids })(), onMutate: dropFromCache, onSettled: refresh })
  const remove = useMutation({ mutationFn: (v: Ids) => rpc('delete_todos', { p_ids: v.ids })(), onMutate: dropFromCache, onSettled: refresh })
  const priority = useMutation({
    mutationFn: (v: Ids & { priority: number }) => rpc('set_todos_priority', { p_ids: v.ids, p_priority: v.priority })(),
    onSettled: refresh,
  })
  const tag = useMutation({
    mutationFn: (v: Ids & { name: string }) => rpc('add_tag_to_todos', { p_ids: v.ids, p_name: v.name })(),
    onSettled: refresh,
  })
  return { complete, reopen, remove, priority, tag }
}
