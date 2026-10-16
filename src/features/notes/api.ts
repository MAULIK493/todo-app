import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { JSONContent } from '@tiptap/react'
import { toTsQuery } from '@/features/todos/api'
import { cipherFor, isPrivateWorkspace } from '@/features/security/vault'
import { matchesSearch } from '@/lib/search'
import { supabase } from '@/lib/supabase'
import type { FolderFilter, LinkedTodo, Note, NoteFolder, NoteSummary } from './types'

export const NOTES_PAGE = 30

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
// Encrypted envelope must stay under the 1,000,000-byte column limit.
const MAX_SEALED_CHARS = 950_000

const LIST_COLUMNS = 'id, workspace_id, folder_id, title, preview, pinned, updated_at'
const TAGS_EMBED = 'note_tags(tags(name))'

type RawTags = { note_tags?: { tags: { name: string } | null }[] }
type RawSummary = Omit<NoteSummary, 'tags'> & RawTags
type RawNote = Omit<Note, 'tags'> & RawTags

const tagNames = (note_tags: RawTags['note_tags']) =>
  (note_tags ?? []).flatMap((x) => (x.tags ? [x.tags.name] : [])).sort()
const toSummary = ({ note_tags, ...rest }: RawSummary): NoteSummary => ({ ...rest, tags: tagNames(note_tags) })
const toNote = ({ note_tags, ...rest }: RawNote): Note => ({ ...rest, tags: tagNames(note_tags) })

export class ConflictError extends Error {
  constructor() {
    super('This note was changed somewhere else. Reload to see the latest version.')
  }
}

export type NoteQuery = { workspaceId: string; folder: FolderFilter; tag: string | null; search: string }

type Filterable<T> = {
  eq: (c: string, v: unknown) => T
  is: (c: string, v: null) => T
  textSearch: (c: string, q: string, o: { config: string }) => T
}

/** Filters shared by the pinned and recent lists. */
function applyFilters<T extends Filterable<T>>(q: T, f: NoteQuery, withText = true): T {
  q = q.eq('workspace_id', f.workspaceId)
  if (f.folder === 'none') q = q.is('folder_id', null)
  else if (f.folder !== 'all') q = q.eq('folder_id', f.folder)
  const ts = toTsQuery(f.search)
  if (withText && ts) q = q.textSearch('search', ts, { config: 'simple' })
  if (f.tag) q = q.eq('tag_filter.tags.name', f.tag)
  return q
}

// The tag filter needs an inner join; otherwise the plain tag embed is enough.
const listSelect = (f: NoteQuery) =>
  `${LIST_COLUMNS}, ${TAGS_EMBED}${f.tag ? ', tag_filter:note_tags!inner(tags!inner(name))' : ''}`

// Encrypted titles are decrypted here. Search in a private workspace can only cover titles (note bodies would
// each have to be decrypted), so it scans and filters in the browser.
const SCAN_BATCH = 100
const SCAN_LIMIT = 5_000

async function decryptSummaries(workspaceId: string, rows: NoteSummary[]): Promise<NoteSummary[]> {
  const c = cipherFor(workspaceId)
  if (!c) return rows
  return Promise.all(rows.map(async (n) => ({ ...n, title: await c.readText('title', n.title) })))
}

const isPrivateSearch = (f: NoteQuery) => isPrivateWorkspace(f.workspaceId) && f.search.trim() !== ''

export function usePinnedNotes(f: NoteQuery) {
  return useQuery({
    queryKey: ['notes', 'pinned', f],
    queryFn: async (): Promise<NoteSummary[]> => {
      const privateSearch = isPrivateSearch(f)
      const { data, error } = await applyFilters(supabase.from('notes').select(listSelect(f)).eq('pinned', true), f, !privateSearch)
        .order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(100)
      if (error) throw new Error(error.message)
      const rows = await decryptSummaries(f.workspaceId, (data as unknown as RawSummary[]).map(toSummary))
      return privateSearch ? rows.filter((n) => matchesSearch(f.search, n.title)) : rows
    },
  })
}

type Cursor = { updated_at: string; id: string }

