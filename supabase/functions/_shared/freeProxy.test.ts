import { describe, expect, it } from 'vitest'
import { describeUpstreamFailure, MAX_OUTPUT_TOKENS, readFreeConfig, sanitizeChatBody, upstreamMessage } from './freeProxy.ts'

const cfg: { model: string; streamUsage: boolean; provider?: string } = { model: 'the-model', streamUsage: true }
const ok = (raw: unknown, c = cfg) => { const r = sanitizeChatBody(raw, c); if (!r.ok) throw new Error(r.error); return r.body }
const bad = (raw: unknown) => { const r = sanitizeChatBody(raw, cfg); return r.ok ? null : r.error }

describe('free assistant configuration', () => {
  it('needs a key and a known service, and defaults to Groq', () => {
    expect(readFreeConfig(() => undefined)).toBeNull()
    expect(readFreeConfig((k) => (k === 'FREE_LLM_API_KEY' ? 'abc' : undefined))).toMatchObject({ provider: 'groq', key: 'abc', model: 'llama-3.3-70b-versatile' })
    expect(readFreeConfig((k) => ({ FREE_LLM_API_KEY: ' k ', FREE_LLM_PROVIDER: 'Gemini', FREE_LLM_MODEL: 'gemini-x' } as Record<string, string>)[k])).toMatchObject({ provider: 'gemini', key: 'k', model: 'gemini-x', streamUsage: false })
    expect(readFreeConfig((k) => ({ FREE_LLM_API_KEY: 'k', FREE_LLM_PROVIDER: 'anthropic' } as Record<string, string>)[k])).toBeNull() // never Claude
  })
})

describe('free assistant request check', () => {
  it('rebuilds the request from allowed fields only, using the host’s model', () => {
    const body = ok({
      model: 'gpt-5-expensive', stream: false, temperature: 2, tool_choice: 'x', user: 'u', n: 50,
      messages: [{ role: 'system', content: 's', extra: 1 }, { role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'list_todos', description: 'd', parameters: { type: 'object', additionalProperties: false, properties: { view: { type: 'string' } } } }, extra: 1 }],
    })
    expect(body).toEqual({
      model: 'the-model', stream: true, max_tokens: MAX_OUTPUT_TOKENS, stream_options: { include_usage: true },
      messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'list_todos', description: 'd', parameters: { type: 'object', properties: { view: { type: 'string' } } } } }],
    })
  })

  it('caps output size, and leaves out stream options for services that reject them', () => {
    expect(ok({ messages: [{ role: 'user', content: 'x' }], max_tokens: 999_999 }).max_tokens).toBe(MAX_OUTPUT_TOKENS)
    expect(ok({ messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }).max_tokens).toBe(16)
    expect(ok({ messages: [{ role: 'user', content: 'x' }] }, { model: 'm', streamUsage: false }).stream_options).toBeUndefined()
  })

  it('keeps tool calls and results intact', () => {
    const body = ok({ messages: [
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' }, junk: 1 }] },
      { role: 'tool', tool_call_id: 'c1', content: 'r' },
    ] })
    expect(body.messages).toEqual([
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'r' },
    ])
  })

  it('leaves parameters out for a tool that takes none, which Gemini requires', () => {
    const body = ok({ messages: [{ role: 'user', content: 'x' }], tools: [{ type: 'function', function: { name: 'list_workspaces', description: 'd', parameters: { type: 'object', properties: {}, additionalProperties: false } } }] })
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'list_workspaces', description: 'd' } }])
  })

  it('tells Gemini which tool each result belongs to, and nobody else', () => {
    const messages = [
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_todos', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'r' },
    ]
    expect((ok({ messages }, { ...cfg, provider: 'gemini' }).messages as { name?: string }[])[1].name).toBe('list_todos')
    expect((ok({ messages }, { ...cfg, provider: 'groq' }).messages as { name?: string }[])[1].name).toBeUndefined()
  })

  it('rejects anything malformed or oversized', () => {
    expect(bad(null)).toBeTruthy()
    expect(bad({})).toBeTruthy()
    expect(bad({ messages: [] })).toBeTruthy()
    expect(bad({ messages: Array.from({ length: 121 }, () => ({ role: 'user', content: 'x' })) })).toBeTruthy()
    expect(bad({ messages: [{ role: 'root', content: 'x' }] })).toBeTruthy()
    expect(bad({ messages: [{ role: 'user', content: { a: 1 } }] })).toBeTruthy()
    expect(bad({ messages: [{ role: 'tool', content: 'x' }] })).toBeTruthy()
    expect(bad({ messages: [{ role: 'user', content: 'x' }], tools: 'all' })).toBeTruthy()
    expect(bad({ messages: [{ role: 'user', content: 'x' }], tools: [{ type: 'function', function: { name: 1 } }] })).toBeTruthy()
    expect(() => sanitizeChatBody({ messages: [{ role: 'assistant', content: null, tool_calls: [{ id: 1 }] }] }, cfg)).toThrow()
  })
})

describe('free assistant errors', () => {
  it('never passes on the service’s own reply, and says what the person can do', () => {
    expect(describeUpstreamFailure(401)).toMatchObject({ status: 503, code: 'free_unavailable' })
    expect(describeUpstreamFailure(429)).toMatchObject({ status: 429, code: 'busy' })
    expect(describeUpstreamFailure(503)).toMatchObject({ status: 502, code: 'server' })
    expect(describeUpstreamFailure(400)).toMatchObject({ status: 502, code: 'server' })
    expect(describeUpstreamFailure(401).error).toMatch(/your own key/)
  })

  it('treats a rejected key reported as a 400 (Gemini) the same as a 401', () => {
    expect(describeUpstreamFailure(400, 'Invalid Auth key.')).toMatchObject({ status: 503, code: 'free_unavailable' })
    expect(describeUpstreamFailure(400, 'Please pass a valid API key')).toMatchObject({ code: 'free_unavailable' })
    expect(describeUpstreamFailure(400, 'Unknown name "x"')).toMatchObject({ code: 'server' })
  })

  it('includes the service’s own explanation for a request it did not understand, but not for key or capacity problems', () => {
    expect(describeUpstreamFailure(400, 'Unknown name "x" at tools[0]').error).toContain('Unknown name "x" at tools[0]')
    expect(describeUpstreamFailure(400).error).toContain('error 400')
    expect(describeUpstreamFailure(401, 'secret detail').error).not.toContain('secret')
    expect(describeUpstreamFailure(429, 'quota detail').error).not.toContain('quota detail')
  })

  it('reads the short explanation out of the reply formats the services use', () => {
    expect(upstreamMessage(JSON.stringify([{ error: { code: 400, message: 'Bad  field\nhere' } }]))).toBe('Bad field here')
    expect(upstreamMessage('{"error":{"message":"nope"}}')).toBe('nope')
    expect(upstreamMessage('{"error":"plain"}')).toBe('plain')
    expect(upstreamMessage('not json')).toBe('')
    expect(upstreamMessage(JSON.stringify({ error: { message: 'x'.repeat(1000) } })).length).toBe(240)
  })
})
