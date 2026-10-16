import { closestCenter, DndContext, DragOverlay } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef, useState } from 'react'
import { SwipeRow, useCoarsePointer } from '@/components/fx/SwipeRow'
import { EmptyState } from '@/components/fx/EmptyState'
import { useEffectFlags } from '@/features/appearance/store'
import { ListChecks } from 'lucide-react'
import { DragHandle } from './DragHandle'
import { anchorFor, useDndSensors } from './dnd'
import type { Selection } from './selection'
import { TodoRow } from './TodoRow'
import type { Todo, TodoView } from './types'

type Props = {
  rows: Todo[]
  view: TodoView
  /** Manual ordering only makes sense for the unfiltered "All" list. */
  canReorder: boolean
  isLoading: boolean
  error: Error | null
  hasNextPage: boolean
  isFetchingNextPage: boolean
  fetchNextPage: () => void
  emptyText: string
  selection: Selection
  completingIds: ReadonlySet<string>
  onToggle: (t: Todo) => void
  onOpen: (t: Todo) => void
  onDelete: (t: Todo) => void
  onMove: (todo: Todo, afterId: string | null) => void
}

export function ListView(p: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastClicked = useRef<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useDndSensors()
  const touch = useCoarsePointer()
  const flags = useEffectFlags()

  const virtual = useVirtualizer({
    count: p.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
  })
  const items = virtual.getVirtualItems()
  const lastIndex = items.length ? items[items.length - 1].index : -1

  const { rows, hasNextPage, isFetchingNextPage, fetchNextPage } = p
  useEffect(() => {
    if (lastIndex >= rows.length - 10 && hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [lastIndex, rows.length, hasNextPage, isFetchingNextPage, fetchNextPage])

  const select = (t: Todo, shift: boolean) => {
    const { toggle, setMany } = p.selection
    const anchor = shift && lastClicked.current ? rows.findIndex((r) => r.id === lastClicked.current) : -1
    if (anchor >= 0) {
      const [a, b] = [anchor, rows.findIndex((r) => r.id === t.id)].sort((x, y) => x - y)
      setMany(rows.slice(a, b + 1), true)
    } else toggle(t)
    lastClicked.current = t.id
  }

  const swipeable = touch && flags.springs && !p.selection.mode
  const row = (t: Todo, handle?: React.ReactNode) => (
    <SwipeRow enabled={swipeable && !p.completingIds.has(t.id)} onComplete={() => p.onToggle(t)} onDelete={() => p.onDelete(t)}>
    <TodoRow
      todo={t} onToggle={p.onToggle} onOpen={p.onOpen} dragHandle={handle}
      selectMode={p.selection.mode} selected={p.selection.selected.has(t.id)} onSelect={select} completing={p.completingIds.has(t.id)}
    />
    </SwipeRow>
  )
  const active = activeId ? rows.find((t) => t.id === activeId) : undefined

  return (
    <div ref={scrollRef} className="glass min-h-0 flex-1 overflow-auto rounded-xl">
      {p.isLoading ? (
        <div className="space-y-3 p-4" aria-busy>
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-10 shimmer rounded-lg bg-white/10" />)}
        </div>
      ) : p.error ? (
        <p className="p-6 text-red-400" role="alert">Could not load todos: {p.error.message}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={ListChecks} title={p.emptyText} />
      ) : (
        <DndContext
          sensors={sensors} collisionDetection={closestCenter}
          onDragStart={(e) => setActiveId(String(e.active.id))}
          onDragCancel={() => setActiveId(null)}
          onDragEnd={({ active: a, over }) => {
            setActiveId(null)
            if (!over || a.id === over.id) return
            const todo = rows.find((t) => t.id === a.id)
            if (todo) p.onMove(todo, anchorFor(rows, String(a.id), String(over.id)))
          }}
        >
          {/* Only mounted rows take part in sorting; the server finds the true neighbours on drop. */}
          <SortableContext items={items.map((vi) => rows[vi.index].id)} strategy={verticalListSortingStrategy} disabled={!p.canReorder}>
            <div style={{ height: virtual.getTotalSize(), position: 'relative' }}>
              {items.map((vi) => (
                <div
                  key={rows[vi.index].id} data-index={vi.index} ref={virtual.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
                >
                  <SortableRow todo={rows[vi.index]} enabled={p.canReorder} render={row} />
                </div>
              ))}
            </div>
          </SortableContext>
          <DragOverlay>{active ? <div className="glass rounded-xl bg-surface-solid shadow-2xl">{row(active)}</div> : null}</DragOverlay>
        </DndContext>
      )}
      {p.isFetchingNextPage && <p className="p-3 text-center text-xs text-muted">Loading more…</p>}
    </div>
  )
}

function SortableRow({ todo, enabled, render }: { todo: Todo; enabled: boolean; render: (t: Todo, handle?: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id, disabled: !enabled })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}>
      {render(todo, enabled ? <DragHandle {...attributes} {...listeners} /> : undefined)}
    </div>
  )
}