export function useRecentNotes(f: NoteQuery) {
  const privateSearch = isPrivateSearch(f)

  const fetchRaw = async (cursor: Cursor | null, limit: number): Promise<NoteSummary[]> => {
    let q = applyFilters(supabase.from('notes').select(listSelect(f)).eq('pinned', false), f, !privateSearch)
    if (cursor) {
      const { updated_at: u, id } = cursor
      q = q.or(`updated_at.lt."${u}",and(updated_at.eq."${u}",id.lt."${id}")`)
    }
    const { data, error } = await q.order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
    if (error) throw new Error(error.message)
    return decryptSummaries(f.workspaceId, (data as unknown as RawSummary[]).map(toSummary))
  }

  return useInfiniteQuery({
    queryKey: ['notes', 'recent', f],
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam }): Promise<NoteSummary[]> => {
      if (!privateSearch) return fetchRaw(pageParam, NOTES_PAGE)
      const matches: NoteSummary[] = []
      let cursor: Cursor | null = null
      for (let scanned = 0; scanned < SCAN_LIMIT; scanned += SCAN_BATCH) {
        const batch = await fetchRaw(cursor, SCAN_BATCH)
        matches.push(...batch.filter((n) => matchesSearch(f.search, n.title)))
        if (batch.length < SCAN_BATCH) break
        const tail = batch[batch.length - 1]
        cursor = { updated_at: tail.updated_at, id: tail.id }
      }
      return matches
    },
    getNextPageParam: (last): Cursor | undefined => {
      if (privateSearch || last.length < NOTES_PAGE) return undefined
      const tail = last[last.length - 1]
      return { updated_at: tail.updated_at, id: tail.id }
    },
  })
}

export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: ['note', id],
    enabled: !!id,
    queryFn: async (): Promise<Note | null> => {
      const { data, error } = await supabase
        .from('notes')
        .select(`${LIST_COLUMNS}, created_at, content, content_text, ${TAGS_EMBED}`)
        .eq('id', id!).maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return null
      const note = toNote(data as unknown as RawNote)
      const c = cipherFor(note.workspace_id)
      if (!c) return note
      return {
        ...note,
        title: await c.readText('title', note.title),
        content: await c.readJson<JSONContent>(note.content, EMPTY_DOC),
        content_text: '',
      }
    },
  })
}

export function useFolders(workspaceId: string) {
  return useQuery({
    queryKey: ['note-folders', workspaceId],
    queryFn: async (): Promise<NoteFolder[]> => {
      const { data, error } = await supabase
        .from('note_folders').select('id, name, position').eq('workspace_id', workspaceId).order('position').order('created_at')
      if (error) throw new Error(error.message)
      return data
    },
  })
}

export type NotePatch = Partial<{ title: string; content: JSONContent; content_text: string; pinned: boolean; folder_id: string | null }>

export function useNoteMutations() {
  const qc = useQueryClient()
  const refreshLists = () => qc.invalidateQueries({ queryKey: ['notes'] })

  const create = useMutation({
    mutationFn: async (v: { workspace_id: string; folder_id: string | null }): Promise<string> => {
      const c = cipherFor(v.workspace_id)
      // The database refuses plaintext in a private workspace, so a new note starts out encrypted too.
      const row = c
        ? { workspace_id: v.workspace_id, folder_id: null, title: await c.text('title', ''), content: await c.json(EMPTY_DOC) }
        : v
      const { data, error } = await supabase.from('notes').insert(row).select('id').single()
      if (error) throw new Error(error.message)
      return data.id
    },
    onSettled: refreshLists,
  })

  /** Saves with an optimistic-concurrency check: fails if the note changed since `expectedUpdatedAt`. */
  const save = useMutation({
    mutationFn: async (v: { id: string; workspace_id: string; expectedUpdatedAt: string; patch: NotePatch; tags?: string[] }): Promise<string> => {
      let updatedAt = v.expectedUpdatedAt
      const c = cipherFor(v.workspace_id)
      let patch: NotePatch = v.patch
      if (c) {
        patch = { ...patch }
        if (patch.title !== undefined) patch.title = await c.text('title', patch.title)
        if (patch.content !== undefined) {
          const sealed = await c.json(patch.content)
          if (JSON.stringify(sealed).length > MAX_SEALED_CHARS) throw new Error('This note is too large for a private workspace (about 700 KB maximum).')
          patch.content = sealed as unknown as JSONContent
        }
        if (patch.content_text !== undefined) patch.content_text = '' // search text would reveal the content
        if (patch.folder_id) patch.folder_id = null // folders don't exist in private workspaces
      }
      if (Object.keys(patch).length) {
        const { data, error } = await supabase
          .from('notes').update(patch).eq('id', v.id).eq('updated_at', v.expectedUpdatedAt).select('updated_at')
        if (error) throw new Error(error.message)
        if (!data.length) throw new ConflictError()
        updatedAt = data[0].updated_at as string
      }
      if (v.tags && !c) {
        const r = await supabase.rpc('set_note_tags', { p_note: v.id, p_names: v.tags })
        if (r.error) throw new Error(r.error.message)
      }
      return updatedAt
    },
    onSuccess: (updatedAt, v) => {
      qc.setQueryData<Note | null>(['note', v.id], (old) => old && { ...old, ...v.patch, tags: v.tags ?? old.tags, updated_at: updatedAt })
      refreshLists()
    },
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notes').delete().eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSettled: () => {
      refreshLists()
      qc.invalidateQueries({ queryKey: ['todo-notes'] })
    },
  })

  // Undo for delete: re-insert with the original id (links to todos are not restored).
  const restore = useMutation({
    mutationFn: async (n: Note) => {
      const { tags, preview: _preview, ...plain } = n
      const c = cipherFor(n.workspace_id)
      const row = c
        ? { ...plain, folder_id: null, title: await c.text('title', plain.title), content: await c.json(plain.content), content_text: '' }
        : plain
      const { error } = await supabase.from('notes').insert(row)
      if (error) throw new Error(error.message)
      if (tags.length && !c) await supabase.rpc('set_note_tags', { p_note: n.id, p_names: tags })
    },
    onSettled: refreshLists,
  })

  return { create, save, remove, restore }
}

