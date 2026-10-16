import { Trash2, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useTodoNotes } from '@/features/notes/api'
import { useIsPrivate } from '@/features/security/vault'
import { fromLocalInput, toLocalInput } from '@/lib/dates'
import { spring } from '@/lib/motion'
import { useSubtasks, useTags, useTodoMutations } from './api'
import { AnimatedCheck } from './AnimatedCheck'
import { PRIORITIES, type Recurrence, type Todo, type TodoStatus } from './types'

type Props = { todo: Todo; onClose: () => void; onDelete: (t: Todo) => void }

const field = 'glass w-full rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-accent'

export function TodoDetail({ todo, onClose, onDelete }: Props) {
  const { update } = useTodoMutations()
  const { data: knownTags = [] } = useTags(todo.workspace_id)
  const isPrivate = useIsPrivate(todo.workspace_id)
  const [status, setStatus] = useState<TodoStatus>(todo.status)
  const [title, setTitle] = useState(todo.title)
  const [description, setDescription] = useState(todo.description)
  const [priority, setPriority] = useState<number>(todo.priority)
  const [due, setDue] = useState(toLocalInput(todo.due_at))
  const [reminder, setReminder] = useState(toLocalInput(todo.reminder_at))
  const [recurrence, setRecurrence] = useState<Recurrence | ''>(todo.recurrence ?? '')
  const [tags, setTags] = useState(todo.tags.join(', '))

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    update.mutate(
      {
        id: todo.id,
        workspace_id: todo.workspace_id,
        title: title.trim(),
        description,
        priority: priority as Todo['priority'],
        // Finishing goes through complete/reopen so recurrence and undo keep working.
        ...(todo.status !== 'done' && { status }),
        due_at: fromLocalInput(due),
        reminder_at: fromLocalInput(reminder),
        // Recurrence needs a due date to repeat from (also enforced by a DB constraint).
        recurrence: due && recurrence ? recurrence : null,
        tags: [...new Set(tags.split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))],
      },
      { onSuccess: onClose },
    )
  }

  return (
    <>
      <motion.div className="fixed inset-0 z-30 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.aside
        role="dialog" aria-label="Todo details" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={spring}
        className="glass fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-auto bg-surface-solid p-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Details</h2>
          <button aria-label="Close" onClick={onClose} className="rounded-lg p-2 hover:bg-white/10"><X size={18} /></button>
        </div>
        <form onSubmit={save} className="space-y-3">
          <input className={field} value={title} maxLength={500} required aria-label="Title" onChange={(e) => setTitle(e.target.value)} />
          <textarea className={field} rows={4} value={description} maxLength={20000} placeholder="Description" aria-label="Description" onChange={(e) => setDescription(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-xs text-muted">Status
              <select className={field} value={status} disabled={todo.status === 'done'} onChange={(e) => setStatus(e.target.value as TodoStatus)}>
                <option value="open">To do</option><option value="in_progress">In progress</option>
                {todo.status === 'done' && <option value="done">Done</option>}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted">Priority
              <select className={field} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted">Repeats
              <select className={field} value={recurrence} disabled={!due} onChange={(e) => setRecurrence(e.target.value as Recurrence | '')}>
                <option value="">Never</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
              </select>
            </label>
          </div>
          <label className="block space-y-1 text-xs text-muted">Due
            <input type="datetime-local" className={field} value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="block space-y-1 text-xs text-muted">Reminder
            <input type="datetime-local" className={field} value={reminder} onChange={(e) => setReminder(e.target.value)} />
          </label>
          {!isPrivate && <label className="block space-y-1 text-xs text-muted">Tags (comma separated)
            <input className={field} value={tags} list="known-tags" onChange={(e) => setTags(e.target.value)} />
            <datalist id="known-tags">{knownTags.map((t) => <option key={t} value={t} />)}</datalist>
          </label>}
          {update.error && <p className="text-sm text-red-400" role="alert">{update.error.message}</p>}
          <div className="flex justify-between pt-2">
            <button type="button" onClick={() => onDelete(todo)} className="flex items-center gap-1 text-sm text-red-400">
              <Trash2 size={14} /> Delete
            </button>
            <button disabled={update.isPending} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-60">Save</button>
          </div>
        </form>
        {!todo.parent_id && <Subtasks parent={todo} />}
        <LinkedNotes todo={todo} />
      </motion.aside>
    </>
  )
}

function Subtasks({ parent }: { parent: Todo }) {
  const { data = [] } = useSubtasks(parent.id, parent.workspace_id)
  const { create, toggle, remove } = useTodoMutations()
  const [text, setText] = useState('')

  return (
    <section className="mt-6 border-t border-border pt-4">
      <h3 className="mb-2 text-sm font-medium">Subtasks</h3>
      <ul className="space-y-1">
        {data.map((s) => (
          <li key={s.id} className="group flex items-center gap-2">
            <AnimatedCheck checked={s.status === 'done'} label={s.title} onChange={() => toggle.mutate({ id: s.id, done: s.status !== 'done' })} />
            <span className={s.status === 'done' ? 'flex-1 text-muted line-through' : 'flex-1'}>{s.title}</span>
            <button aria-label={`Delete ${s.title}`} onClick={() => remove.mutate(s.id)} className="opacity-0 group-hover:opacity-100 focus:opacity-100"><X size={14} /></button>
          </li>
        ))}
      </ul>
      <form className="mt-2" onSubmit={(e) => {
        e.preventDefault()
        if (text.trim()) create.mutate({ workspace_id: parent.workspace_id, parent_id: parent.id, title: text.trim() }, { onSuccess: () => setText('') })
      }}>
        <input className={field} placeholder="Add a subtask" aria-label="Add a subtask" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
      </form>
    </section>
  )
}

function LinkedNotes({ todo }: { todo: Todo }) {
  const { data = [] } = useTodoNotes(todo.id, todo.workspace_id)
  if (!data.length) return null
  return (
    <section className="mt-6 border-t border-border pt-4">
      <h3 className="mb-2 text-sm font-medium">Linked notes</h3>
      <ul className="space-y-1">
        {data.map((n) => (
          <li key={n.id}>
            <Link to={`/w/${todo.workspace_id}/notes/${n.id}`} className="block truncate rounded-lg px-2 py-1 text-sm text-accent-2 hover:bg-white/10">
              {n.title || 'Untitled'}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
