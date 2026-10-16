import type { SupabaseClient } from '@supabase/supabase-js'
import { textToDoc } from './doc.ts'
import type { Usage } from './limits.ts'
import type { Db, NoteRow, Recurrence, RewardsSnapshot, Tone, TodoQuery, TodoRow, TodoStatus, WorkspaceCounts, WorkspaceInfo } from './types.ts'

/** The Supabase implementation of Db. It always runs with the signed-in user's token, so RLS applies to every call. */

type RawTodo = Omit<TodoRow, 'tags' | 'subtask_count'> & {
  todo_tags?: { tags: { name: string } | null }[]
  subtasks?: { count: number }[]
}
type RawNote = {
  id: string; title: string; content_text: string; workspace_id: string; updated_at: string; pinned: boolean
  note_tags?: { tags: { name: string } | null }[]
}

const TODO_SELECT =
  'id, title, description, status, priority, due_at, recurrence, workspace_id, parent_id, todo_tags(tags(name)), subtasks:todos!parent_id(count)'
const NOTE_SELECT = 'id, title, content_text, workspace_id, updated_at, pinned, note_tags(tags(name))'

const names = (rows?: { tags: { name: string } | null }[]) => (rows ?? []).flatMap((r) => (r.tags ? [r.tags.name] : [])).sort()
const toTodo = (r: RawTodo): TodoRow => ({ ...r, tags: names(r.todo_tags), subtask_count: r.subtasks?.[0]?.count ?? 0 })
const toNote = (r: RawNote): NoteRow => ({
  id: r.id, title: r.title, text: r.content_text, workspace_id: r.workspace_id, updated_at: r.updated_at, pinned: r.pinned, tags: names(r.note_tags),
})

/** "foo bar" -> prefix query "foo:* & bar:*" for the simple text-search config; null when nothing searchable. */
export function toTsQuery(input: string): string | null {
  const words = input.match(/[\p{L}\p{N}]+/gu)
  return words ? words.map((w) => `${w}:*`).join(' & ') : null
}

const check = (error: { message: string } | null, what: string) => {
  if (error) throw new Error(`${what}: ${error.message}`)
}

export function createDb(sb: SupabaseClient): Db {
  return {
    async workspaces(): Promise<WorkspaceInfo[]> {
      const { data, error } = await sb.from('workspaces').select('id, name, lock_state').order('position')
      check(error, 'workspaces')
      return data as WorkspaceInfo[]
    },

    async workspaceAccess() {
      const { data, error } = await sb.from('ai_workspace_prefs').select('workspace_id, allowed')
      check(error, 'workspace access')
      return Object.fromEntries((data ?? []).map((r: { workspace_id: string; allowed: boolean }) => [r.workspace_id, r.allowed]))
    },

    async profile() {
      const [p, prefs] = await Promise.all([
        sb.from('profiles').select('timezone').maybeSingle(),
        sb.from('ai_preferences').select('tone, briefing_enabled').maybeSingle(),
      ])
      check(p.error, 'profile')
      check(prefs.error, 'preferences')
      return {
        timezone: (p.data?.timezone as string | undefined) ?? 'UTC',
        tone: ((prefs.data?.tone as Tone | undefined) ?? 'friendly'),
        briefingEnabled: (prefs.data?.briefing_enabled as boolean | undefined) ?? true,
      }
    },

    async listTodos(q: TodoQuery) {
      const select = q.tag ? `${TODO_SELECT}, tag_filter:todo_tags!inner(tags!inner(name))` : TODO_SELECT
      let qb = sb.from('todos').select(select).in('workspace_id', q.workspaceIds).is('parent_id', null)
      if (q.view === 'completed') qb = qb.eq('status', 'done')
      else if (q.view === 'in_progress') qb = qb.eq('status', 'in_progress')
      else qb = qb.neq('status', 'done')
      if (q.view === 'today') qb = qb.gte('due_at', q.today.start).lt('due_at', q.today.end)
      if (q.view === 'upcoming') qb = qb.gte('due_at', q.today.end)
      if (q.view === 'overdue') qb = qb.lt('due_at', q.today.now)
      if (q.minPriority > 0) qb = qb.gte('priority', q.minPriority)
      if (q.tag) qb = qb.eq('tag_filter.tags.name', q.tag)

      qb = q.view === 'completed'
        ? qb.order('completed_at', { ascending: false })
        : qb.order('due_at', { ascending: true, nullsFirst: false }).order('priority', { ascending: false }).order('position')
      const { data, error } = await qb.limit(q.limit)
      check(error, 'todos')
      return (data as unknown as RawTodo[]).map(toTodo)
    },

    async searchTodos(q) {
      const ts = toTsQuery(q.query)
      if (!ts) return []
      let qb = sb.from('todos').select(TODO_SELECT).in('workspace_id', q.workspaceIds).textSearch('search', ts, { config: 'simple' })
      if (!q.includeDone) qb = qb.neq('status', 'done')
      const { data, error } = await qb.limit(q.limit)
      check(error, 'search')
      return (data as unknown as RawTodo[]).map(toTodo)
    },

    async getTodos(ids) {
      const { data, error } = await sb.from('todos').select(TODO_SELECT).in('id', ids)
      check(error, 'todos')
      return (data as unknown as RawTodo[]).map(toTodo)
    },

    async createTodo(input) {
      const { tags, ...row } = input
      const { data, error } = await sb.from('todos').insert(row).select('id, title').single()
      check(error, 'create todo')
      if (tags?.length) check((await sb.rpc('set_todo_tags', { p_todo: data!.id, p_names: tags })).error, 'tags')
      return data as { id: string; title: string }
    },

    async updateTodo(id, patch) {
      check((await sb.from('todos').update(patch).eq('id', id)).error, 'update todo')
    },

    async completeTodo(id) {
      check((await sb.rpc('complete_todo', { p_id: id })).error, 'complete todo')
    },

    async addSubtasks(parentId, workspaceId, titles) {
      const rows = titles.map((title) => ({ workspace_id: workspaceId, parent_id: parentId, title }))
      check((await sb.from('todos').insert(rows)).error, 'add subtasks')
      return rows.length
    },

    async createNote(input) {
      const { data, error } = await sb
        .from('notes')
        .insert({ workspace_id: input.workspace_id, title: input.title, content: textToDoc(input.body), content_text: input.body })
        .select('id, title').single()
      check(error, 'create note')
      if (input.tags?.length) check((await sb.rpc('set_note_tags', { p_note: data!.id, p_names: input.tags })).error, 'note tags')
      return data as { id: string; title: string }
    },

    async searchNotes(q) {
      const ts = toTsQuery(q.query)
      if (!ts) return []
      const { data, error } = await sb.from('notes').select(NOTE_SELECT).in('workspace_id', q.workspaceIds)
        .textSearch('search', ts, { config: 'simple' }).order('updated_at', { ascending: false }).limit(q.limit)
      check(error, 'search notes')
      return (data as unknown as RawNote[]).map(toNote)
    },

    async getNote(id) {
      const { data, error } = await sb.from('notes').select(NOTE_SELECT).eq('id', id).maybeSingle()
      check(error, 'note')
      return data ? toNote(data as unknown as RawNote) : null
    },

    async counts(workspaceIds, today, weekStart): Promise<WorkspaceCounts[]> {
      if (workspaceIds.length === 0) return []
      const { data, error } = await sb.rpc('ai_workspace_counts', {
        p_workspaces: workspaceIds, p_day_start: today.start, p_day_end: today.end, p_week_start: weekStart,
      })
      check(error, 'counts')
      return (data as Record<string, number | string>[]).map((r) => ({
        workspace_id: r.workspace_id as string, open: Number(r.open), in_progress: Number(r.in_progress), overdue: Number(r.overdue),
        due_today: Number(r.due_today), completed_this_week: Number(r.completed_this_week),
      }))
    },

    async rewards(): Promise<RewardsSnapshot> {
      const { data, error } = await sb.rpc('reward_summary')
      check(error, 'rewards')
      if (!data) return null
      const r = data as Record<string, number | boolean>
      return {
        level: r.level as number, xp: r.xp as number, coins: r.coins as number, streak: r.streak as number, longest_streak: r.longest_streak as number,
        active_today: r.active_today as boolean, today_done: r.today_done as number, daily_goal: r.daily_goal as number,
        week_done: r.week_done as number, weekly_goal: r.weekly_goal as number,
      }
    },
  }
}

