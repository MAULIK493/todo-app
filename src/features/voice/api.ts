import { supabase } from '@/lib/supabase'

export class TranscribeError extends Error {
  code: 'unsupported' | 'no-speech' | 'rate' | 'network' | 'unknown'
  constructor(code: TranscribeError['code'], message: string) {
    super(message)
    this.code = code
  }
}

/** Sends a short recording to the server for transcription (fallback for browsers without built-in recognition). */
export async function transcribe(clip: Blob, lang: string): Promise<string> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new TranscribeError('unknown', 'Please sign in again.')

  let res: Response
  try {
    res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/stt?lang=${encodeURIComponent(lang)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
        'Content-Type': clip.type || 'audio/webm',
      },
      body: clip,
    })
  } catch {
    throw new TranscribeError('network', 'Could not reach the speech service. Check your connection.')
  }

  const body = (await res.json().catch(() => ({}))) as { text?: string; code?: string; error?: string }
  if (res.ok && body.text) return body.text
  if (res.status === 503 || body.code === 'not_configured') throw new TranscribeError('unsupported', "Voice input isn't available in this browser.")
  if (res.status === 422 || body.code === 'no_speech') throw new TranscribeError('no-speech', "I didn't catch that. Tap the mic and try again.")
  if (res.status === 429) throw new TranscribeError('rate', body.error ?? "You've reached the assistant limit for now.")
  throw new TranscribeError('unknown', body.error ?? 'Could not transcribe that. Please try again.')
}
