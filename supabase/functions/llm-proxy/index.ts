import { createClient } from '@supabase/supabase-js'
import { createStore } from '../_shared/db.ts'
import { describeUpstreamFailure, MAX_BODY_CHARS, readFreeConfig, sanitizeChatBody } from '../_shared/freeProxy.ts'
import { CORS_HEADERS, jsonResponse } from '../_shared/http.ts'
import { checkUsage, readLimits } from '../_shared/limits.ts'

// The free assistant.
//   GET  /functions/v1/llm-proxy   ->  { available, provider, dailyRequests, used }
//   POST /functions/v1/llm-proxy/chat/completions   (a chat-completions request)  ->  the model's event stream
//
// The free-tier key is a secret that never leaves this function (supabase secrets set FREE_LLM_API_KEY=...). Each person
// gets a daily allowance; the conversation itself is neither stored nor logged here.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'GET' && req.method !== 'POST') return jsonResponse({ error: 'Use GET or POST.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const authorization = req.headers.get('Authorization')
  if (!url || !anon) return jsonResponse({ code: 'free_unavailable', error: 'The free assistant is not set up.' }, 503)
  if (!authorization) return jsonResponse({ code: 'unauthorized', error: 'Please sign in.' }, 401)

  const sb = createClient(url, anon, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData } = await sb.auth.getUser()
  if (!userData.user) return jsonResponse({ code: 'unauthorized', error: 'Please sign in again.' }, 401)

  const env = (k: string) => Deno.env.get(k)
  const config = readFreeConfig(env)
  const limits = readLimits(env)
  const store = createStore(sb)

  if (req.method === 'GET') {
    const usage = config ? await store.usage().catch(() => null) : null
    return jsonResponse({ available: !!config, provider: config?.label ?? null, dailyRequests: limits.dailyRequests, used: usage?.requests_today ?? 0 })
  }

  if (!config) return jsonResponse({ code: 'free_unavailable', error: 'The free assistant is not available. You can still use your own key in Assistant settings.' }, 503)

  const declared = Number(req.headers.get('Content-Length') ?? 0)
  if (declared > MAX_BODY_CHARS * 2) return jsonResponse({ code: 'bad_request', error: 'That request is too large.' }, 413)
  let text: string
  try { text = await req.text() } catch { return jsonResponse({ code: 'bad_request', error: 'Could not read the request.' }, 400) }
  if (text.length > MAX_BODY_CHARS) return jsonResponse({ code: 'bad_request', error: 'That request is too large.' }, 413)
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return jsonResponse({ code: 'bad_request', error: 'Send a JSON body.' }, 400) }

  let body
  try {
    const checked = sanitizeChatBody(raw, config)
    if (!checked.ok) return jsonResponse({ code: 'bad_request', error: checked.error }, 400)
    body = checked.body
  } catch {
    return jsonResponse({ code: 'bad_request', error: 'Invalid request.' }, 400)
  }

  const blocked = checkUsage(await store.usage(), limits)
  if (blocked) return jsonResponse({ code: 'daily_limit', error: `${blocked} You can keep going right away by adding your own key in Assistant settings.` }, 429)

  try {
    const upstream = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    })
    if (!upstream.ok || !upstream.body) {
      // Only the status is kept: the provider's reply can echo details of the request.
      console.error('free model service returned', upstream.status)
      const f = describeUpstreamFailure(upstream.status)
      return jsonResponse({ code: f.code, error: f.error }, f.status)
    }
    await store.recordUsage(0, 0).catch((e: unknown) => console.error('could not record usage', e instanceof Error ? e.name : 'error'))
    return new Response(upstream.body, {
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
    })
  } catch (e) {
    console.error('free model request failed', e instanceof Error ? e.name : 'error')
    return jsonResponse({ code: 'server', error: 'The free assistant is having problems. Try again in a moment.' }, 502)
  }
})
