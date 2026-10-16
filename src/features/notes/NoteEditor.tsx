import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import Placeholder from '@tiptap/extension-placeholder'
import { ArrowLeft, Pin, PinOff, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIsPrivate } from '@/features/security/vault'
import { useTags } from '@/features/todos/api'
import { cn } from '@/lib/cn'
import { useToasts } from '@/stores/toasts'
import { useFolders, useNoteMutations } from './api'
import { LinkedTodos } from './LinkedTodos'
import { Toolbar } from './Toolbar'
import type { Note } from './types'
import { useAutosave, type SaveStatus } from './useAutosave'

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved', dirty: 'Unsaved changes…', saving: 'Saving…', error: 'Could not save — retrying…', conflict: 'Conflict',
}

export function NoteEditor({ note, onReload }: { note: Note; onReload: () => void }) {
  const navigate = useNavigate()
  const push = useToasts((s) => s.push)
  const { save, remove, restore } = useNoteMutations()
  const { data: folders = [] } = useFolders(note.workspace_id)
  const { data: knownTags = [] } = useTags(note.workspace_id)
  const isPrivate = useIsPrivate(note.workspace_id)
  const { status, queue, flush } = useAutosave(note.updated_at, (v) => save.mutateAsync({ id: note.id, workspace_id: note.workspace_id, ...v }))

  const [title, setTitle] = useState(note.title)
  const [pinned, setPinned] = useState(note.pinned)
  const [folderId, setFolderId] = useState(note.folder_id)
  const [tags, setTags] = useState(note.tags.join(', '))

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: 'Start writing…' }),
    ],
    content: note.content,
    editorProps: { attributes: { class: 'note-editor', 'aria-label': 'Note content' } },
    onUpdate: ({ editor: e }) => queue({ content: e.getJSON(), content_text: e.getText({ blockSeparator: '\n' }) }),
  })

  const back = () => navigate(`/w/${note.workspace_id}/notes`)

  const onDelete = () => {
    remove.mutate(note.id, {
      onSuccess: () => {
        push(`Deleted "${note.title || 'Untitled'}"`, { label: 'Undo', onClick: () => restore.mutate(note) })
        back()
      },
      onError: (e) => push(`Could not delete: ${e.message}`),
    })
  }

  const commitTags = () => {
    const names = [...new Set(tags.split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))]
    if (names.join(',') !== note.tags.join(',')) queue({ tags: names }, true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {status === 'conflict' && (
        <div role="alert" className="glass flex items-center justify-between gap-3 rounded-xl border-red-400/50 p-3 text-sm">
          <span>This note was changed somewhere else, so saving is paused to protect those changes.</span>
          <button onClick={onReload} className="rounded-lg bg-accent px-3 py-1 text-white">Reload note</button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <button aria-label="Back to notes" onClick={back} className="rounded-lg p-2 hover:bg-white/10 md:hidden"><ArrowLeft size={18} /></button>
        <input
          value={title} maxLength={300} placeholder="Untitled" aria-label="Note title"
          onChange={(e) => { setTitle(e.target.value); queue({ title: e.target.value }) }}
          onBlur={() => void flush()}
          className="min-w-0 flex-1 bg-transparent text-2xl font-bold outline-none placeholder:text-muted"
        />
        <span className={cn('text-xs', status === 'error' || status === 'conflict' ? 'text-red-400' : 'text-muted')} aria-live="polite">
          {STATUS_TEXT[status]}
        </span>
        <button
          aria-label={pinned ? 'Unpin note' : 'Pin note'} aria-pressed={pinned} className="rounded-lg p-2 hover:bg-white/10"
          onClick={() => { setPinned(!pinned); queue({ pinned: !pinned }, true) }}
        >
          {pinned ? <PinOff size={18} /> : <Pin size={18} />}
        </button>
        <button aria-label="Delete note" onClick={onDelete} className="rounded-lg p-2 text-red-400 hover:bg-white/10"><Trash2 size={18} /></button>
      </div>

      {!isPrivate && <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="glass flex items-center gap-2 rounded-lg px-2 py-1">
          <span className="text-muted">Folder</span>
          <select
            value={folderId ?? ''} aria-label="Folder" className="bg-transparent outline-none"
            onChange={(e) => { const v = e.target.value || null; setFolderId(v); queue({ folder_id: v }, true) }}
          >
            <option value="" className="text-black">None</option>
            {folders.map((f) => <option key={f.id} value={f.id} className="text-black">{f.name}</option>)}
          </select>
        </label>
        <label className="glass flex min-w-40 flex-1 items-center gap-2 rounded-lg px-2 py-1">
          <span className="text-muted">Tags</span>
          <input
            value={tags} list="note-known-tags" placeholder="comma separated" aria-label="Tags"
            onChange={(e) => setTags(e.target.value)} onBlur={commitTags}
            onKeyDown={(e) => e.key === 'Enter' && commitTags()}
            className="min-w-0 flex-1 bg-transparent outline-none"
          />
          <datalist id="note-known-tags">{knownTags.map((t) => <option key={t} value={t} />)}</datalist>
        </label>
      </div>}

      {editor && <Toolbar editor={editor} />}
      <div className="glass min-h-0 flex-1 overflow-auto rounded-xl p-4" onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} />
      </div>
      <LinkedTodos noteId={note.id} workspaceId={note.workspace_id} />
    </div>
  )
}
