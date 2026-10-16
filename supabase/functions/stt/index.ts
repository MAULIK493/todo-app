import { createClient } from '@supabase/supabase-js'
import { createStore } from '../_shared/db.ts'
import { CORS_HEADERS, jsonResponse } from '../_shared/http.ts'
import { checkUsage, readLimits } from '../_shared/limits.ts'
import { buildTranscriptionForm, checkAudio, MAX_AUDIO_BYTES, parseTranscript, readSttConfig, toIso639 } from '../_shared/stt.ts'

// POST /functions/v1/stt?lang=hi-IN   (body: the raw audio recording)  ->  { text }
//
// Fallback for browsers with no built-in speech recognition. The clip is forwarded to the speech service configured
// with STT_API_URL / STT_API_KEY / STT_MODEL and is neither stored nor logged. Not configured -> 503, and the app
// simply tells the user voice input is unavailable in their browser.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jsonResponse({ error: 'Use POST.' }, 405)

  const config = readSttConfig((k) => Deno.env.get(k))
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const authorization = req.headers.get('Authorization')
  if (!config || !url || !anon) return jsonResponse({ code: 'not_configured', error: 'Voice input is not set up for this browser.' }, 503)
  if (!authorization) return jsonResponse({ code: 'unauthorized', error: 'Please sign in.' }, 401)

  const sb = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData } = await sb.auth.getUser()
  if (!userData.user) return jsonResponse({ code: 'unauthorized', error: 'Please sign in again.' }, 401)

  // Refuse oversized uploads before reading them.
  const declared = Number(req.headers.get('Content-Length') ?? 0)
  if (declared > MAX_AUDIO_BYTES) return jsonResponse({ code: 'bad_request', error: 'The recording is too long. Keep it under about a minute.' }, 413)

  const contentType = req.headers.get('Content-Type')
  const audio = await req.arrayBuffer()
  const problem = checkAudio(contentType, audio.byteLength)
  if (problem) return jsonResponse({ code: 'bad_request', error: problem }, 400)

  const store = createStore(sb)
  const blocked = checkUsage(await store.usage(), readLimits((k) => Deno.env.get(k)))
  if (blocked) return jsonResponse({ code: 'rate_limited', error: blocked }, 429)

  try {
    const lang = toIso639(new URL(req.url).searchParams.get('lang'))
    const res = await fetch(config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.key}` },
      body: buildTranscriptionForm(audio, contentType!, config, lang),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      // The provider's response can echo request details, so only the status is logged.
      console.error('speech service returned', res.status)
      return jsonResponse({ code: 'server', error: 'Could not transcribe that. Please try again.' }, 502)
    }
    const text = parseTranscript(await res.json())
    if (!text) return jsonResponse({ code: 'no_speech', error: "I didn't catch that. Try again." }, 422)

    await store.recordUsage(0, 0).catch((e: unknown) => console.error('could not record usage', e))
    return jsonResponse({ text })
  } catch (e) {
    console.error('transcription failed', e instanceof Error ? e.name : 'error')
    return jsonResponse({ code: 'server', error: 'Could not transcribe that. Please try again.' }, 502)
  }
})