// ---- chat history, usage and briefings (not part of what the model can do, so not on Db) ----

export type StoredMessage = { role: 'user' | 'assistant'; content: string }

export function createStore(sb: SupabaseClient) {
  return {
    async usage(): Promise<Usage> {
      const { data, error } = await sb.rpc('ai_usage_summary')
      check(error, 'usage')
      return data as Usage
    },

    async recordUsage(input: number, output: number) {
      check((await sb.rpc('ai_record_usage', { p_input: Math.round(input), p_output: Math.round(output) })).error, 'record usage')
    },

    /** Last `limit` messages, oldest first. Returns null if the conversation doesn't exist or isn't the caller's. */
    async history(conversationId: string, limit: number): Promise<StoredMessage[] | null> {
      const conv = await sb.from('ai_conversations').select('id').eq('id', conversationId).maybeSingle()
      check(conv.error, 'conversation')
      if (!conv.data) return null
      const { data, error } = await sb.from('ai_messages').select('role, content').eq('conversation_id', conversationId)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
      check(error, 'history')
      return (data as StoredMessage[]).reverse()
    },

    async createConversation(title: string): Promise<string> {
      const { data, error } = await sb.from('ai_conversations').insert({ title: title.slice(0, 80) }).select('id').single()
      check(error, 'create conversation')
      return data!.id as string
    },

    async saveTurn(conversationId: string, userText: string, assistantText: string, actions: unknown[]) {
      // Two rows in one statement keeps the pair together; created_at ordering is preserved by explicit timestamps.
      const t0 = Date.now()
      const rows = [
        { conversation_id: conversationId, role: 'user', content: userText, created_at: new Date(t0).toISOString() },
        { conversation_id: conversationId, role: 'assistant', content: assistantText, actions, created_at: new Date(t0 + 1).toISOString() },
      ]
      check((await sb.from('ai_messages').insert(rows)).error, 'save messages')
    },

    async briefing(day: string, kind: 'morning' | 'evening'): Promise<string | null> {
      const { data, error } = await sb.from('ai_briefings').select('content').eq('day', day).eq('kind', kind).maybeSingle()
      check(error, 'briefing')
      return (data?.content as string | undefined) ?? null
    },

    async saveBriefing(day: string, kind: 'morning' | 'evening', content: string) {
      // A concurrent request may have saved it first; either copy is fine.
      const { error } = await sb.from('ai_briefings').insert({ day, kind, content })
      if (error && error.code !== '23505') check(error, 'save briefing')
    },
  }
}

export type Store = ReturnType<typeof createStore>
export type { TodoStatus, Recurrence }
