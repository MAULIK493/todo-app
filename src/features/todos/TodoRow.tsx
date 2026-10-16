import { CalendarClock, ListChecks, Repeat } from 'lucide-react'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { formatDue } from '@/lib/dates'
import { AnimatedCheck } from './AnimatedCheck'
import { SelectBox } from './SelectBox'
import { PRIORITIES, type Todo } from './types'

type Props = {
  todo: Todo
  onToggle: (t: Todo) => void
  onOpen: (t: Todo) => void
  dragHandle?: ReactNode
  selectMode?: boolean
  selected?: boolean
  onSelect?: (t: Todo, shift: boolean) => void
  /** Compact card styling used by the Kanban board. */
  card?: boolean
  /** Being completed right now: play the strike-through and slide-away before the row disappears. */
  completing?: boolean
}

export function TodoRow({ todo, onToggle, onOpen, dragHandle, selectMode, selected, onSelect, card, completing }: Props) {
  const done = todo.status === 'done' || !!completing
  const overdue = !done && todo.due_at !== null && new Date(todo.due_at) < new Date()
  const subtasks = todo.subtasks?.[0]?.count ?? 0
  const activate = (shift: boolean) => (selectMode ? onSelect?.(todo, shift) : onOpen(todo))

  return (
    <motion.div
      animate={completing ? { x: 56, opacity: 0 } : { x: 0, opacity: 1 }}
      transition={completing ? { duration: 0.32, delay: 0.2, ease: 'easeIn' } : { duration: 0 }}
      role="button" tabIndex={0} onClick={(e) => activate(e.shiftKey)}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) activate(e.shiftKey) }}
      className={cn(
        'flex cursor-pointer items-start gap-2 px-3 py-3 transition-colors focus-visible:outline-none',
        card ? 'glass rounded-xl bg-surface-solid' : 'border-b border-border hover:bg-white/5 focus-visible:bg-white/10',
        selected && 'bg-accent/15',
      )}
    >
      {dragHandle}
      {selectMode && <SelectBox checked={!!selected} label={`Select ${todo.title}`} onClick={(e) => onSelect?.(todo, e.shiftKey)} />}
      <AnimatedCheck checked={done} onChange={() => onToggle(todo)} label={done ? `Reopen ${todo.title}` : `Complete ${todo.title}`} />
      <div className="min-w-0 flex-1">
        <p className={cn('relative', card ? 'line-clamp-2' : 'truncate', done && !completing && 'text-muted line-through', completing && 'text-muted')}>
          {todo.title}
          {completing && <motion.span aria-hidden className="absolute inset-x-0 top-1/2 h-0.5 origin-left rounded bg-accent" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.22, ease: 'easeOut' }} />}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          {todo.status === 'in_progress' && !card && <span className="rounded-full bg-accent/20 px-2 py-0.5 text-accent">In progress</span>}
          {todo.due_at && (
            <span className={cn('flex items-center gap-1', overdue && 'text-red-400')}>
              <CalendarClock size={12} /> {formatDue(todo.due_at)}
            </span>
          )}
          {todo.recurrence && <span className="flex items-center gap-1"><Repeat size={12} /> {todo.recurrence}</span>}
          {subtasks > 0 && <span className="flex items-center gap-1"><ListChecks size={12} /> {subtasks}</span>}
          {todo.tags.map((t) => <span key={t} className="rounded-full bg-white/10 px-2 py-0.5">#{t}</span>)}
        </div>
      </div>
      {todo.priority > 0 && (
        <span
          className="mt-1.5 size-2.5 shrink-0 rounded-full" title={`${PRIORITIES[todo.priority].label} priority`}
          style={{ background: PRIORITIES[todo.priority].color }}
        />
      )}
    </motion.div>
  )
}