export function useFolderMutations(workspaceId: string) {
  const qc = useQueryClient()
  const done = () => {
    qc.invalidateQueries({ queryKey: ['note-folders', workspaceId] })
    qc.invalidateQueries({ queryKey: ['notes'] })
  }
  const check = (e: { message: string } | null) => {
    if (e) throw new Error(e.message)
  }
  return {
    create: useMutation({
      mutationFn: async (v: { name: string; position: number }) =>
        check((await supabase.from('note_folders').insert({ ...v, workspace_id: workspaceId })).error),
      onSettled: done,
    }),
    rename: useMutation({
      mutationFn: async (v: { id: string; name: string }) =>
        check((await supabase.from('note_folders').update({ name: v.name }).eq('id', v.id)).error),
      onSettled: done,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => check((await supabase.from('note_folders').delete().eq('id', id)).error),
      onSettled: done,
    }),
  }
}

// ---- note <-> todo links ----

async function decryptLinked(workspaceId: string, rows: LinkedTodo[]): Promise<LinkedTodo[]> {
  const c = cipherFor(workspaceId)
  if (!c) return rows
  return Promise.all(rows.map(async (t) => ({ ...t, title: await c.readText('title', t.title) })))
}

export function useNoteTodos(noteId: string, workspaceId: string) {
  return useQuery({
    queryKey: ['note-todos', noteId],
    queryFn: async (): Promise<LinkedTodo[]> => {
      const { data, error } = await supabase.from('note_todos').select('todos(id, title, status)').eq('note_id', noteId)
      if (error) throw new Error(error.message)
      return decryptLinked(workspaceId, (data as unknown as { todos: LinkedTodo | null }[]).flatMap((r) => (r.todos ? [r.todos] : [])))
    },
  })
}

export function useTodoNotes(todoId: string, workspaceId: string) {
  return useQuery({
    queryKey: ['todo-notes', todoId],
    queryFn: async (): Promise<{ id: string; title: string }[]> => {
      const { data, error } = await supabase.from('note_todos').select('notes(id, title)').eq('todo_id', todoId)
      if (error) throw new Error(error.message)
      const notes = (data as unknown as { notes: { id: string; title: string } | null }[]).flatMap((r) => (r.notes ? [r.notes] : []))
      const c = cipherFor(workspaceId)
      return c ? Promise.all(notes.map(async (n) => ({ ...n, title: await c.readText('title', n.title) }))) : notes
    },
  })
}

export function useSearchTodosToLink(workspaceId: string, text: string) {
  const ts = toTsQuery(text)
  return useQuery({
    queryKey: ['link-todo-search', workspaceId, ts],
    enabled: !!ts,
    queryFn: async (): Promise<LinkedTodo[]> => {
      if (isPrivateWorkspace(workspaceId)) {
        // Titles are encrypted: pull recent todos, decrypt, and match here.
        const { data, error } = await supabase
          .from('todos').select('id, title, status').eq('workspace_id', workspaceId).neq('status', 'done')
          .order('position').limit(1000)
        if (error) throw new Error(error.message)
        const rows = await decryptLinked(workspaceId, data)
        return rows.filter((t) => matchesSearch(text, t.title)).slice(0, 8)
      }
      const { data, error } = await supabase
        .from('todos').select('id, title, status').eq('workspace_id', workspaceId)
        .textSearch('search', ts!, { config: 'simple' }).limit(8)
      if (error) throw new Error(error.message)
      return data
    },
  })
}

export function useLinkMutations(noteId: string) {
  const qc = useQueryClient()
  const done = () => {
    qc.invalidateQueries({ queryKey: ['note-todos', noteId] })
    qc.invalidateQueries({ queryKey: ['todo-notes'] })
  }
  return {
    link: useMutation({
      mutationFn: async (todoId: string) => {
        const { error } = await supabase.from('note_todos').insert({ note_id: noteId, todo_id: todoId })
        if (error && error.code !== '23505') throw new Error(error.message) // already linked is fine
      },
      onSettled: done,
    }),
    unlink: useMutation({
      mutationFn: async (todoId: string) => {
        const { error } = await supabase.from('note_todos').delete().eq('note_id', noteId).eq('todo_id', todoId)
        if (error) throw new Error(error.message)
      },
      onSettled: done,
    }),
  }
}
