import { AlertCircle, Lock } from 'lucide-react'
import { motion } from 'motion/react'
import { cn } from '@/lib/cn'
import { ActionCards } from './ActionCards'
import { ConfirmCard } from './ConfirmCard'
import type { ChatMessage } from './messages'
import { RichText } from './RichTextView'

export function MessageBubble({ message: m }: { message: ChatMessage }) {
  const mine = m.role === 'user'
  const waiting = m.status === 'streaming' && !m.text

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <div className={cn('max-w-[92%] rounded-2xl px-3.5 py-2.5', mine ? 'whitespace-pre-wrap bg-accent text-sm text-white' : 'glass')}>
        {mine ? m.text : m.text ? <RichText text={m.text} /> : null}

        {waiting && (
          <div className="flex items-center gap-1 py-1" role="status" aria-label={m.activity ?? 'Thinking'}>
            {[0, 1, 2].map((i) => (
              <motion.span key={i} className="size-1.5 rounded-full bg-muted" animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }} />
            ))}
            {m.activity && <span className="ml-2 text-xs text-muted">{m.activity}</span>}
          </div>
        )}
        {!waiting && m.activity && <p className="mt-1 text-xs text-muted" role="status">{m.activity}</p>}
        {m.status === 'streaming' && m.text && !m.activity && (
          <motion.span aria-hidden className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 rounded-sm bg-accent" animate={{ opacity: [1, 0.2, 1] }} transition={{ repeat: Infinity, duration: 0.9 }} />
        )}
      </div>

      {m.actions.length > 0 && <div className="w-full max-w-[92%]"><ActionCards actions={m.actions} /></div>}
      {m.confirms.map((c) => <div key={c.id} className="w-full max-w-[92%]"><ConfirmCard messageId={m.id} confirm={c} /></div>)}

      {m.error && (
        <p className="mt-1 flex max-w-[92%] items-start gap-1 text-xs text-red-400" role="alert"><AlertCircle size={13} className="mt-0.5 shrink-0" /> {m.error}</p>
      )}
      {m.unsaved && !mine && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted"><Lock size={11} /> Used private content, so this exchange isn’t saved.</p>
      )}
    </motion.div>
  )
}
