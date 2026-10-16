import { FileText, Pin } from 'lucide-react'
import { EmptyState } from '@/components/fx/EmptyState'
import { useEffect, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/dates'
import { usePinnedNotes, useRecentNotes, type NoteQuery } from './api'
import type { NoteSummary } from './types'

export function NoteList({ query, selectedId }: { query: NoteQuery; selectedId: string | undefined }) {
  const pinned = usePinnedNotes(query)
  const recent = useRecentNotes(query)
  const notes = recent.data?.pages.flat() ?? []
  const sentinel = useRef<HTMLDivElement>(null)

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = recent
  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage) return
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !isFetchingNextPage) fetchNextPage()
    }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, notes.length])

  if (pinned.isLoading || recent.isLoading) {
    return <div className="space-y-2" aria-busy>{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-16 shimmer rounded-xl bg-white/10" />)}</div>
  }
  const error = pinned.error ?? recent.error
  if (error) return <p className="text-sm text-red-400" role="alert">Could not load notes: {error.message}</p>

  const pinnedNotes = pinned.data ?? []
  if (!pinnedNotes.length && !notes.length) {
    return <EmptyState icon={FileText} title={query.search || query.tag ? 'No notes match.' : 'No notes yet. Create your first one.'} />
  }

  return (
    <div className="space-y-1">
      {pinnedNotes.length > 0 && <p className="px-1 pt-1 text-xs uppercase tracking-wide text-muted">Pinned</p>}
      {pinnedNotes.map((n) => <NoteItem key={n.id} note={n} active={n.id === selectedId} />)}
      {pinnedNotes.length > 0 && notes.length > 0 && <p className="px-1 pt-2 text-xs uppercase tracking-wide text-muted">Notes</p>}
      {notes.map((n) => <NoteItem key={n.id} note={n} active={n.id === selectedId} />)}
      <div ref={sentinel} />
      {isFetchingNextPage && <p className="p-2 text-center text-xs text-muted">Loading more…</p>}
    </div>
  )
}

function NoteItem({ note, active }: { note: NoteSummary; active: boolean }) {
  const [params] = useSearchParams()
  return (
    <Link
      to={{ pathname: `/w/${note.workspace_id}/notes/${note.id}`, search: params.toString() }}
      aria-current={active ? 'page' : undefined}
      className={cn('block rounded-xl px-3 py-2 transition-colors hover:bg-white/10', active && 'bg-white/10 ring-1 ring-accent')}
    >
      <div className="flex items-center gap-1">
        {note.pinned && <Pin size={12} className="shrink-0 text-accent" aria-label="Pinned" />}
        <span className={cn('truncate font-medium', !note.title && 'text-muted')}>{note.title || 'Untitled'}</span>
        <span className="ml-auto shrink-0 text-xs text-muted">{timeAgo(note.updated_at)}</span>
      </div>
      <p className="mt-0.5 line-clamp-2 text-sm text-muted">{note.preview || 'No content'}</p>
      {note.tags.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 text-xs text-muted">{note.tags.map((t) => <span key={t} className="rounded-full bg-white/10 px-2 py-0.5">#{t}</span>)}</div>
      )}
    </Link>
  )
}
