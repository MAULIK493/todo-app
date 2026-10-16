// Helpers for the speech-to-text fallback (browsers without built-in speech recognition).
//
// Anthropic's API does not take audio input, so transcription uses a separate speech service. Any service that offers
// the widely used "audio transcriptions" HTTP shape works (multipart upload of a `file` plus a `model`, JSON reply with
// a `text` field). Which one is an administrator's choice and cost decision, set with secrets, not hard-coded.

export const MAX_AUDIO_BYTES = 10 * 1024 * 1024
export const MAX_TRANSCRIPT = 4000

const AUDIO_TYPE = /^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|x-m4a|m4a|aac)\s*(;.*)?$/i

/** Returns a problem with the upload, or null when it looks like a short audio clip. */
export function checkAudio(contentType: string | null, size: number): string | null {
  if (!contentType || !AUDIO_TYPE.test(contentType)) return 'Send an audio recording.'
  if (size === 0) return 'The recording was empty.'
  if (size > MAX_AUDIO_BYTES) return 'The recording is too long. Keep it under about a minute.'
  return null
}

/** "hi-IN" -> "hi" (ISO 639-1), the form transcription services expect; null means "detect automatically". */
export function toIso639(lang: string | null | undefined): string | null {
  const m = /^([a-z]{2})(?:[-_][A-Za-z0-9]+)*$/i.exec((lang ?? '').trim())
  return m ? m[1].toLowerCase() : null
}

export function extensionFor(contentType: string): string {
  const t = contentType.toLowerCase()
  if (t.includes('webm')) return 'webm'
  if (t.includes('ogg')) return 'ogg'
  if (t.includes('mp4') || t.includes('m4a') || t.includes('aac')) return 'm4a'
  if (t.includes('wav')) return 'wav'
  return 'mp3'
}

export type SttConfig = { url: string; key: string; model: string }

export function readSttConfig(env: (key: string) => string | undefined): SttConfig | null {
  const url = env('STT_API_URL')
  const key = env('STT_API_KEY')
  if (!url || !key) return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return null // audio must not travel unencrypted
  } catch {
    return null
  }
  return { url, key, model: env('STT_MODEL') || 'whisper-1' }
}

export function buildTranscriptionForm(audio: ArrayBuffer, contentType: string, cfg: SttConfig, lang: string | null): FormData {
  const form = new FormData()
  form.append('file', new Blob([audio], { type: contentType }), `speech.${extensionFor(contentType)}`)
  form.append('model', cfg.model)
  if (lang) form.append('language', lang)
  return form
}

export function parseTranscript(body: unknown): string | null {
  const text = typeof body === 'object' && body !== null ? (body as { text?: unknown }).text : undefined
  if (typeof text !== 'string') return null
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, MAX_TRANSCRIPT) : null
}
