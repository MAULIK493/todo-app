import { Loader2, Mic, Square } from 'lucide-react'
import { motion } from 'motion/react'
import { useRef, type PointerEvent } from 'react'
import { cn } from '@/lib/cn'
import type { VoiceInput } from './useVoiceInput'

const HOLD_MS = 350

type Props = {
  voice: VoiceInput
  /** Begin listening (called on tap, key press or the start of a hold). */
  onStart: () => void
  className?: string
}

/**
 * Tap to start, tap again to finish. Or press and hold to talk, and let go to finish (handy on a phone).
 * Keyboard: Space or Enter toggles, like any button.
 */
export function MicButton({ voice, onStart, className }: Props) {
  const downAt = useRef<number | null>(null)
  const startedByPress = useRef(false)
  const listening = voice.status === 'listening'
  const busy = voice.status === 'transcribing'

  const toggle = () => (listening ? voice.stop() : onStart())

  const down = (e: PointerEvent) => {
    if (e.button !== 0 || busy) return
    downAt.current = performance.now()
    startedByPress.current = !listening
    if (!listening) onStart() // start right away so the first word isn't lost
  }

  const up = () => {
    if (downAt.current === null) return
    const held = performance.now() - downAt.current
    downAt.current = null
    if (voice.status === 'idle') return
    if (startedByPress.current) {
      // This press began the session. A long press was push-to-talk, so letting go ends it;
      // a quick tap leaves it running until the next tap.
      if (held >= HOLD_MS) voice.stop()
    } else if (held < HOLD_MS) {
      voice.stop() // a tap on an already-listening mic finishes it
    }
  }

  return (
    <motion.button
      type="button" disabled={busy} aria-pressed={listening}
      aria-label={listening ? 'Stop listening' : busy ? 'Transcribing' : 'Speak to the assistant'}
      title={listening ? 'Tap to finish' : 'Tap to talk, or hold to talk'}
      onPointerDown={down} onPointerUp={up} onPointerCancel={() => { downAt.current = null }}
      onContextMenu={(e) => e.preventDefault()}
      // Pointer taps are handled above; this only runs for keyboard activation (detail 0).
      onClick={(e) => { if (e.detail === 0) toggle() }}
      whileTap={{ scale: 0.92 }}
      className={cn('relative grid size-9 shrink-0 touch-none select-none place-items-center rounded-xl', listening ? 'bg-red-500 text-white' : 'bg-white/10 hover:bg-white/20', 'disabled:opacity-60', className)}
    >
      {listening && (
        <motion.span
          aria-hidden className="absolute inset-0 rounded-xl bg-red-500"
          animate={{ scale: 1.15 + Math.min(voice.level * 6, 0.6), opacity: [0.5, 0] }} transition={{ repeat: Infinity, duration: 1.1 }}
        />
      )}
      <span className="relative">{busy ? <Loader2 size={16} className="animate-spin" /> : listening ? <Square size={13} fill="currentColor" /> : <Mic size={17} />}</span>
    </motion.button>
  )
}
