import { Link2, X } from 'lucide-react'
import { useState } from 'react'
import { useDebounced } from '@/lib/useDebounced'
import { useLinkMutations, useNoteTodos, useSearchTodosToLink } from './api'

export function LinkedTodos({ noteId, workspaceId }: { noteId: string; workspaceId: string }) {
  const { data: linked = [] } = useNoteTodos(noteId, workspaceId)
  const { link, unlink } = useLinkMutations(noteId)
  const [text, setText] = useState('')
  const query = useDebounced(text.trim(), 250)
  const { data: results = [] } = useSearchTodosToLink(workspaceId, query)
  const linkedIds = new Set(linked.map((t) => t.id))

  return (
    <section aria-label="Linked todos" className="space-y-2">
      <h3 className="flex items-center gap-1 text-sm font-medium"><Link2 size={14} /> Linked todos</h3>
      <ul className="space-y-1">
        {linked.map((t) => (
          <li key={t.id} className="glass flex items-center gap-2 rounded-lg px-2 py-1 text-sm">
            <span className={t.status === 'done' ? 'flex-1 truncate text-muted line-through' : 'flex-1 truncate'}>{t.title}</span>
            <button aria-label={`Unlink ${t.title}`} onClick={() => unlink.mutate(t.id)} className="text-muted hover:text-text"><X size={14} /></button>
          </li>
        ))}
      </ul>
      <input
        value={text} onChange={(e) => setText(e.target.value)} placeholder="Search todos to link…" aria-label="Search todos to link"
        className="glass w-full rounded-lg px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-accent"
      />
      {query && (
        <ul className="space-y-1">
          {results.filter((t) => !linkedIds.has(t.id)).map((t) => (
            <li key={t.id}>
              <button
                onClick={() => { link.mutate(t.id); setText('') }}
                className="w-full truncate rounded-lg px-2 py-1 text-left text-sm hover:bg-white/10"
              >
                + {t.title}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-2 text-xs text-muted">No matching todos.</li>}
        </ul>
      )}
      {(link.error || unlink.error) && <p className="text-xs text-red-400" role="alert">{(link.error ?? unlink.error)!.message}</p>}
    </section>
  )
}
