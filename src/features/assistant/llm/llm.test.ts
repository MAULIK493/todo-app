import { RetryableLLMError } from '@shared/agent.ts'
import { TOOLS } from '@shared/schemas.ts'
import { describe, expect, it, vi } from 'vitest'
import { fetchFreeStatus } from './free'
import { createAnthropicLLM } from './anthropic'
import { createLLM, testConnection } from './index'
import { createOpenAILLM, toOpenAIMessages } from './openai'
import { PROVIDER_ORIGINS, providerById } from './providers'
import { ProviderError } from './errors'
import { readSse } from './sse'

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: sessionState.session } })) } }, isSupabaseConfigured: true }))
const sessionState = vi.hoisted(() => ({ session: { access_token: 'user-jwt' } as { access_token: string } | null }))

/** A streaming response whose body arrives in small pieces, like a real network. */
const sse = (frames: string[], chunk = 7, status = 200) => {
  const bytes = new TextEncoder().encode(frames.join(''))
  return new Response(new ReadableStream<Uint8Array>({
    start(c) { for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk)); c.close() },
  }), { status, headers: { 'content-type': 'text/event-stream' } })
}
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`
const oai = (data: object | '[DONE]') => `data: ${data === '[DONE]' ? data : JSON.stringify(data)}\n\n`

const req = { system: 'be helpful', tools: TOOLS.slice(0, 2), messages: [{ role: 'user' as const, content: 'hi' }] }
const run = async (llm: ReturnType<typeof createAnthropicLLM>) => {
  const s = llm.stream(req); let text = ''
  s.onText((d) => { text += d })
  return { message: await s.final(), text }
}

describe('server-sent events', () => {
  it('handles chunks that cut frames and characters in half, CRLF line endings, and comments', async () => {
    const bytes = new TextEncoder().encode(': ping\r\n\r\nevent: a\r\ndata: नमस्ते 🌍\r\n\r\ndata: one\ndata: two\n\n')
    const body = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3)); c.close() } })
    const seen: { event: string; data: string }[] = []
    for await (const e of readSse(body)) seen.push(e)
    expect(seen).toEqual([{ event: 'a', data: 'नमस्ते 🌍' }, { event: 'message', data: 'one\ntwo' }])
  })
})

describe('Claude adapter', () => {
  const frames = [
    ev('message_start', { message: { usage: { input_tokens: 11 } } }),
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Let me ' } }),
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'check.' } }),
    ev('content_block_stop', { index: 0 }),
    ev('content_block_start', { index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'list_todos', input: {} } }),
    ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '{"view":' } }),
    ev('content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: '"today"}' } }),
    ev('content_block_stop', { index: 1 }),
    ev('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } }),
    ev('message_stop', {}),
  ]

  it('assembles text and a tool call that arrives in pieces, and reports usage', async () => {
    const fetchMock = vi.fn(async () => sse(frames))
    const { message, text } = await run(createAnthropicLLM({ apiKey: 'k', model: 'claude-sonnet-5-5', maxTokens: 100, fetch: fetchMock as never }))
    expect(text).toBe('Let me check.')
    expect(message.content).toEqual([{ type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 'tu_1', name: 'list_todos', input: { view: 'today' } }])
    expect(message.stop_reason).toBe('tool_use')
    expect(message.usage).toMatchObject({ input_tokens: 11, output_tokens: 9 })
  })

  it('sends the key only as a header to Anthropic, with browser access acknowledged, and strips fields it does not take', async () => {
    const fetchMock = vi.fn(async () => sse(frames))
    await run(createAnthropicLLM({ apiKey: 'sk-test', model: 'claude-haiku-5-5', maxTokens: 100, fetch: fetchMock as never }))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const h = init.headers as Record<string, string>
    expect(h['x-api-key']).toBe('sk-test')
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(h['anthropic-version']).toBeTruthy()
    expect(String(init.body)).not.toContain('sk-test')
    const body = JSON.parse(String(init.body))
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', stream: true, max_tokens: 100 })
    expect(body.tools[0]).toEqual({ name: TOOLS[0].name, description: TOOLS[0].description, input_schema: TOOLS[0].input_schema })
  })

  it('asks for a retry when a tool input is cut off mid-way', async () => {
    const bad = [ev('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 't', name: 'list_todos' } }), ev('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"view":' } }), ev('message_delta', { delta: { stop_reason: 'max_tokens' }, usage: {} })]
    await expect(run(createAnthropicLLM({ apiKey: 'k', model: 'm', maxTokens: 10, fetch: (async () => sse(bad)) as never }))).rejects.toBeInstanceOf(RetryableLLMError)
  })

  it.each([
    [401, { error: { message: 'invalid x-api-key' } }, 'auth', /rejected your API key/],
    [429, { error: { message: 'Your credit balance is too low' } }, 'quota', /quota/],
    [429, { error: { message: 'Number of requests exceeds' } }, 'rate', /slow down/],
    [400, { error: { message: 'model: nope' } }, 'bad_request', /model name/],
    [400, [{ error: { code: 400, message: 'Please pass a valid API key', status: 'INVALID_ARGUMENT' } }], 'auth', /rejected your API key/],
    [529, {}, 'server', /busy/],
  ])('explains a %i response in plain words', async (status, body, kind, words) => {
    const err = await run(createAnthropicLLM({ apiKey: 'k', model: 'm', maxTokens: 10, fetch: (async () => json(body, status)) as never })).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderError)
    expect(err.kind).toBe(kind)
    expect(err.message).toMatch(words)
  })

  it('reports a dropped connection as a network problem, and lets an abort through untouched', async () => {
    const net = await run(createAnthropicLLM({ apiKey: 'k', model: 'm', maxTokens: 10, fetch: (async () => { throw new TypeError('Failed to fetch') }) as never })).catch((e) => e)
    expect(net.kind).toBe('network')
    const abort = await run(createAnthropicLLM({ apiKey: 'k', model: 'm', maxTokens: 10, fetch: (async () => { throw new DOMException('x', 'AbortError') }) as never })).catch((e) => e)
    expect(abort).toBeInstanceOf(DOMException)
  })
})

describe('chat-completions adapter (Gemini, Groq, OpenRouter, OpenAI)', () => {
  const groq = providerById('groq')

  it('turns Claude-style history into tool calls and tool results', () => {
    const out = toOpenAIMessages('sys', [
      { role: 'user', content: 'what is due?' },
      { role: 'assistant', content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'c1', name: 'list_todos', input: { view: 'today' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '[]' }, { type: 'tool_result', tool_use_id: 'c2', content: 'bad', is_error: true }] },
    ])
    expect(out).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'what is due?' },
      { role: 'assistant', content: 'Checking.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_todos', arguments: '{"view":"today"}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: '[]' },
      { role: 'tool', tool_call_id: 'c2', content: 'Error: bad' },
    ])
  })

  it('streams text, and gathers a tool call from fragments', async () => {
    const frames = [
      oai({ choices: [{ delta: { content: 'One ' } }] }),
      oai({ choices: [{ delta: { content: 'moment.' } }] }),
      oai({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_9', function: { name: 'list_todos', arguments: '' } }] } }] }),
      oai({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"view":"ov' } }] } }] }),
      oai({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'erdue"}' } }] }, finish_reason: 'tool_calls' }] }),
      oai({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } }),
      oai('[DONE]'),
    ]
    const { message, text } = await run(createOpenAILLM({ provider: groq, apiKey: 'k', model: 'llama', maxTokens: 50, fetch: (async () => sse(frames)) as never }) as never)
    expect(text).toBe('One moment.')
    expect(message.content).toEqual([{ type: 'text', text: 'One moment.' }, { type: 'tool_use', id: 'call_9', name: 'list_todos', input: { view: 'overdue' } }])
    expect(message.stop_reason).toBe('tool_use')
    expect(message.usage).toEqual({ input_tokens: 20, output_tokens: 5 })
  })

  it('copes with a provider that leaves out ids, or says "stop" while asking for tools', async () => {
    const frames = [oai({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'list_workspaces', arguments: '{}' } }] }, finish_reason: 'stop' }] }), oai('[DONE]')]
    const { message } = await run(createOpenAILLM({ provider: groq, apiKey: 'k', model: 'm', maxTokens: 5, fetch: (async () => sse(frames)) as never }) as never)
    expect(message.stop_reason).toBe('tool_use')
    expect((message.content[0] as { id: string }).id).toMatch(/^call_0_/)
  })

  it.each([['length', 'max_tokens'], ['content_filter', 'refusal'], ['stop', 'end_turn']])('maps finish reason %s', async (finish, expected) => {
    const frames = [oai({ choices: [{ delta: { content: 'x' }, finish_reason: finish }] })]
    const { message } = await run(createOpenAILLM({ provider: groq, apiKey: 'k', model: 'm', maxTokens: 5, fetch: (async () => sse(frames)) as never }) as never)
    expect(message.stop_reason).toBe(expected)
  })

  it('calls the right address with the key as a bearer token, and each provider’s own token parameter', async () => {
    for (const id of ['gemini', 'groq', 'openrouter', 'openai'] as const) {
      const p = providerById(id)
      const fetchMock = vi.fn(async () => sse([oai({ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] })]))
      await run(createOpenAILLM({ provider: p, apiKey: 'sk-test', model: 'm', maxTokens: 77, fetch: fetchMock as never }) as never)
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      const body = JSON.parse(String(init.body))
      expect(url).toBe(`${p.baseUrl}/chat/completions`)
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
      expect(body[p.tokenParam]).toBe(77)
      expect(!!body.stream_options).toBe(p.streamUsage)
      expect(body.tools[0].function.name).toBe(TOOLS[0].name)
      expect(String(init.body)).not.toContain('sk-test')
    }
  })

  it('rejects unreadable tool arguments for a retry, and explains a bad key', async () => {
    const bad = [oai({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'a', function: { name: 'list_todos', arguments: '{"view":' } }] }, finish_reason: 'length' }] })]
    await expect(run(createOpenAILLM({ provider: groq, apiKey: 'k', model: 'm', maxTokens: 5, fetch: (async () => sse(bad)) as never }) as never)).rejects.toBeInstanceOf(RetryableLLMError)
    const err = await run(createOpenAILLM({ provider: groq, apiKey: 'k', model: 'm', maxTokens: 5, fetch: (async () => json({ error: { message: 'Invalid API Key' } }, 401)) as never }) as never).catch((e) => e)
    expect(err.kind).toBe('auth')
  })
})

describe('choosing and testing a provider', () => {
  const cfg = (provider: 'anthropic' | 'groq', over = {}) => ({ mode: 'own' as const, provider, model: providerById(provider).defaultModel, apiKey: 'k', remember: true, ...over })

  it('picks the adapter for the provider, and a cheaper model for briefings where there is one', async () => {
    const f = vi.fn(async () => sse([ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: {} })]))
    await createLLM(cfg('anthropic'), { maxTokens: 5, briefing: true }, f as never).stream({ system: 's', tools: [], messages: [] }).final()
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).model).toBe('claude-haiku-5-5')
    const g = vi.fn(async () => sse([oai({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })]))
    await createLLM(cfg('groq', { model: 'my-model' }), { maxTokens: 5, briefing: true }, g as never).stream({ system: 's', tools: [], messages: [] }).final()
    expect(JSON.parse(String((g.mock.calls[0] as unknown as [string, RequestInit])[1].body)).model).toBe('my-model')
  })

  it('reports whether a key works', async () => {
    expect(await testConnection(cfg('groq'), (async () => sse([oai({ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] })])) as never)).toEqual({ ok: true })
    const bad = await testConnection(cfg('groq'), (async () => json({ error: { message: 'nope' } }, 401)) as never)
    expect(bad).toMatchObject({ ok: false, message: expect.stringMatching(/rejected your API key/) })
  })

  it('only ever lists the five services in the browser allow-list', () => {
    expect(PROVIDER_ORIGINS.sort()).toEqual(['https://api.anthropic.com', 'https://api.groq.com', 'https://api.openai.com', 'https://generativelanguage.googleapis.com', 'https://openrouter.ai'])
  })
})

describe('the free assistant', () => {
  const free = { mode: 'free' as const, provider: 'gemini' as const, model: 'x', apiKey: '', remember: true }
  const chatReq = { system: 's', tools: TOOLS.slice(0, 1), messages: [{ role: 'user' as const, content: 'hi' }] }
  const stub = () => { vi.stubEnv('VITE_SUPABASE_URL', 'https://proj.supabase.co'); vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key'); sessionState.session = { access_token: 'user-jwt' } }

  it('calls our own function with the person’s session, and needs no AI key', async () => {
    stub()
    const f = vi.fn(async () => sse([oai({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] })]))
    const s = createLLM(free, { maxTokens: 50 }, f as never).stream(chatReq)
    await s.final()
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://proj.supabase.co/functions/v1/llm-proxy/chat/completions')
    const h = init.headers as Record<string, string>
    expect(h.authorization).toBe('Bearer user-jwt')
    expect(h.apikey).toBe('anon-key')
    expect(JSON.parse(String(init.body)).tools[0].function.name).toBe(TOOLS[0].name)
    vi.unstubAllEnvs()
  })

  it('asks the person to sign in again when there is no session', async () => {
    stub(); sessionState.session = null
    const err = await createLLM(free, { maxTokens: 5 }, (async () => sse([])) as never).stream(chatReq).final().catch((e) => e)
    expect(err).toMatchObject({ kind: 'session' })
    vi.unstubAllEnvs()
  })

  it.each([
    [429, { code: 'daily_limit', error: 'You have reached today’s limit.' }, 'quota'],
    [429, { code: 'busy', error: 'The free assistant is very busy.' }, 'rate'],
    [503, { code: 'free_unavailable', error: 'The free assistant is not available right now.' }, 'unavailable'],
    [401, { code: 'unauthorized', error: 'Please sign in again.' }, 'session'],
    [413, { code: 'bad_request', error: 'That request is too large.' }, 'bad_request'],
  ])('shows our own message for a %i reply with code %o', async (status, body, kind) => {
    stub()
    const err = await createLLM(free, { maxTokens: 5 }, (async () => json(body, status)) as never).stream(chatReq).final().catch((e) => e)
    expect(err.kind).toBe(kind)
    expect(err.message).toBe(body.error)
    vi.unstubAllEnvs()
  })

  it('finds out whether the free assistant is set up, and how much of today is left', async () => {
    stub()
    expect(await fetchFreeStatus((async () => json({ available: true, provider: 'Groq', dailyRequests: 200, used: 30 }, 200)) as never)).toEqual({ available: true, provider: 'Groq', dailyRequests: 200, used: 30 })
    expect(await fetchFreeStatus((async () => json({}, 404)) as never)).toMatchObject({ available: false })
    expect(await fetchFreeStatus((async () => json({}, 503)) as never)).toMatchObject({ available: false })
    expect(await fetchFreeStatus((async () => json({}, 500)) as never)).toBeNull()
    expect(await fetchFreeStatus((async () => { throw new TypeError('offline') }) as never)).toBeNull()
    vi.unstubAllEnvs()
  })
})
