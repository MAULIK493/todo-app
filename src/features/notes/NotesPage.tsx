import { FilePlus2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useIsPrivate } from '@/features/security/vault'
import { useTags } from '@/features/todos/api'
import { cn } from '@/lib/cn'
import { useDebounced } from '@/lib/useDebounced'
import { useToasts } from '@/stores/toasts'
import { useNoteMutations, type NoteQuery } from './api'
import { FolderBar } from './FolderBar'
import { NoteList } from './NoteList'
import type { FolderFilter } from './types'

export function NotesPage() {
  const { workspaceId = '', noteId } = useParams()
  const navigate = useNavigate()
  const push = useToasts((s) => s.push)
  const { create } = useNoteMutations()
  const { data: tags = [] } = useTags(workspaceId)
  const isPrivate = useIsPrivate(workspaceId)
  const [folder, setFolder] = useState<FolderFilter>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const search = useDebounced(searchText.trim(), 250)

  const query: NoteQuery = useMemo(() => ({ workspaceId, folder, tag, search }), [workspaceId, folder, tag, search])

  const newNote = () =>
    create.mutate(
      { workspace_id: workspaceId, folder_id: folder === 'all' || folder === 'none' ? null : folder },
      {
        onSuccess: (id) => navigate(`/w/${workspaceId}/notes/${id}`),
        onError: (e) => push(`Could not create note: ${e.message}`),
      },
    )

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      {/* Below md only one pane shows at a time: the list, or the open note. */}
      <aside className={cn('min-h-0 w-full flex-col gap-3 md:flex md:w-80 md:shrink-0', noteId ? 'hidden' : 'flex')}>
        <button
          onClick={newNote} disabled={create.isPending}
          className="flex items-center justify-center gap-2 rounded-xl bg-accent py-2 font-medium text-white disabled:opacity-60"
        >
          <FilePlus2 size={16} /> New note
        </button>
        <label className="glass flex items-center gap-2 rounded-xl px-3 py-1.5">
          <Search size={14} className="text-muted" aria-hidden />
          <input
            value={searchText} onChange={(e) => setSearchText(e.target.value)} aria-label="Search notes" placeholder={isPrivate ? 'Search titles' : 'Search notes'}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
        </label>
        {!isPrivate && <FolderBar workspaceId={workspaceId} value={folder} onChange={setFolder} />}
        {!isPrivate && tags.length > 0 && (
          <select
            value={tag ?? ''} onChange={(e) => setTag(e.target.value || null)} aria-label="Filter by tag"
            className="glass rounded-xl px-3 py-1.5 text-sm outline-none"
          >
            <option value="" className="text-black">Any tag</option>
            {tags.map((t) => <option key={t} value={t} className="text-black">#{t}</option>)}
          </select>
        )}
        <div className="min-h-0 flex-1 overflow-auto"><NoteList query={query} selectedId={noteId} /></div>
      </aside>

      <section className={cn('min-h-0 min-w-0 flex-1 flex-col md:flex', noteId ? 'flex' : 'hidden')}>
        <Outlet context={useOutletContext()} />
      </section>
    </div>
  )
}
