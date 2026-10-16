import { create } from 'zustand'
import { queryClient } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase'
import type { Action } from '@shared/types.ts'
import { cancelSpeech, maybeSpeak } from '@/features/voice/speech'
import { AssistantError, streamChat } from './api'
import { refreshAfterAssistant } from './actions'
import { applyServerEvent, newMessage, type ChatMessage, type ConfirmState } from './messages'
import { gatherPrivateContext } from './privateLoader'

type State = {
  open: boolean
  conversationId: string | null
  messages: ChatMessage[]
  busy: boolean
  /** A problem with the assistant as a whole (not set up, over the limit), shown above the composer. */
  notice: { code: string; message: string } | null
  controller: AbortController | null
  /** Set by the floating mic and the shortcut: open the panel and start listening. */
  pendingVoice: boolean
  /** Set by the composer so the orb can show when the microphone is on. */
  voice: { status: 'idle' | 'listening' | 'transcribing'; level: number }
  setVoice: (voice: State['voice']) => void
  setOpen: (open: boolean) => void
  requestVoice: () => void
  clearPendingVoice: () => void
  send: (text: string, opts?: { viaVoice?: boolean }) => Promise<void>
  stop: () => void
  newChat: () => void
  openConversation: (id: string) => Promise<void>
  patchConfirm: (messageId: string, confirmId: string, patch: Partial<ConfirmState>) => void
}

const uid = () => crypto.randomUUID()

export const useAssistant = create<State>((set, get) => {
  const patchMessage = (id: string, fn: (m: ChatMessage) => ChatMessage) =>
    set((s) => ({ messages: s.messages.map((m) => (m.id === id ? fn(m) : m)) }))

  return {
    open: false,
    conversationId: null,
    messages: [],
    busy: false,
    notice: null,
    controller: null,
    pendingVoice: false,
    voice: { status: 'idle', level: 0 },
    setVoice: (voice) => set((s) => (s.voice.status === voice.status && s.voice.level === voice.level ? s : { voice })),

    setOpen: (open) => {
      if (!open) cancelSpeech()
      set({ open })
    },
    requestVoice: () => set({ open: true, pendingVoice: true }),
    clearPendingVoice: () => set({ pendingVoice: false }),

    patchConfirm: (messageId, confirmId, patch) =>
      patchMessage(messageId, (m) => ({ ...m, confirms: m.confirms.map((c) => (c.id === confirmId ? { ...c, ...patch } : c)) })),

    stop: () => get().controller?.abort(),

    newChat: () => {
      cancelSpeech()
      get().controller?.abort()
      set({ conversationId: null, messages: [], notice: null, busy: false })
    },

    openConversation: async (id) => {
      get().controller?.abort()
      set({ conversationId: id, messages: [], notice: null, busy: false })
      const { data, error } = await supabase.from('ai_messages').select('id, role, content, actions').eq('conversation_id', id).order('created_at').order('id')
      if (error) return set({ notice: { code: 'server', message: 'Could not load that conversation.' } })
      if (get().conversationId !== id) return // the user already moved on
      set({
        messages: (data as { id: string; role: 'user' | 'assistant'; content: string; actions: Action[] }[]).map((r) => ({
          ...newMessage(r.id, r.role, r.content), status: 'done' as const, actions: r.actions ?? [],
        })),
      })
    },

    send: async (text, opts) => {
      const message = text.trim()
      if (!message || get().busy) return
      cancelSpeech()

      const user = newMessage(uid(), 'user', message)
      const reply = newMessage(uid(), 'assistant')
      const controller = new AbortController()
      set((s) => ({ messages: [...s.messages, user, reply], busy: true, notice: null, controller }))

      let privateContext: string | null = null
      try {
        privateContext = await gatherPrivateContext()
      } catch {
        privateContext = null // sharing is optional; carry on without it
      }
      const usedPrivate = privateContext !== null
      if (usedPrivate) {
        patchMessage(user.id, (m) => ({ ...m, unsaved: true }))
        patchMessage(reply.id, (m) => ({ ...m, unsaved: true }))
      }

      let finished = false
      try {
        await streamChat({
          message,
          conversationId: get().conversationId,
          privateContext,
          signal: controller.signal,
          onEvent: (e) => {
            patchMessage(reply.id, (m) => applyServerEvent(m, e))
            if (e.type === 'action' || e.type === 'confirm') refreshAfterAssistant()
            if (e.type === 'done') {
              finished = true
              if (e.persisted && e.conversationId) {
                set((s) => ({ conversationId: s.conversationId ?? e.conversationId }))
                queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] })
              }
              queryClient.invalidateQueries({ queryKey: ['assistant', 'usage'] })
            }
            if (e.type === 'error') finished = true
          },
        })
        if (!finished) patchMessage(reply.id, (m) => ({ ...m, status: m.status === 'streaming' ? 'done' : m.status, activity: null }))
        // Read the reply aloud if the user asked for that (never for replies that used private content).
        const finalReply = get().messages.find((m) => m.id === reply.id)
        if (finalReply && finalReply.status === 'done') maybeSpeak(finalReply.text, { viaVoice: !!opts?.viaVoice, usedPrivate })
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          patchMessage(reply.id, (m) => ({ ...m, status: 'done', activity: null }))
        } else if (e instanceof AssistantError && ['not_configured', 'rate_limited', 'unauthorized'].includes(e.code)) {
          // Nothing was generated: remove the empty bubble and explain above the composer.
          set((s) => ({ messages: s.messages.filter((m) => m.id !== reply.id), notice: { code: e.code, message: e.message } }))
        } else {
          patchMessage(reply.id, (m) => ({ ...m, status: 'error', activity: null, error: e instanceof Error ? e.message : 'Something went wrong.' }))
        }
      } finally {
        set({ busy: false, controller: null })
      }
    },
  }
})
