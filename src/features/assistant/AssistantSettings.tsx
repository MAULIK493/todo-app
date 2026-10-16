import { Lock } from 'lucide-react'
import { AnimatePresence } from 'motion/react'
import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { useVault } from '@/features/security/vault'
import { effectiveLang, LANGUAGES, useVoiceSettings, type SpeakMode } from '@/features/voice/settings'
import { speak, speechSynthesisSupported } from '@/features/voice/speech'
import { useWorkspaces } from '@/features/workspaces/api'
import { useToasts } from '@/stores/toasts'
import { useAiPrefs, useAiUsage, useConversationMutations, useSetAiPrefs, useSetWorkspaceAccess, useWorkspaceAccess } from './api'
import { ProviderSettings } from './ProviderSettings'
import { useAssistant } from './store'

const TONES = [
  { id: 'friendly', label: 'Friendly', hint: 'Warm and encouraging' },
  { id: 'concise', label: 'Concise', hint: 'Short and to the point' },
  { id: 'coach', label: 'Coach', hint: 'Motivating and direct' },
] as const

export function AssistantSettings({ onClose }: { onClose: () => void }) {
  const push = useToasts((s) => s.push)
  const { data: prefs } = useAiPrefs()
  const setPrefs = useSetAiPrefs()
  const { data: workspaces = [] } = useWorkspaces()
  const { data: access = {} } = useWorkspaceAccess()
  const setAccess = useSetWorkspaceAccess()
  const { clearAll } = useConversationMutations()
  const { data: usage } = useAiUsage(true)
  const unlocked = useVault((s) => s.keys)
  const [confirmClear, setConfirmClear] = useState(false)
  const voice = useVoiceSettings()

  return (
    <AnimatePresence>
      <Modal title="Assistant settings" onClose={onClose} className="max-h-[90vh] max-w-lg overflow-auto">
        <div className="space-y-6 text-sm">
          <ProviderSettings />

          <section aria-label="Tone" className="space-y-2">
            <h3 className="font-medium">How should it talk to you?</h3>
            <div role="radiogroup" className="grid grid-cols-3 gap-2">
              {TONES.map((t) => (
                <label key={t.id} className={`glass cursor-pointer rounded-xl p-2 text-center ${prefs?.tone === t.id ? 'ring-2 ring-accent' : ''}`}>
                  <input type="radio" name="tone" className="sr-only" checked={prefs?.tone === t.id} onChange={() => setPrefs.mutate({ tone: t.id })} />
                  <span className="block font-medium">{t.label}</span>
                  <span className="block text-xs text-muted">{t.hint}</span>
                </label>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={prefs?.briefing_enabled !== false} onChange={(e) => setPrefs.mutate({ briefing_enabled: e.target.checked })} />
              Daily briefing (morning plan and evening recap)
            </label>
          </section>

          <section aria-label="Voice" className="space-y-2">
            <h3 className="font-medium">Voice</h3>
            <label className="flex items-center justify-between gap-3">
              <span>Language</span>
              <select value={voice.lang} onChange={(e) => voice.update({ lang: e.target.value })} className="glass rounded-lg px-2 py-1 outline-none">
                {LANGUAGES.map((l) => <option key={l.id} value={l.id} className="text-black">{l.label}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={voice.autoSend} onChange={(e) => voice.update({ autoSend: e.target.checked })} />
              Send automatically when I stop talking
            </label>
            {speechSynthesisSupported() && (
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="speak-mode">Read replies aloud</label>
                <div className="flex items-center gap-2">
                  <select id="speak-mode" value={voice.speak} onChange={(e) => voice.update({ speak: e.target.value as SpeakMode })} className="glass rounded-lg px-2 py-1 outline-none">
                    <option value="off" className="text-black">Never</option>
                    <option value="voice" className="text-black">After I use my voice</option>
                    <option value="always" className="text-black">Always</option>
                  </select>
                  <button className="glass rounded-lg px-2 py-1 text-xs" onClick={() => speak('This is how replies will sound.', effectiveLang(voice))}>Test</button>
                </div>
              </div>
            )}
            <p className="text-xs text-muted">
              Most browsers send your voice to their own speech service to turn it into text. Replies that used content from a private workspace are never read aloud, and codes and PINs are always typed, never spoken.
            </p>
          </section>

          <section aria-label="Workspace access" className="space-y-2">
            <h3 className="font-medium">What can it see?</h3>
            <ul className="space-y-1.5">
              {workspaces.map((w) => {
                const isPrivate = w.lock_state !== 'none'
                const on = access[w.id] ?? !isPrivate
                return (
                  <li key={w.id} className="glass rounded-xl p-2.5">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={on} onChange={(e) => setAccess.mutate({ workspaceId: w.id, allowed: e.target.checked })} />
                      <span className="size-2.5 rounded-full" style={{ background: w.color }} aria-hidden />
                      <span className="flex-1">{w.name}</span>
                      {isPrivate && <Lock size={13} className="text-muted" aria-label="Private" />}
                    </label>
                    {isPrivate && (
                      <p className="mt-1 pl-6 text-xs text-muted">
                        {on
                          ? unlocked[w.id]
                            ? 'Shared (read-only) while this workspace is unlocked. Each message sends a decrypted snapshot, and those chats are not saved.'
                            : 'Allowed, but nothing is shared while it is locked.'
                          : 'Hidden. The assistant never sees private content unless you turn this on.'}
                      </p>
                    )}
                  </li>
                )
              })}
              {workspaces.length === 0 && <li className="text-muted">Create a workspace first.</li>}
            </ul>
          </section>

          <section aria-label="Privacy and data" className="space-y-2">
            <h3 className="font-medium">Your data</h3>
            <p className="text-xs text-muted">
              Chats are saved to your account so you can come back to them. The text itself goes to the AI service you picked above (see there), never anywhere else.
            </p>
            {usage && <p className="text-xs text-muted">Today: {usage.requests_today} requests · {usage.tokens_today.toLocaleString()} tokens. This month: {usage.tokens_month.toLocaleString()} tokens.</p>}
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="text-red-400">Delete all saved chats?</span>
                <button
                  className="rounded-lg bg-red-500 px-3 py-1 text-white"
                  onClick={() => clearAll.mutate(undefined, { onSuccess: () => { useAssistant.getState().newChat(); setConfirmClear(false); push('Chat history deleted') }, onError: (e) => push(`Could not delete: ${e.message}`) })}
                >
                  Delete
                </button>
                <button className="glass rounded-lg px-3 py-1" onClick={() => setConfirmClear(false)}>Keep</button>
              </div>
            ) : (
              <button className="glass rounded-lg px-3 py-1.5 text-red-400" onClick={() => setConfirmClear(true)}>Delete chat history…</button>
            )}
          </section>
        </div>
      </Modal>
    </AnimatePresence>
  )
}
