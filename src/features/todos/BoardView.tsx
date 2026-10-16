import { closestCorners, DndContext, DragOverlay, useDroppable } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { useTodos } from './api'
import { DragHandle } from './DragHandle'
import { anchorFor, useDndSensors } from './dnd'
import type { Selection } from './selection'
import { TodoRow } from './TodoRow'
import { BOARD_COLUMNS, type Todo, type TodoView } from './types'

type Props = {
  workspaceId: string
  search: string
  selection: Selection
  completingIds: ReadonlySet<string>
  onToggle: (t: Todo) => void
  onOpen: (t: Todo) => void
  onMove: (v: { todo: Todo; afterId: string | null; fromView: TodoView; toView: TodoView; status?: 'open' | 'in_progress' }) => void
}

type Column = (typeof BOARD_COLUMNS)[number]

export function BoardView({ workspaceId, search, selection, completingIds, onToggle, onOpen, onMove }: Props) {
  const sensors = useDndSensors()
  const [activeId, setActiveId] = useState<string | null>(null)

  // One query per column (fixed set, so the hooks order is stable).
  const todo = useTodos(workspaceId, 'todo', search)
  const doing = useTodos(workspaceId, 'doing', search)
  const done = useTodos(workspaceId, 'completed', search)
  const queries = { todo, doing, completed: done } as const
  const lists: Record<string, Todo[]> = {
    todo: todo.data?.pages.flat() ?? [],
    doing: doing.data?.pages.flat() ?? [],
    completed: done.data?.pages.flat() ?? [],
  }

  const active = activeId ? Object.values(lists).flat().find((t) => t.id === activeId) : undefined

  const onDragEnd = ({ active: a, over }: { active: { id: string | number; data: { current?: { view?: TodoView } } }; over: { id: string | number; data: { current?: { view?: TodoView } } } | null }) => {
    setActiveId(null)
    if (!over) return
    const activeKey = String(a.id)
    const overKey = String(over.id)
    const fromView = a.data.current?.view
    const toView = overKey.startsWith('col:') ? (overKey.slice(4) as TodoView) : over.data.current?.view
    if (!fromView || !toView) return
    const todo = lists[fromView].find((t) => t.id === activeKey)
    if (!todo || activeKey === overKey) return
    // Done is ordered by completion time, so it can't be reordered by hand.
    if (fromView === 'completed' && toView === 'completed') return

    const target = lists[toView].filter((t) => t.id !== activeKey)
    const afterId = overKey.startsWith('col:')
      ? (target.length ? target[target.length - 1].id : null)
      : fromView === toView
        ? anchorFor(lists[toView], activeKey, overKey)
        : anchorFor(target, activeKey, overKey)

    if (toView === 'completed') {
      onToggle(todo) // completing goes through complete_todo (recurrence, undo toast)
      return
    }
    const status = BOARD_COLUMNS.find((c) => c.view === toView)!.status as 'open' | 'in_progress'
    onMove({ todo, afterId, fromView, toView, status: fromView === toView ? undefined : status })
  }

  return (
    <DndContext
      sensors={sensors} collisionDetection={closestCorners}
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={onDragEnd}
    >
      <div className="grid min-h-0 flex-1 gap-3 overflow-auto md:grid-cols-3">
        {BOARD_COLUMNS.map((col) => (
          <BoardColumn
            key={col.view} column={col} todos={lists[col.view]} query={queries[col.view as keyof typeof queries]}
            selection={selection} completingIds={completingIds} onToggle={onToggle} onOpen={onOpen}
          />
        ))}
      </div>
      <DragOverlay>{active ? <TodoRow card todo={active} onToggle={onToggle} onOpen={onOpen} /> : null}</DragOverlay>
    </DndContext>
  )
}

type ColumnQuery = ReturnType<typeof useTodos>

function BoardColumn({ column, todos, query, selection, completingIds, onToggle, onOpen }: {
  column: Column; todos: Todo[]; query: ColumnQuery; selection: Selection; completingIds: ReadonlySet<string>; onToggle: Props['onToggle']; onOpen: Props['onOpen']
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.view}` })
  return (
    <section
      ref={setNodeRef} aria-label={column.label}
      className={cn('glass flex min-h-48 flex-col rounded-xl p-2 transition-colors md:min-h-0', isOver && 'ring-2 ring-accent')}
    >
      <h2 className="px-2 py-1 text-sm font-semibold">{column.label}</h2>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-1">
        {query.isLoading && <div className="h-14 shimmer rounded-xl bg-white/10" aria-busy />}
        {query.error && <p className="text-sm text-red-400" role="alert">{query.error.message}</p>}
        <SortableContext items={todos.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {todos.map((t) => (
            <BoardCard
              key={t.id} todo={t} view={column.view} selection={selection} completing={completingIds.has(t.id)}
              onToggle={onToggle} onOpen={onOpen}
            />
          ))}
        </SortableContext>
        {!query.isLoading && todos.length === 0 && <p className="p-3 text-center text-sm text-muted">Drop todos here</p>}
        {query.hasNextPage && (
          <button onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage} className="w-full py-2 text-sm text-muted hover:text-text">
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </section>
  )
}

function BoardCard({ todo, view, selection, completing, onToggle, onOpen }: {
  todo: Todo; view: TodoView; selection: Selection; completing: boolean; onToggle: Props['onToggle']; onOpen: Props['onOpen']
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: todo.id, data: { view } })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}>
      <TodoRow
        card todo={todo} onToggle={onToggle} onOpen={onOpen} completing={completing}
        dragHandle={<DragHandle {...attributes} {...listeners} />}
        selectMode={selection.mode} selected={selection.selected.has(todo.id)} onSelect={(t) => selection.toggle(t)}
      />
    </div>
  )
}
