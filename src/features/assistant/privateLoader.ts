import { cipherFor, useVault } from '@/features/security/vault'
import { supabase } from '@/lib/supabase'
import { formatPrivateContext, selectShareable, type PrivateSection } from './privateContext'

/**
 * Decrypts a small read-only snapshot of every private workspace the user has opted in AND currently has unlocked.
 * Returns null when there is nothing to share. Runs only in the browser, which is the only place the key exists.
 */
export async function gatherPrivateContext(): Promise<string | null> {
  const unlocked = new Set(Object.keys(useVault.getState().keys))
  if (unlocked.size === 0) return null

  const [ws, prefs] = await Promise.all([
    supabase.from('workspaces').select('id, name, lock_state'),
    supabase.from('ai_workspace_prefs').select('workspace_id, allowed'),
  ])
  if (ws.error || prefs.error) return null
  const access = Object.fromEntries((prefs.data ?? []).map((r: { workspace_id: string; allowed: boolean }) => [r.workspace_id, r.allowed]))
  const shareable = selectShareable(ws.data ?? [], access, unlocked)

  const sections: PrivateSection[] = []
  for (const w of shareable) {
    const cipher = cipherFor(w.id)
    if (!cipher) continue
    const [todos, notes] = await Promise.all([
      supabase.from('todos').select('title, description, status, priority, due_at').eq('workspace_id', w.id).is('parent_id', null).neq('status', 'done').order('position').limit(120),
      supabase.from('notes').select('title').eq('workspace_id', w.id).order('updated_at', { ascending: false }).limit(40),
    ])
    sections.push({
      name: w.name,
      todos: await Promise.all((todos.data ?? []).map(async (t: { title: string; description: string; status: string; priority: number; due_at: string | null }) => ({
        title: await cipher.readText('title', t.title),
        description: t.description ? await cipher.readText('description', t.description) : undefined,
        status: t.status,
        priority: t.priority,
        due: t.due_at ? new Date(t.due_at).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null,
      }))),
      noteTitles: (await Promise.all((notes.data ?? []).map((n: { title: string }) => cipher.readText('title', n.title)))).filter(Boolean),
    })
  }
  return formatPrivateContext(sections)
}
