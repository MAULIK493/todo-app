import { useState, type FormEvent } from 'react'
import { Modal } from '@/components/Modal'
import { fromLocalInput, toLocalInput } from '@/lib/dates'
import type { ParsedTodo } from './parseQuickAdd'
import { ensureNotificationPermission, testNotification, unlockAudio } from './reminders'
import { PRIORITIES, type Recurrence } from './types'

export type NewTodo = ParsedTodo & { description: string; reminder_at: string | null }

type Props = { initial: ParsedTodo; allowTags: boolean; saving?: boolean; onSave: (todo: NewTodo) => void; onCancel: () => void }

const field = 'glass w-full rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-accent'

/** Asks for the time and other details before a todo is saved. */
export function NewTodoDialog({ initial, allowTags, saving, onSave, onCancel }: Props) {
  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState('')
  const [due, setDue] = useState(toLocalInput(initial.due_at))
  const [reminder, setReminder] = useState(toLocalInput(initial.due_at))
  const [reminderTouched, setReminderTouched] = useState(false)
  const [priority, setPriority] = useState<number>(initial.priority)
  const [recurrence, setRecurrence] = useState<Recurrence | ''>(initial.recurrence ?? '')
  const [testMsg, setTestMsg] = useState('')
  const [tags, setTags] = useState(initial.tags.join(', '))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    if (reminder) { unlockAudio(); void ensureNotificationPermission() } // inside the click, so the browser lets it ask
    onSave({
      title: title.trim(),
      description,
      due_at: fromLocalInput(due),
      reminder_at: fromLocalInput(reminder),
      priority: priority as ParsedTodo['priority'],
      recurrence: due && recurrence ? recurrence : null,
      tags: [...new Set(tags.split(',').map((t) => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean))],
    })
  }

  return (
    <Modal title="New todo" onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1 text-xs text-muted">Title
          <input autoFocus className={field} value={title} maxLength={500} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block space-y-1 text-xs text-muted">Notes
          <textarea className={field} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1 text-xs text-muted">Due
            <input
              type="datetime-local" className={field} value={due}
              onChange={(e) => { setDue(e.target.value); if (!reminderTouched) setReminder(e.target.value) }}
            />
          </label>
          <label className="block space-y-1 text-xs text-muted">Remind me at
            <input type="datetime-local" className={field} value={reminder} onChange={(e) => { setReminder(e.target.value); setReminderTouched(true) }} />
          </label>
          <label className="block space-y-1 text-xs text-muted">Priority
            <select className={field} value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-xs text-muted">Repeat
            <select className={field} value={recurrence} disabled={!due} onChange={(e) => setRecurrence(e.target.value as Recurrence | '')}>
              <option value="">Never</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
        </div>
        <div className="text-xs text-muted">
          <button type="button" className="text-accent underline" onClick={() => void testNotification().then(setTestMsg)}>Enable &amp; test notifications</button>
          {testMsg && <p role="status" className="mt-1">{testMsg}</p>}
        </div>
        {allowTags && (
          <label className="block space-y-1 text-xs text-muted">Tags (comma separated)
            <input className={field} value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onCancel} className="rounded-lg px-4 py-2 text-sm hover:bg-white/10">Cancel</button>
          <button type="submit" disabled={!title.trim() || saving} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Save todo</button>
        </div>
      </form>
    </Modal>
  )
}
