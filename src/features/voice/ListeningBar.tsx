import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { VoiceInput } from './useVoiceInput'

/** Shows what the microphone is hearing, or why it stopped. */
export function ListeningBar({ voice }: { voice: VoiceInput }) {
  const active = voice.status !== 'idle'
  return (
    <AnimatePresence initial={false}>
      {(active || voice.error) && (
        <motion.div
          initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          {voice.error && !active ? (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-500/15 p-2.5 text-xs text-red-300">
              <span className="flex-1">{voice.error}</span>
              <button aria-label="Dismiss" onClick={voice.clearError}><X size={14} /></button>
            </p>
          ) : (
            <div className="glass flex items-start gap-2 rounded-xl p-2.5 text-sm" role="status" aria-live="polite">
              <span className="relative mt-1.5 grid size-2.5 shrink-0 place-items-center" aria-hidden>
                <motion.span className="absolute size-2.5 rounded-full bg-red-500" animate={{ scale: [1, 1.8], opacity: [0.8, 0] }} transition={{ repeat: Infinity, duration: 1 }} />
                <span className="size-2.5 rounded-full bg-red-500" />
              </span>
              <span className="min-w-0 flex-1">
                {voice.status === 'transcribing' ? <span className="text-muted">Transcribing…</span>
                  : voice.interim ? voice.interim
                  : <span className="text-muted">Listening… say what you’d like to do.</span>}
              </span>
              {voice.status === 'listening' && (
                <button aria-label="Cancel voice input" onClick={voice.cancel} className="rounded p-0.5 text-muted hover:text-text"><X size={15} /></button>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
