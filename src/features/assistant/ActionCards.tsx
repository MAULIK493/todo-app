import { CheckCircle2, FilePlus2, ListPlus, Pencil, PlusCircle, Undo2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import type { Action } from '@shared/types.ts'
import { useToasts } from '@/stores/toasts'
import { canUndo, undoAction } from './actions'

function describe(a: Action) {
  switch (a.kind) {
    case 'todo_created': return { icon: PlusCircle, text: `Added “${a.title}” to ${a.workspace}` }
    case 'todo_completed': return { icon: CheckCircle2, text: `Completed “${a.title}”` }
    case 'todo_updated': return { icon: Pencil, text: `Updated “${a.title}”: ${a.changes.join(', ')}` }
    case 'subtasks_added': return { icon: ListPlus, text: `Added ${a.count} subtask${a.count === 1 ? '' : 's'} to “${a.parent_title}”` }
    case 'note_created': return { icon: FilePlus2, text: `Created note “${a.title}” in ${a.workspace}` }
  }
}

export function ActionCards({ actions }: { actions: Action[] }) {
  return (
    <ul className="mt-2 space-y-1.5" aria-label="What the assistant did">
      {actions.map((a, i) => <ActionCard key={i} action={a} />)}
    </ul>
  )
}

function ActionCard({ action }: { action: Action }) {
  const push = useToasts((s) => s.push)
  const [state, setState] = useState<'idle' | 'working' | 'undone'>('idle')
  const { icon: Icon, text } = describe(action)

  const undo = async () => {
    setState('working')
    try {
      await undoAction(action)
      setState('undone')
    } catch (e) {
      setState('idle')
      push(`Could not undo: ${e instanceof Error ? e.message : 'try again'}`)
    }
  }

  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs">
      <Icon size={14} className="shrink-0 text-accent" aria-hidden />
      <span className={state === 'undone' ? 'flex-1 text-muted line-through' : 'flex-1'}>{text}</span>
      {state === 'undone' ? <span className="text-muted">Undone</span> : canUndo(action) && (
        <button onClick={undo} disabled={state === 'working'} className="flex items-center gap-1 text-accent disabled:opacity-50">
          <Undo2 size={12} /> Undo
        </button>
      )}
    </motion.li>
  )
}
