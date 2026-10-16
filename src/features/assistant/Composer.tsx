import { ArrowUp, Square } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'
import { ListeningBar } from '@/features/voice/ListeningBar'
import { MicButton } from '@/features/voice/MicButton'
import { effectiveLang, useVoiceSettings } from '@/features/voice/settings'
import { useVoiceInput } from '@/features/voice/useVoiceInput'
import { useAssistant } from './store'

const LIMIT = 4000

export function Composer() {
  const { busy, send, stop, open, pendingVoice, clearPendingVoice } = useAssistant()
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const voice = useVoiceInput()
  const voiceSettings = useVoiceSettings()
  const setVoice = useAssistant((s) => s.setVoice)
  useEffect(() => { setVoice({ status: voice.status, level: voice.level }) }, [voice.status, voice.level, setVoice])
  useEffect(() => () => setVoice({ status: 'idle', level: 0 }), [setVoice])

  // Spoken text either goes straight to the assistant, or lands in the box for a look first.
  const startListening = () => {
    if (busy) return
    voice.start({
      mode: voiceSettings.autoSend ? 'command' : 'dictate',
      lang: effectiveLang(voiceSettings),
      onFinal: (spoken) => {
        if (voiceSettings.autoSend) void send(spoken, { viaVoice: true })
        else {
          setText((t) => (t.trim() ? `${t.trim()} ${spoken}` : spoken))
          ref.current?.focus()
        }
      },
    })
  }

  // The floating mic and the keyboard shortcut ask the panel to start (or stop) listening.
  useEffect(() => {
    if (!open || !pendingVoice) return
    clearPendingVoice()
    if (voice.status === 'listening') voice.stop()
    else startListening()
  }, [open, pendingVoice])

  useEffect(() => { if (open) ref.current?.focus() }, [open])
  // Grow with the content, up to about five lines.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`
  }, [text])

  const submit = () => {
    if (!text.trim() || busy || text.length > LIMIT) return
    void send(text)
    setText('')
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
  }

  return (
    <div className="space-y-2">
    <ListeningBar voice={voice} />
    <form onSubmit={(e) => { e.preventDefault(); submit() }} className="glass flex items-end gap-2 rounded-2xl p-2">
      <label className="sr-only" htmlFor="assistant-input">Message the assistant</label>
      <textarea
        id="assistant-input" ref={ref} value={text} rows={1} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
        placeholder="Ask anything, or tell me what to do…" maxLength={LIMIT + 200}
        className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted"
      />
      {text.length > LIMIT - 300 && <span className={cn('self-center text-xs', text.length > LIMIT ? 'text-red-400' : 'text-muted')}>{LIMIT - text.length}</span>}
      {voice.supported && !busy && <MicButton voice={voice} onStart={startListening} />}
      {busy ? (
        <button type="button" onClick={stop} aria-label="Stop" className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/10 hover:bg-white/20"><Square size={14} fill="currentColor" /></button>
      ) : (
        <button aria-label="Send" disabled={!text.trim() || text.length > LIMIT} className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent text-white disabled:opacity-40"><ArrowUp size={18} /></button>
      )}
    </form>
    </div>
  )
}
