import { create } from 'zustand'

/** Device-level voice preferences (microphones and speakers are per device, so these stay in this browser). */
export type SpeakMode = 'off' | 'voice' | 'always'
export type VoiceSettings = {
  /** BCP-47 language for speech recognition and reading aloud; '' means the browser's language. */
  lang: string
  /** Send automatically when you stop talking, instead of letting you review the text first. */
  autoSend: boolean
  /** Read replies aloud: never, only after you spoke, or always. */
  speak: SpeakMode
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { lang: '', autoSend: true, speak: 'off' }

export const LANGUAGES = [
  { id: '', label: 'Browser default' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'en-IN', label: 'English (India)' },
  { id: 'hi-IN', label: 'हिन्दी (Hindi)' },
  { id: 'es-ES', label: 'Español' },
  { id: 'fr-FR', label: 'Français' },
  { id: 'de-DE', label: 'Deutsch' },
  { id: 'pt-BR', label: 'Português (Brasil)' },
  { id: 'ja-JP', label: '日本語' },
] as const

const KEY = 'voice-settings'
const LANG_IDS: string[] = LANGUAGES.map((l) => l.id)

/** Only values the app knows are accepted, so a stale or hand-edited entry can't break voice input. */
export function sanitizeVoiceSettings(raw: unknown): VoiceSettings {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<VoiceSettings>
  return {
    lang: typeof r.lang === 'string' && LANG_IDS.includes(r.lang) ? r.lang : DEFAULT_VOICE_SETTINGS.lang,
    autoSend: typeof r.autoSend === 'boolean' ? r.autoSend : DEFAULT_VOICE_SETTINGS.autoSend,
    speak: r.speak === 'off' || r.speak === 'voice' || r.speak === 'always' ? r.speak : DEFAULT_VOICE_SETTINGS.speak,
  }
}

const load = (): VoiceSettings => {
  try { return sanitizeVoiceSettings(JSON.parse(localStorage.getItem(KEY) ?? 'null')) } catch { return DEFAULT_VOICE_SETTINGS }
}

export const useVoiceSettings = create<VoiceSettings & { update: (patch: Partial<VoiceSettings>) => void }>((set, get) => ({
  ...load(),
  update: (patch) => {
    const { lang, autoSend, speak } = { ...get(), ...patch }
    const next = sanitizeVoiceSettings({ lang, autoSend, speak })
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage unavailable */ }
    set(next)
  },
}))

export const effectiveLang = (s: Pick<VoiceSettings, 'lang'>) => s.lang || (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
