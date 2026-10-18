import { formatLocal, zonedDayRange } from './dates.ts'
import type { Db, RewardsSnapshot, TodoRow, WorkspaceInfo } from './types.ts'

const PRIORITY = ['', 'low', 'medium', 'high']
const MAX_TODOS = 40
const MAX_CHARS = 6_000

/** One compact line per todo. The id is included so the model can act on it without looking it up first. */
export function formatSnapshot(o: { todos: TodoRow[]; workspaces: WorkspaceInfo[]; rewards: RewardsSnapshot; tz: string; now: Date }): string | null {
  const names = new Map(o.workspaces.map((w) => [w.id, w.name]))
  const lines: string[] = []
  for (const t of o.todos.slice(0, MAX_TODOS)) {
    const due = t.due_at ? new Date(t.due_at) : null
    const meta = [
      t.status === 'in_progress' ? 'in progress' : '',
      PRIORITY[t.priority] ? `${PRIORITY[t.priority]} priority` : '',
      due ? `${due < o.now ? 'OVERDUE, ' : ''}due ${formatLocal(o.tz, due)}` : '',
      t.recurrence ? `repeats ${t.recurrence}` : '',
      t.subtask_count ? `${t.subtask_count} subtasks` : '',
      names.get(t.workspace_id) ?? '',
    ].filter(Boolean)
    lines.push(`- [${t.id}] ${t.title.slice(0, 120)} (${meta.join('; ')})`)
  }
  const parts: string[] = []
  if (lines.length) parts.push(`Open todos, most urgent first${o.todos.length > MAX_TODOS ? ` (first ${MAX_TODOS}; use your tools for more)` : ''}:\n${lines.join('\n')}`)
  else parts.push('No open todos.')
  const r = o.rewards
  if (r) parts.push(`Progress: level ${r.level}, ${r.streak}-day streak, ${r.today_done}/${r.daily_goal} done today, ${r.week_done}/${r.weekly_goal} this week.`)
  const text = parts.join('\n')
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 1)}…` : text
}

/** Loads the person's open todos and progress in parallel so most questions can be answered without a tool round trip. Null if it fails. */
export async function loadSnapshot(db: Db, workspaces: WorkspaceInfo[], tz: string, now: Date): Promise<string | null> {
  if (workspaces.length === 0) return null
  try {
    const { start, end } = zonedDayRange(tz, now)
    const [todos, rewards] = await Promise.all([
      db.listTodos({ workspaceIds: workspaces.map((w) => w.id), view: 'open', minPriority: 0, tag: null, limit: MAX_TODOS + 1, today: { start: start.toISOString(), end: end.toISOString(), now: now.toISOString() } }),
      db.rewards().catch(() => null),
    ])
    return formatSnapshot({ todos, workspaces, rewards, tz, now })
  } catch {
    return null
  }
}
