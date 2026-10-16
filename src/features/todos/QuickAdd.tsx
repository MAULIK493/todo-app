import { CalendarClock, Flag, Plus, Repeat } from 'lucide-react'
import { useMemo, useState, type RefObject } from 'react'
import { formatDue } from '@/lib/dates'
import { parseQuickAdd } from './parseQuickAdd'
import { PRIORITIES } from './types'

type Props = { inputRef: RefObject<HTMLInputElement | null>; onAdd: (todo: ReturnType<typeof parseQuickAdd>) => void; allowTags?: boolean }

export function QuickAdd({ inputRef, onAdd, allowTags = true }: Props) {
  const [text, setText] = useState('')
  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text, new Date(), { tags: allowTags }) : null), [text, allowTags])
  const hasMeta = parsed && (parsed.due_at || parsed.priority || parsed.tags.length || parsed.recurrence)

  return (
    <form
      className="glass rounded-xl p-2"
      onSubmit={(e) => { e.preventDefault(); if (parsed) { onAdd(parsed); setText('') } }}
    >
      <div className="flex items-center gap-2">
        <Plus size={18} className="ml-1 text-accent" aria-hidden />
        <input
          ref={inputRef} value={text} maxLength={500} onChange={(e) => setText(e.target.value)}
          aria-label="Add a todo"
          placeholder='Add a todo… try "call mom tomorrow 6pm !high #family"'
          className="min-w-0 flex-1 bg-transparent py-1.5 outline-none placeholder:text-muted"
        />
      </div>
      {hasMeta && (
        <div className="mt-1 flex flex-wrap gap-2 px-7 text-xs text-muted">
          {parsed.due_at && <span className="flex items-center gap-1"><CalendarClock size={12} /> {formatDue(parsed.due_at)}</span>}
          {parsed.recurrence && <span className="flex items-center gap-1"><Repeat size={12} /> {parsed.recurrence}</span>}
          {parsed.priority > 0 && (
            <span className="flex items-center gap-1" style={{ color: PRIORITIES[parsed.priority].color }}>
              <Flag size={12} /> {PRIORITIES[parsed.priority].label}
            </span>
          )}
          {parsed.tags.map((t) => <span key={t}>#{t}</span>)}
        </div>
      )}
    </form>
  )
}
