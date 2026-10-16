import { CheckCheck, RotateCcw, Tag, Trash2, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { spring } from '@/lib/motion'
import { useToasts } from '@/stores/toasts'
import { useBulkMutations, useTodoMutations } from './api'
import { PRIORITIES, type Todo } from './types'

type Props = { selected: Map<string, Todo>; onClear: () => void; onSelectAll?: () => void; allowTags?: boolean }

const btn = 'flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm hover:bg-white/10'

export function BulkBar({ selected, onClear, onSelectAll, allowTags = true }: Props) {
  const push = useToasts((s) => s.push)
  const bulk = useBulkMutations()
  const { restore } = useTodoMutations()
  const [tagging, setTagging] = useState(false)
  const [tagName, setTagName] = useState('')

  const todos = [...selected.values()]
  const ids = todos.map((t) => t.id)
  const allDone = todos.every((t) => t.status === 'done')
  const count = ids.length
  const noun = `${count} todo${count === 1 ? '' : 's'}`
  const fail = (e: Error) => push(`Failed: ${e.message}`)

  const complete = () =>
    bulk.complete.mutate({ ids }, {
      onError: fail,
      onSuccess: () => push(`Completed ${noun}`, { label: 'Undo', onClick: () => bulk.reopen.mutate({ ids }) }),
    })
  const reopen = () => bulk.reopen.mutate({ ids }, { onError: fail, onSuccess: () => push(`Reopened ${noun}`) })
  const remove = () => {
    const hasSubtasks = todos.some((t) => (t.subtasks?.[0]?.count ?? 0) > 0)
    if (!window.confirm(`Delete ${noun}${hasSubtasks ? ' and their subtasks' : ''}?`)) return
    bulk.remove.mutate({ ids }, {
      onError: fail,
      // Undo restores the todos themselves, so it is not offered when subtasks would be lost.
      onSuccess: () => push(`Deleted ${noun}`, hasSubtasks ? undefined : { label: 'Undo', onClick: () => restore.mutate(todos) }),
    })
    onClear()
  }

  return (
    <motion.div
      initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }} transition={spring}
      className="glass sticky bottom-0 z-20 flex flex-wrap items-center gap-1 rounded-xl bg-surface-solid p-2 shadow-lg"
      role="toolbar" aria-label="Bulk actions"
    >
      <span className="px-2 text-sm font-medium">{count} selected</span>
      {onSelectAll && <button className={btn} onClick={onSelectAll}>Select all loaded</button>}
      {count > 0 && (
        <>
          {allDone
            ? <button className={btn} onClick={reopen}><RotateCcw size={14} /> Reopen</button>
            : <button className={btn} onClick={complete}><CheckCheck size={14} /> Complete</button>}
          <label className={btn}>
            Priority
            <select
              aria-label="Set priority" value="" className="bg-transparent outline-none"
              onChange={(e) => bulk.priority.mutate({ ids, priority: Number(e.target.value) }, { onError: fail, onSuccess: () => push(`Updated priority for ${noun}`) })}
            >
              <option value="" disabled>Set…</option>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value} className="text-black">{p.label}</option>)}
            </select>
          </label>
          {!allowTags ? null : tagging ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                if (!tagName.trim()) return
                bulk.tag.mutate({ ids, name: tagName }, { onError: fail, onSuccess: () => push(`Tagged ${noun} #${tagName.trim().toLowerCase()}`) })
                setTagging(false); setTagName('')
              }}
            >
              <input autoFocus value={tagName} maxLength={40} onChange={(e) => setTagName(e.target.value)} aria-label="Tag name" placeholder="tag" className="glass w-24 rounded-lg px-2 py-1 text-sm outline-none" />
            </form>
          ) : (
            <button className={btn} onClick={() => setTagging(true)}><Tag size={14} /> Tag</button>
          )}
          <button className={`${btn} text-red-400`} onClick={remove}><Trash2 size={14} /> Delete</button>
        </>
      )}
      <button className={`${btn} ml-auto`} onClick={onClear} aria-label="Exit selection"><X size={14} /> Done</button>
    </motion.div>
  )
}
