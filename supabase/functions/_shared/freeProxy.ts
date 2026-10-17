// The free assistant: the app's own AI calls are forwarded to a free-tier model using a key the host keeps as a secret.
// Everything here is pure so it can be tested; the Edge Function (llm-proxy) only adds the network.
import { toFunctionTool } from './toolSchema.ts'

export type FreeProviderId = 'groq' | 'gemini' | 'openrouter'

type FreeProvider = { label: string; baseUrl: string; model: string; streamUsage: boolean }

export const FREE_PROVIDERS: Record<FreeProviderId, FreeProvider> = {
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', streamUsage: true },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', streamUsage: false },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-oss-20b:free', streamUsage: true },
}

export type FreeConfig = { provider: FreeProviderId; label: string; baseUrl: string; model: string; key: string; streamUsage: boolean }

/** FREE_LLM_PROVIDER (groq | gemini | openrouter), FREE_LLM_API_KEY and optionally FREE_LLM_MODEL. Null when not set up. */
export function readFreeConfig(get: (key: string) => string | null | undefined): FreeConfig | null {
  const key = (get('FREE_LLM_API_KEY') ?? '').trim()
  const id = (get('FREE_LLM_PROVIDER') ?? 'groq').trim().toLowerCase()
  if (!key || !(id in FREE_PROVIDERS)) return null
  const p = FREE_PROVIDERS[id as FreeProviderId]
  const model = (get('FREE_LLM_MODEL') ?? '').trim()
  return { provider: id as FreeProviderId, label: p.label, baseUrl: p.baseUrl, model: model || p.model, key, streamUsage: p.streamUsage }
}

export const MAX_BODY_CHARS = 400_000
export const MAX_OUTPUT_TOKENS = 4096
const MAX_MESSAGES = 120
const MAX_TOOLS = 30
const ROLES = new Set(['system', 'user', 'assistant', 'tool'])

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Rebuilds the request from a short list of allowed fields. The caller cannot choose the model, turn off the size
 * cap, or pass any option we did not name, so the free key can only be used for this app's own kind of chat.
 * Throws on a malformed tool call (callers treat that as a bad request).
 */
export function sanitizeChatBody(raw: unknown, cfg: Pick<FreeConfig, 'model' | 'streamUsage'> & { provider?: string }): { ok: true; body: Obj } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: 'Send a JSON object.' }
  if (!Array.isArray(raw.messages) || raw.messages.length === 0 || raw.messages.length > MAX_MESSAGES) return { ok: false, error: 'Invalid messages.' }

  const messages: Obj[] = []
  const toolNames = new Map<string, string>() // call id -> tool name
  for (const m of raw.messages) {
    if (!isObj(m) || typeof m.role !== 'string' || !ROLES.has(m.role)) return { ok: false, error: 'Invalid message.' }
    if (m.content != null && typeof m.content !== 'string') return { ok: false, error: 'Invalid message content.' }
    const out: Obj = { role: m.role, content: (m.content as string | null | undefined) ?? null }
    if (m.role === 'tool') {
      if (typeof m.tool_call_id !== 'string') return { ok: false, error: 'Invalid tool result.' }
      out.tool_call_id = m.tool_call_id
      // Gemini wants to be told which tool a result belongs to.
      if (cfg.provider === 'gemini' && toolNames.has(m.tool_call_id)) out.name = toolNames.get(m.tool_call_id)
    }
    if (m.role === 'assistant' && m.tool_calls !== undefined) {
      if (!Array.isArray(m.tool_calls) || m.tool_calls.length > 20) return { ok: false, error: 'Invalid tool calls.' }
      out.tool_calls = m.tool_calls.map((c) => {
        const f = isObj(c) && isObj(c.function) ? c.function : null
        if (!isObj(c) || !f || typeof c.id !== 'string' || typeof f.name !== 'string' || typeof f.arguments !== 'string') throw new Error('bad call')
        toolNames.set(c.id, f.name)
        return { id: c.id, type: 'function', function: { name: f.name, arguments: f.arguments } }
      })
    }
    messages.push(out)
  }

  let tools: Obj[] | undefined
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools) || raw.tools.length > MAX_TOOLS) return { ok: false, error: 'Invalid tools.' }
    tools = []
    for (const t of raw.tools) {
      const f = isObj(t) && isObj(t.function) ? t.function : null
      if (!f || typeof f.name !== 'string' || (f.parameters !== undefined && !isObj(f.parameters))) return { ok: false, error: 'Invalid tool.' }
      tools.push(toFunctionTool({ name: f.name, description: typeof f.description === 'string' ? f.description : '', parameters: f.parameters }))
    }
  }

  const asked = typeof raw.max_tokens === 'number' && Number.isFinite(raw.max_tokens) ? Math.floor(raw.max_tokens) : MAX_OUTPUT_TOKENS
  return {
    ok: true,
    body: {
      model: cfg.model,
      stream: true,
      max_tokens: Math.min(Math.max(asked, 16), MAX_OUTPUT_TOKENS),
      ...(cfg.streamUsage ? { stream_options: { include_usage: true } } : {}),
      messages,
      ...(tools && tools.length ? { tools } : {}),
    },
  }
}

export type ProxyError = { status: number; code: 'free_unavailable' | 'busy' | 'server'; error: string }

/** The service's own short explanation from an error reply (it names what was wrong with the request), or ''. */
export function upstreamMessage(text: string): string {
  try {
    const body = JSON.parse(text)
    const b = (Array.isArray(body) ? body[0] : body) as { error?: { message?: unknown } | string; message?: unknown } | null
    const m = typeof b?.error === 'string' ? b.error : b?.error?.message ?? b?.message
    return typeof m === 'string' ? m.replace(/\s+/g, ' ').trim().slice(0, 240) : ''
  } catch {
    return ''
  }
}

/**
 * What to tell the app when the free model's own service refuses. For a request it did not understand (400-level),
 * its short explanation is included so the problem can be found; for key or capacity problems it is not.
 */
export function describeUpstreamFailure(status: number, detail = ''): ProxyError {
  // Some services (Gemini) report a rejected key as a 400 rather than a 401.
  const keyRejected = /api[ _-]?key|auth(entication|orization)?\b|unauthorized/i.test(detail)
  if (status === 401 || status === 403 || (status === 400 && keyRejected)) return { status: 503, code: 'free_unavailable', error: 'The free assistant is not available right now. You can still use your own key in Assistant settings.' }
  if (status === 429 || status === 402) return { status: 429, code: 'busy', error: 'The free assistant is very busy right now. Try again in a minute, or use your own key in Assistant settings.' }
  if (status >= 500) return { status: 502, code: 'server', error: 'The free assistant is having problems. Try again in a moment.' }
  return { status: 502, code: 'server', error: `The free assistant could not handle that request${detail ? ` (the service said: ${detail})` : ` (error ${status})`}.` }
}
