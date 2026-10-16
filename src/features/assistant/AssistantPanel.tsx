import { History, Plus, Settings, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { timeAgo } from '@/lib/dates'
import { spring } from '@/lib/motion'
import { cancelSpeech, speechSynthesisSupported } from '@/features/voice/speech'
import { useVoiceSettings } from '@/features/voice/settings'
import { useSpeaking } from '@/features/voice/useSpeaking'
import { AssistantSettings } from './AssistantSettings'
import { BriefingCard } from './BriefingCard'
import { AssistantOrb, orbState } from './AssistantOrb'
import { Composer } from './Composer'
import { MessageBubble } from './MessageBubble'
import { useConversationMutations, useConversations } from './api'
import { isAiConfigured, useAiConfig } from './llm/config'
import { useFreeStatus } from './llm/free'
import { providerById } from './llm/providers'
import { useAssistant } from './store'

const SUGGESTIONS = ['What should I focus on today?', "What's overdue?", 'Give me a quick progress update', 'Help me plan my week']

export function AssistantPanel() {
  const { messages, notice, busy, conversationId, setOpen, newChat, send, voice } = useAssistant()
  const [settings, setSettings] = useState(false)
  const [history, setHistory] = useState(false)
  const bottom = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  const speakMode = useVoiceSettings((s) => s.speak)
  const updateVoice = useVoiceSettings((s) => s.update)
  const speaking = useSpeaking(speakMode !== 'off')
  const ai = useAiConfig()
  const free = useFreeStatus(ai.mode === 'free')
  // The free assistant needs nothing from the person; the prompt only appears if it is unavailable or they chose their own key.
  const unavailable = ai.mode === 'free' && free.data?.available === false
  const ready = isAiConfigured(ai) && !unavailable

  // Follow the reply as it streams, unless the user has scrolled up to read.
  useEffect(() => {
    if (pinned.current) bottom.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  return (
    <motion.aside
      role="complementary" aria-label="Assistant" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} transition={spring}
      className="glass fixed inset-0 z-40 flex flex-col bg-surface-solid md:static md:z-auto md:m-2 md:ml-0 md:w-96 md:shrink-0 md:rounded-2xl md:bg-transparent"
    >
      <header className="flex items-center gap-1 border-b border-border px-3 py-2">
        <AssistantOrb state={orbState({ busy, listening: voice.status === 'listening', speaking })} level={voice.level} />
        <h2 className="flex-1 font-semibold">Assistant</h2>
        {speechSynthesisSupported() && (
          speaking
            ? <IconButton label="Stop speaking" onClick={cancelSpeech}><VolumeX size={18} className="text-accent" /></IconButton>
            : <IconButton label={speakMode === 'off' ? 'Read replies aloud' : 'Turn off spoken replies'} pressed={speakMode !== 'off'} onClick={() => updateVoice({ speak: speakMode === 'off' ? 'voice' : 'off' })}>
                <Volume2 size={18} />
              </IconButton>
        )}
        <IconButton label="New chat" onClick={newChat} disabled={messages.length === 0 && !busy}><Plus size={18} /></IconButton>
        <IconButton label="Chat history" onClick={() => setHistory((v) => !v)} pressed={history}><History size={18} /></IconButton>
        <IconButton label="Assistant settings" onClick={() => setSettings(true)}><Settings size={18} /></IconButton>
        <IconButton label="Close assistant" onClick={() => setOpen(false)}><X size={18} /></IconButton>
      </header>

      <AnimatePresence>{history && <HistoryList onPick={() => setHistory(false)} current={conversationId} />}</AnimatePresence>

      <div
        ref={scroller} role="log" aria-live="polite" aria-label="Conversation" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
      >
        {messages.length === 0 ? (
          <div className="space-y-4">
            {!ready && (
              <div className="glass space-y-2 rounded-2xl p-4">
                <h3 className="font-semibold">{unavailable ? 'The free assistant is unavailable' : 'Add your key'}</h3>
                <p className="text-sm text-muted">
                  {unavailable
                    ? 'It is not switched on for this app right now. You can still use the assistant with your own AI key: Google Gemini and Groq have free tiers, and a key takes about a minute to create.'
                    : 'You chose to use your own AI key. Google Gemini and Groq have free tiers, and a key takes about a minute to create.'}
                </p>
                <button onClick={() => setSettings(true)} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white">{unavailable ? 'Use my own key' : 'Add my key'}</button>
              </div>
            )}
            <BriefingCard />
            <div className="space-y-2">
              <p className="px-1 text-sm text-muted">I can see your todos and notes, add and update them, and help you plan. Try:</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <motion.button key={s} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => void send(s)} className="glass rounded-full px-3 py-1.5 text-xs">{s}</motion.button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
        <div ref={bottom} />
      </div>

      <footer className="space-y-2 p-3 pt-0">
        {notice && (
          <div role="alert" className={cn('flex items-start justify-between gap-2 rounded-xl p-2.5 text-xs', notice.code === 'not_configured' ? 'bg-amber-500/15 text-amber-300' : 'bg-red-500/15 text-red-300')}>
            <p>{notice.message}</p>
            {notice.code === 'not_configured' && <button onClick={() => setSettings(true)} className="shrink-0 rounded-md bg-white/10 px-2 py-1 font-medium">Open settings</button>}
          </div>
        )}
        <Composer />
        <p className="px-1 text-center text-[11px] text-muted">Replies can be wrong. {ai.mode === 'free' ? `Free mode: messages go to ${free.data?.provider ?? 'a free AI service'} through our server.` : `Messages go to ${providerById(ai.provider).name}, using your key.`}</p>
      </footer>

      {settings && <AssistantSettings onClose={() => setSettings(false)} />}
    </motion.aside>
  )
}

function IconButton({ label, onClick, children, disabled, pressed }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean; pressed?: boolean }) {
  return (
    <button aria-label={label} aria-pressed={pressed} onClick={onClick} disabled={disabled} className={cn('rounded-lg p-2 hover:bg-white/10 disabled:opacity-40', pressed && 'bg-white/10')}>
      {children}
    </button>
  )
}

function HistoryList({ onPick, current }: { onPick: () => void; current: string | null }) {
  const { data = [], isLoading } = useConversations()
  const { remove } = useConversationMutations()
  const open = useAssistant((s) => s.openConversation)

  return (
    <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b border-border">
      <ul className="max-h-60 space-y-0.5 overflow-auto p-2" aria-label="Past chats">
        {isLoading && <li className="p-2 text-xs text-muted">Loading…</li>}
        {!isLoading && data.length === 0 && <li className="p-2 text-xs text-muted">No saved chats yet.</li>}
        {data.map((c) => (
          <li key={c.id} className={cn('group flex items-center rounded-lg hover:bg-white/10', c.id === current && 'bg-white/10')}>
            <button className="min-w-0 flex-1 px-2 py-1.5 text-left" onClick={() => { void open(c.id); onPick() }}>
              <span className="block truncate text-sm">{c.title}</span>
              <span className="block text-xs text-muted">{timeAgo(c.updated_at)}</span>
            </button>
            <button
              aria-label={`Delete chat ${c.title}`} className="rounded p-1.5 text-muted opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
              onClick={() => remove.mutate(c.id, { onSuccess: () => { if (c.id === current) useAssistant.getState().newChat() } })}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </motion.div>
  )
}
