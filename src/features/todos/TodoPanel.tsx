import { CheckSquare, Columns3, List, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { useDebounced } from '@/lib/useDebounced'
import { useIsPrivate } from '@/features/security/vault'
import { useEffectFlags } from '@/features/appearance/store'
import { useToasts } from '@/stores/toasts'
import { useTodoMutations, useTodos } from './api'
import { BulkBar } from './BulkBar'
import { ListView } from './ListView'
import { NewTodoDialog } from './NewTodoDialog'
import type { ParsedTodo } from './parseQuickAdd'
import { QuickAdd } from './QuickAdd'
import type { Selection } from './selection'
import { TodoDetail } from './TodoDetail'
import { VIEWS, type Todo, type TodoView } from './types'

/** How long a completed row stays on screen to finish its animation (strike-through, then slide-out). */
const COMPLETE_ANIMATION_MS = 560

// Only loaded if someone switches to the board layout.
const BoardView = lazy(() => import('./BoardView').then((m) => ({ default: m.BoardView })))
type BoardProps = React.ComponentProps<typeof BoardView>

const EMPTY: Record<string, string> = {
  all: 'Nothing to do. Add your first todo above.',
  today: 'Nothing due today.',
  upcoming: 'Nothing upcoming.',
  overdue: 'You are all caught up.',
  completed: 'Completed todos will show up here.',
}

export function TodoPanel({ workspaceId }: { workspaceId: string }) {
  const [params, setParams] = useSearchParams()
  const board = params.get('layout') === 'board'
  const view = (VIEWS.find((v) => v.id === params.get('view'))?.id ?? 'all') as Exclude<TodoView, 'todo' | 'doing'>
  const [searchText, setSearchText] = useState('')
  const search = useDebounced(searchText.trim(), 250)
  const [detail, setDetail] = useState<Todo | null>(null)
  const [draft, setDraft] = useState<ParsedTodo | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Map<string, Todo>>(new Map())
  const push = useToasts((s) => s.push)
  const isPrivate = useIsPrivate(workspaceId)
  const flags = useEffectFlags()
  const [completing, setCompleting] = useState<ReadonlySet<string>>(new Set())
  const { create, toggle, remove, restore, move } = useTodoMutations()

  const list = useTodos(workspaceId, view, search, !board)
  const rows = useMemo(() => list.data?.pages.flat() ?? [], [list.data])

  const addRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const setParam = (key: string, value: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value); else next.delete(key)
      return next
    }, { replace: true })

  const exitSelection = useCallback(() => { setSelectMode(false); setSelected(new Map()) }, [])
  // Selections don't carry over between views/layouts, where the rows are different.
  useEffect(exitSelection, [view, board, exitSelection])

  // Keyboard shortcuts: n = new todo, / = search, Esc = close details / leave selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setDetail(null); exitSelection(); return }
      const el = e.target as HTMLElement
      if (el.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'n') { e.preventDefault(); addRef.current?.focus() }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exitSelection])

  const selection: Selection = useMemo(() => ({
    mode: selectMode,
    selected,
    toggle: (t) => setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(t.id)) next.delete(t.id); else next.set(t.id, t)
      return next
    }),
    setMany: (todos, on) => setSelected((prev) => {
      const next = new Map(prev)
      for (const t of todos) { if (on) next.set(t.id, t); else next.delete(t.id) }
      return next
    }),
  }), [selectMode, selected])

  const onToggle = useCallback((t: Todo) => {
    const done = t.status !== 'done'
    if (done && flags.flourishes) {
      // Sent now; the row strikes through and slides away, then leaves the list.
      setCompleting((prev) => new Set(prev).add(t.id))
      setTimeout(() => setCompleting((prev) => { const next = new Set(prev); next.delete(t.id); return next }), COMPLETE_ANIMATION_MS + 200)
      toggle.mutate({ id: t.id, done, delayMs: COMPLETE_ANIMATION_MS })
    } else toggle.mutate({ id: t.id, done })
    push(done ? `Completed "${t.title}"` : `Reopened "${t.title}"`, {
      label: 'Undo',
      onClick: () => toggle.mutate({ id: t.id, done: !done }),
    })
  }, [toggle, push, flags.flourishes])

  const onDelete = useCallback((t: Todo) => {
    const hasSubtasks = (t.subtasks?.[0]?.count ?? 0) > 0
    if (hasSubtasks && !window.confirm('This also deletes its subtasks. Continue?')) return
    remove.mutate(t.id)
    setDetail(null)
    // Undo can only restore the todo itself, so skip it when subtasks would be lost.
    push(`Deleted "${t.title}"`, hasSubtasks ? undefined : { label: 'Undo', onClick: () => restore.mutate([t]) })
  }, [remove, restore, push])

  const onMove: BoardProps['onMove'] = (v) =>
    move.mutate(v, { onError: (e) => push(`Could not move: ${e.message}`) })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <QuickAdd inputRef={addRef} allowTags={!isPrivate} onAdd={setDraft} />
      {draft && (
        <NewTodoDialog
          initial={draft} allowTags={!isPrivate} saving={create.isPending} onCancel={() => setDraft(null)}
          onSave={(p) => {
            create.mutate({ ...p, workspace_id: workspaceId }, { onSuccess: () => push(`Added "${p.title}"`) })
            setDraft(null)
          }}
        />
      )}
      {create.error && <p className="text-sm text-red-400" role="alert">{create.error.message}</p>}

      <div className="flex items-center gap-2">
        <label className="glass flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2">
          <Search size={16} className="shrink-0 text-muted" aria-hidden />
          <input
            ref={searchRef} value={searchText} onChange={(e) => setSearchText(e.target.value)} aria-label="Search todos"
            placeholder="Search todos" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <kbd className="hidden rounded bg-white/10 px-1.5 text-[10px] text-muted md:inline" aria-hidden>/</kbd>
        </label>
        <div role="group" aria-label="Layout" className="glass flex shrink-0 rounded-xl p-1">
          {([['list', List, 'List'], ['board', Columns3, 'Board']] as const).map(([id, Icon, label]) => (
            <button
              key={id} aria-pressed={(id === 'board') === board} aria-label={label} title={label}
              onClick={() => setParam('layout', id === 'board' ? 'board' : null)}
              className={cn('flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm', (id === 'board') === board ? 'bg-accent text-white' : 'text-muted hover:text-text')}
            >
              <Icon size={16} /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
        <button
          aria-pressed={selectMode} onClick={() => (selectMode ? exitSelection() : setSelectMode(true))} title="Select several todos"
          className={cn('glass flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm', selectMode && 'bg-accent text-white')}
        >
          <CheckSquare size={16} /> <span className="hidden sm:inline">Select</span>
        </button>
      </div>

      {!board && (
        // Scrolls sideways on a narrow screen instead of wrapping onto a second line.
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div role="tablist" aria-label="Show" className="glass flex w-max rounded-xl p-1">
            {VIEWS.map((v) => (
              <button
                key={v.id} role="tab" aria-selected={v.id === view}
                onClick={() => setParam('view', v.id === 'all' ? null : v.id)}
                className={cn('relative whitespace-nowrap rounded-lg px-3 py-1.5 text-sm', v.id === view ? 'text-white' : 'text-muted hover:text-text')}
              >
                {v.id === view && (
                  <motion.span layoutId="view-pill" className="absolute inset-0 rounded-lg bg-accent" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
                )}
                <span className="relative">{v.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {board ? (
        <Suspense fallback={<div className="glass shimmer min-h-0 flex-1 rounded-xl" aria-busy />}>
          <BoardView workspaceId={workspaceId} search={search} selection={selection} onToggle={onToggle} onOpen={setDetail} onMove={onMove} completingIds={completing} />
        </Suspense>
      ) : (
        <ListView
          rows={rows} view={view} isLoading={list.isLoading} error={list.error}
          hasNextPage={list.hasNextPage} isFetchingNextPage={list.isFetchingNextPage} fetchNextPage={list.fetchNextPage}
          // Manual order only applies to the unfiltered All list.
          canReorder={view === 'all' && !search && !selectMode}
          emptyText={search ? 'No todos match your search.' : EMPTY[view]}
          selection={selection} onToggle={onToggle} onOpen={setDetail} onDelete={onDelete} completingIds={completing}
          onMove={(todo, afterId) => onMove({ todo, afterId, fromView: 'all', toView: 'all' })}
        />
      )}

      <AnimatePresence>
        {selectMode && (
          <BulkBar
            selected={selected} onClear={exitSelection} allowTags={!isPrivate}
            onSelectAll={board ? undefined : () => selection.setMany(rows.slice(0, 2000), true)}
          />
        )}
        {detail && <TodoDetail key={detail.id} todo={detail} onClose={() => setDetail(null)} onDelete={onDelete} />}
      </AnimatePresence>
    </div>
  )
}
