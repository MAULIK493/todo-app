import { ShieldQuestion } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { runConfirm } from './actions'
import type { ConfirmState } from './messages'
import { useAssistant } from './store'

const SHOWN = 5

/** Bulk or destructive changes wait here until the user presses Confirm. */
export function ConfirmCard({ messageId, confirm }: { messageId: string; confirm: ConfirmState }) {
  const patch = useAssistant((s) => s.patchConfirm)

  const approve = async () => {
    patch(messageId, confirm.id, { state: 'running', note: undefined })
    try {
      patch(messageId, confirm.id, { state: 'done', note: await runConfirm(confirm) })
    } catch (e) {
      patch(messageId, confirm.id, { state: 'error', note: e instanceof Error ? e.message : 'That did not work.' })
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} role="group" aria-label="Needs your confirmation"
      className={cn('mt-2 space-y-2 rounded-xl border p-3 text-sm', confirm.kind === 'delete_todos' ? 'border-red-400/40 bg-red-500/10' : 'border-amber-400/40 bg-amber-500/10')}
    >
      <p className="flex items-center gap-2 font-medium"><ShieldQuestion size={16} aria-hidden /> {confirm.summary}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
        {confirm.items.slice(0, SHOWN).map((i) => <li key={i.id}>{i.title}</li>)}
        {confirm.items.length > SHOWN && <li>and {confirm.items.length - SHOWN} more</li>}
      </ul>
      {confirm.state === 'done' || confirm.state === 'error' ? (
        <p className={confirm.state === 'error' ? 'text-red-400' : 'text-green-400'} role="status">{confirm.note}</p>
      ) : confirm.state === 'cancelled' ? (
        <p className="text-muted" role="status">Cancelled. Nothing was changed.</p>
      ) : (
        <div className="flex gap-2">
          <button onClick={approve} disabled={confirm.state === 'running'} className={cn('rounded-lg px-3 py-1.5 text-white disabled:opacity-60', confirm.kind === 'delete_todos' ? 'bg-red-500' : 'bg-accent')}>
            {confirm.state === 'running' ? 'Working…' : 'Confirm'}
          </button>
          <button onClick={() => patch(messageId, confirm.id, { state: 'cancelled' })} disabled={confirm.state === 'running'} className="glass rounded-lg px-3 py-1.5 disabled:opacity-60">Cancel</button>
        </div>
      )}
    </motion.div>
  )
}
