import { docToText } from '@/features/notes/docText'
import { cipherFor, UNREADABLE, useVault } from '@/features/security/vault'
import { supabase } from '@/lib/supabase'
import type { ExportSource, SourceWorkspace } from './exporter'
import type { ExportFolder, ExportNote, ExportTodo } from './formats'
import type { ImportSink } from './importer'

/** The real database behind export and import. Everything runs as the signed-in user, so row-level security applies. */

const fail = (e: { message: string } | null, what: string) => {
  if (e) throw new Error(`${what}: ${e.message}`)
}

const TODO_COLS = 'id, workspace_id, parent_id, title, description, status, priority, due_at, reminder_at, recurrence, position, completed_at, created_at, todo_tags(tags(name))'
const NOTE_COLS = 'id, workspace_id, folder_id, title, content, content_text, pinned, created_at, updated_at, note_tags(tags(name))'
const names = (rows: { tags: { name: string } | null }[] | undefined) => (rows ?? []).flatMap((r) => (r.tags ? [r.tags.name] : [])).sort()

const undecryptable = () => new Error('Some items in a private workspace could not be decrypted, so the export was stopped rather than write unreadable data.')

export function createExportSource(): ExportSource {
  return {
    async workspaces(): Promise<SourceWorkspace[]> {
      const { data, error } = await supabase.from('workspaces').select('id, name, color, icon, position, lock_state').order('position')
      fail(error, 'workspaces')
      const keys = useVault.getState().keys
      return (data ?? []).map((w: { id: string; name: string; color: string; icon: string; position: number; lock_state: string }) => {
        const isPrivate = w.lock_state !== 'none'
        return { id: w.id, name: w.name, color: w.color, icon: w.icon, position: w.position, private: isPrivate, locked: isPrivate && !keys[w.id] }
      })
    },

    async todoPage(workspaceId, afterId, limit): Promise<ExportTodo[]> {
      let q = supabase.from('todos').select(TODO_COLS).eq('workspace_id', workspaceId)
      if (afterId) q = q.gt('id', afterId)
      const { data, error } = await q.order('id').limit(limit)
      fail(error, 'todos')
      const cipher = cipherFor(workspaceId)
      type TodoRow = Omit<ExportTodo, 'tags'> & { todo_tags?: { tags: { name: string } | null }[] }
      return Promise.all((data as unknown as TodoRow[]).map(async ({ todo_tags, ...t }) => {
        const title = cipher ? await cipher.readText('title', t.title) : t.title
        const description = cipher && t.description ? await cipher.readText('description', t.description) : t.description
        if (title === UNREADABLE || description === UNREADABLE) throw undecryptable()
        return { ...t, title, description, tags: names(todo_tags) }
      }))
    },

    async notePage(workspaceId, afterId, limit): Promise<ExportNote[]> {
      let q = supabase.from('notes').select(NOTE_COLS).eq('workspace_id', workspaceId)
      if (afterId) q = q.gt('id', afterId)
      const { data, error } = await q.order('id').limit(limit)
      fail(error, 'notes')
      const cipher = cipherFor(workspaceId)
      type Row = { id: string; workspace_id: string; folder_id: string | null; title: string; content: unknown; content_text: string; pinned: boolean; created_at: string; updated_at: string; note_tags?: { tags: { name: string } | null }[] }
      return Promise.all((data as unknown as Row[]).map(async (n) => {
        const title = cipher ? await cipher.readText('title', n.title) : n.title
        const content = cipher ? await cipher.readJson<ExportNote['content']>(n.content, null) : (n.content as ExportNote['content'])
        if (title === UNREADABLE || (cipher && content === null)) throw undecryptable()
        // Private notes keep no plain text on the server, so it is rebuilt from the decrypted document.
        return { id: n.id, workspace_id: n.workspace_id, folder_id: n.folder_id, title, content, text: cipher ? docToText(content) : n.content_text, pinned: n.pinned, tags: names(n.note_tags), created_at: n.created_at, updated_at: n.updated_at }
      }))
    },

    async folders(workspaceId): Promise<ExportFolder[]> {
      const { data, error } = await supabase.from('note_folders').select('id, workspace_id, name, position').eq('workspace_id', workspaceId)
      fail(error, 'folders')
      return (data ?? []) as ExportFolder[]
    },
  }
}

export function createImportSink(): ImportSink {
  // Inserting with ignoreDuplicates makes a retried batch harmless: rows that already went in are skipped.
  const once = { onConflict: 'id', ignoreDuplicates: true } as const

  return {
    async createWorkspace(name, color) {
      const { data: existing } = await supabase.from('workspaces').select('position').order('position', { ascending: false }).limit(1)
      const position = ((existing?.[0] as { position: number } | undefined)?.position ?? -1) + 1
      const { data, error } = await supabase.from('workspaces').insert({ name, color, position }).select('id').single()
      fail(error, 'create workspace')
      return { id: data!.id as string }
    },

    async insertFolders(workspaceId, folders) {
      fail((await supabase.from('note_folders').upsert(folders.map((f, position) => ({ id: f.id, workspace_id: workspaceId, name: f.name, position })), once)).error, 'folders')
    },

    async insertTodos(workspaceId, rows) {
      const cipher = cipherFor(workspaceId) // private workspace: encrypted before it leaves the browser
      const payload = await Promise.all(rows.map(async (t) => ({
        id: t.id, workspace_id: workspaceId, parent_id: t.parent_id, status: t.status, priority: t.priority, due_at: t.due_at, reminder_at: t.reminder_at,
        recurrence: t.recurrence, completed_at: t.completed_at, position: t.position,
        title: cipher ? await cipher.text('title', t.title) : t.title,
        description: cipher && t.description ? await cipher.text('description', t.description) : t.description,
      })))
      fail((await supabase.from('todos').upsert(payload, once)).error, 'todos')
    },

    async linkTags(workspaceId, links) {
      const tags = [...new Set(links.map((l) => l.tag))]
      fail((await supabase.from('tags').upsert(tags.map((name) => ({ workspace_id: workspaceId, name })), { onConflict: 'workspace_id,name', ignoreDuplicates: true })).error, 'tags')
      const { data, error } = await supabase.from('tags').select('id, name').eq('workspace_id', workspaceId).in('name', tags)
      fail(error, 'tags')
      const ids = new Map((data ?? []).map((t: { id: string; name: string }) => [t.name, t.id]))
      const rows = links.flatMap((l) => (ids.get(l.tag) ? [{ todo_id: l.todoId, tag_id: ids.get(l.tag) }] : []))
      fail((await supabase.from('todo_tags').upsert(rows, { onConflict: 'todo_id,tag_id', ignoreDuplicates: true })).error, 'tag links')
    },

    async insertNotes(workspaceId, notes) {
      const cipher = cipherFor(workspaceId)
      const payload = await Promise.all(notes.map(async (n) => {
        const content = n.content ?? { type: 'doc', content: [{ type: 'paragraph' }] }
        return cipher
          ? { id: n.id, workspace_id: workspaceId, folder_id: null, pinned: n.pinned, title: await cipher.text('title', n.title), content: await cipher.json(content), content_text: '' }
          : { id: n.id, workspace_id: workspaceId, folder_id: n.folder_id, pinned: n.pinned, title: n.title, content, content_text: n.text }
      }))
      fail((await supabase.from('notes').upsert(payload, once)).error, 'notes')
    },

    async tagNotes(noteId, tags) {
      fail((await supabase.rpc('set_note_tags', { p_note: noteId, p_names: tags })).error, 'note tags')
    },
  }
}
