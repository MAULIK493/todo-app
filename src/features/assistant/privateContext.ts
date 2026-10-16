/**
 * Content from private workspaces never reaches the server on its own: it is encrypted there. When a user turns the
 * assistant on for a private workspace AND has unlocked it, the browser decrypts a small snapshot and sends it with
 * a single message. That text is used for that one answer and the exchange is not saved.
 */

export type ShareableWorkspace = { id: string; name: string; lock_state: string }

/** A private workspace is shared only if it is locked-type, currently unlocked in this tab, and the user opted in. */
export function selectShareable(workspaces: ShareableWorkspace[], access: Record<string, boolean>, unlockedIds: Set<string>) {
  return workspaces.filter((w) => w.lock_state === 'locked' && unlockedIds.has(w.id) && access[w.id] === true)
}

export type PrivateTodo = { title: string; status: string; priority: number; due: string | null; description?: string }
export type PrivateSection = { name: string; todos: PrivateTodo[]; noteTitles: string[] }

const PRIORITY = ['', 'low', 'medium', 'high']

/** Compact text for the model. Returns null when there is nothing to share. */
export function formatPrivateContext(sections: PrivateSection[], maxChars = 12_000): string | null {
  const parts: string[] = []
  for (const s of sections) {
    if (s.todos.length === 0 && s.noteTitles.length === 0) continue
    const lines = [`Private workspace "${s.name}" (read-only):`]
    for (const t of s.todos) {
      const meta = [t.status === 'in_progress' ? 'in progress' : '', PRIORITY[t.priority] ? `${PRIORITY[t.priority]} priority` : '', t.due ? `due ${t.due}` : ''].filter(Boolean)
      lines.push(`- ${t.title}${meta.length ? ` (${meta.join(', ')})` : ''}${t.description ? `: ${t.description.slice(0, 200)}` : ''}`)
    }
    if (s.noteTitles.length) lines.push(`Notes: ${s.noteTitles.map((n) => `"${n}"`).join(', ')}`)
    parts.push(lines.join('\n'))
  }
  if (parts.length === 0) return null
  const text = parts.join('\n\n')
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
}
