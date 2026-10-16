// @vitest-environment jsdom
import { FakeDb } from '@shared/fakeDb.ts'
import type { LLM, LLMRequest } from '@shared/agent.ts'
import type { ServerEvent } from '@shared/types.ts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantError } from './errors'
import { ProviderError } from './llm/errors'

const db = new FakeDb([{ id: 'w1', name: 'Personal', lock_state: 'none' }, { id: 'w2', name: 'Diary', lock_state: 'locked' }])
const store = {
  usage: vi.fn(), recordUsage: vi.fn(async () => undefined), history: vi.fn(async () => [] as { role: 'user' | 'assistant'; content: string }[]),
  createConversation: vi.fn(async () => 'conv-1'), saveTurn: vi.fn(async () => undefined), briefing: vi.fn(async () => null as string | null), saveBriefing: vi.fn(async () => undefined),
}
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } }, isSupabaseConfigured: true }))
vi.mock('@shared/db.ts', () => ({ createDb: () => db, createStore: () => store }))

let script: (req: LLMRequest, call: number) => { text?: string; tool?: { id: string; name: string; input: unknown }; error?: unknown }
const seen: LLMRequest[] = []
vi.mock('./llm', async (orig) => ({
  ...(await orig<typeof import('./llm')>()),
  createLLM: (): LLM => ({
    stream(req) {
      seen.push(req)
      let cb: (d: string) => void = () => {}
      return {
        onText(f) { cb = f },
        async final() {
          const step = script(req, seen.length)
          if (step.error) throw step.error
          if (step.text) cb(step.text)
          const content = [...(step.text ? [{ type: 'text' as const, text: step.text }] : []), ...(step.tool ? [{ type: 'tool_use' as const, ...step.tool }] : [])]
          return { content, stop_reason: step.tool ? 'tool_use' : 'end_turn', usage: { input_tokens: 10, output_tokens: 4 } }
        },
      }
    },
  }),
}))

const { useAiConfig, readConfig, clearAiKey, hasAiKey } = await import('./llm/config')
const { runChat } = await import('./runChat')
const { ProviderSettings } = await import('./ProviderSettings')

const chat = (over: Partial<Parameters<typeof runChat>[0]> = {}) => {
  const events: ServerEvent[] = []
  const p = runChat({ message: 'what is due?', conversationId: null, privateContext: null, signal: new AbortController().signal, onEvent: (e) => events.push(e), ...over })
  return { events, p }
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  useAiConfig.setState({ mode: 'own', provider: 'groq', model: 'llama-3.3-70b-versatile', apiKey: 'test-key', remember: true })
  seen.length = 0
  for (const f of Object.values(store)) (f as ReturnType<typeof vi.fn>).mockClear()
  db.calls.length = 0
  script = () => ({ text: 'Hello!' })
})
afterEach(cleanup)

describe('the key stays on this device', () => {
  it('is saved only when the person says so, and otherwise only for the tab', () => {
    useAiConfig.getState().setKey('abc123')
    expect(JSON.parse(localStorage.getItem('ai-config')!)).toMatchObject({ provider: 'groq', apiKey: 'abc123', remember: true })

    useAiConfig.getState().setRemember(false)
    expect(JSON.parse(localStorage.getItem('ai-config')!).apiKey).toBeUndefined()
    expect(sessionStorage.getItem('ai-session-key')).toBe('abc123')
    expect(readConfig().apiKey).toBe('abc123') // survives a reload of the tab

    useAiConfig.getState().setRemember(true)
    expect(sessionStorage.getItem('ai-session-key')).toBeNull()
  })

  it('is forgotten on sign out, but the provider and model choice stay', () => {
    expect(hasAiKey()).toBe(true)
    clearAiKey()
    expect(hasAiKey()).toBe(false)
    expect(localStorage.getItem('ai-config')).not.toContain('test-key')
    expect(useAiConfig.getState()).toMatchObject({ provider: 'groq', model: 'llama-3.3-70b-versatile' })
  })

  it('switching service starts that service’s own model and an empty key', () => {
    useAiConfig.getState().setProvider('anthropic')
    expect(useAiConfig.getState()).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: '' })
  })

  it('starts in free mode, and remembers a switch to the person’s own key', () => {
    localStorage.clear()
    expect(readConfig().mode).toBe('free')
    useAiConfig.getState().setMode('own')
    expect(JSON.parse(localStorage.getItem('ai-config')!).mode).toBe('own')
    expect(readConfig().mode).toBe('own')
  })

  it('survives broken saved data', () => {
    localStorage.setItem('ai-config', '{not json')
    expect(readConfig()).toMatchObject({ mode: 'free', provider: 'gemini', apiKey: '' })
    localStorage.setItem('ai-config', JSON.stringify({ mode: 'weird', provider: 'evil', model: 5, apiKey: 7 }))
    expect(readConfig()).toMatchObject({ mode: 'free', provider: 'gemini', model: 'gemini-2.5-flash', apiKey: '' })
  })
})

describe('an assistant turn in the browser', () => {
  it('asks the person to add a key before doing anything when they chose their own key', async () => {
    useAiConfig.setState({ apiKey: '' })
    const { p } = chat()
    await expect(p).rejects.toMatchObject({ code: 'not_configured' })
    expect(seen).toHaveLength(0)
  })

  it('streams the reply, saves the chat, and records usage', async () => {
    const { events, p } = chat()
    await p
    expect(events.map((e) => e.type)).toEqual(['text', 'done'])
    expect(events[1]).toMatchObject({ type: 'done', conversationId: 'conv-1', persisted: true, usage: { input: 10, output: 4 } })
    expect(store.saveTurn).toHaveBeenCalledWith('conv-1', 'what is due?', 'Hello!', [])
    expect(store.recordUsage).toHaveBeenCalledWith(10, 4)
  })

  it('runs tools against the person’s own data and feeds the results back', async () => {
    script = (_req, call) => (call === 1 ? { text: 'Checking.', tool: { id: 't1', name: 'list_workspaces', input: {} } } : { text: 'You have Personal.' })
    const { events, p } = chat()
    await p
    expect(events.some((e) => e.type === 'tool' && e.status === 'done')).toBe(true)
    const result = (seen[1].messages.at(-1)!.content as { type: string; content: string }[])[0]
    expect(result.type).toBe('tool_result')
    expect(result.content).toContain('Personal')
    expect(result.content).not.toContain('Diary') // a locked workspace never reaches the model
  })

  it('works in free mode without any key', async () => {
    useAiConfig.setState({ mode: 'free', apiKey: '' })
    const { events, p } = chat()
    await p
    expect(events.at(-1)).toMatchObject({ type: 'done', persisted: true })
  })

  it('turns the free assistant’s own messages into the right notices', async () => {
    useAiConfig.setState({ mode: 'free', apiKey: '' })
    script = () => ({ error: new ProviderError('unavailable', 503, 'The free assistant is not available right now.') })
    await expect(chat().p).rejects.toMatchObject({ code: 'not_configured', message: expect.stringMatching(/not available/) })
    script = () => ({ error: new ProviderError('quota', 429, 'You have reached today’s limit.') })
    await expect(chat().p).rejects.toMatchObject({ code: 'rate_limited', message: expect.stringMatching(/today/) })
    script = () => ({ error: new ProviderError('rate', 429, 'The free assistant is very busy right now.') })
    await expect(chat().p).rejects.toMatchObject({ code: 'rate_limited' })
    script = () => ({ error: new ProviderError('session', 401, 'Please sign in again.') })
    await expect(chat().p).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('does not save a chat that used private content', async () => {
    const { events, p } = chat({ privateContext: 'Secret diary text' })
    await p
    expect(events.at(-1)).toMatchObject({ type: 'done', persisted: false })
    expect(store.createConversation).not.toHaveBeenCalled()
    expect(store.saveTurn).not.toHaveBeenCalled()
    expect(JSON.stringify(seen[0].messages)).toContain('Secret diary text')
  })

  it('sends a rejected key, and a used-up quota, back as notices with a way to fix them', async () => {
    script = () => ({ error: new ProviderError('auth', 401, 'The provider rejected your API key.') })
    await expect(chat().p).rejects.toMatchObject({ code: 'not_configured', message: expect.stringMatching(/rejected/) })
    script = () => ({ error: new ProviderError('quota', 429, 'You have used up this key’s quota.') })
    await expect(chat().p).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(chat().p).rejects.toBeInstanceOf(AssistantError)
  })

  it('shows other provider problems in the conversation, and hides unexpected internals', async () => {
    script = () => ({ error: new ProviderError('server', 503, 'The provider is busy or having problems.') })
    const a = chat(); await a.p
    expect(a.events.at(-1)).toMatchObject({ type: 'error', message: expect.stringMatching(/busy/) })
    script = () => ({ error: new Error('TypeError: x is undefined at secret/path.ts:12') })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const b = chat(); await b.p
    expect((b.events.at(-1) as { message: string }).message).not.toMatch(/secret|undefined/)
  })

  it('lets a stop button abort without an error', async () => {
    script = () => ({ error: new DOMException('aborted', 'AbortError') })
    await expect(chat().p).rejects.toBeInstanceOf(DOMException)
  })
})

const withQuery = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>

describe('provider settings', () => {
  it('shows the free assistant first, with what is left of today’s allowance and where messages go', async () => {
    useAiConfig.setState({ mode: 'free', apiKey: '' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ available: true, provider: 'Groq', dailyRequests: 200, used: 30 }))))
    render(withQuery(<ProviderSettings />))
    expect((screen.getByRole('radio', { name: /Free assistant/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByLabelText(/API key/)).toBeNull()
    expect((await screen.findByText(/170 of 200/)).textContent).toMatch(/170 of 200/)
    expect(screen.getByText(/through our server to Groq/)).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('says so when the free assistant is not switched on, and lets the person use their own key', async () => {
    useAiConfig.setState({ mode: 'free', apiKey: '' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
    render(withQuery(<ProviderSettings />))
    expect((await screen.findByRole('status')).textContent).toMatch(/not available right now/)
    fireEvent.click(screen.getByRole('radio', { name: /My own key/ }))
    expect(useAiConfig.getState().mode).toBe('own')
    expect(screen.getByLabelText(/API key/)).toBeTruthy()
    vi.unstubAllGlobals()
  })

  it('lets the person choose a service, paste a key, and test it', async () => {
    useAiConfig.setState({ mode: 'own', provider: 'gemini', model: 'gemini-2.5-flash', apiKey: '', remember: true })
    const fetchMock = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    render(<ProviderSettings />)

    expect((screen.getByRole('button', { name: 'Test connection' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /Groq/ }))
    expect(useAiConfig.getState().provider).toBe('groq')
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('llama-3.3-70b-versatile')

    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: '  my-key  ' } })
    expect(useAiConfig.getState().apiKey).toBe('my-key')
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/Works/)
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://api.groq.com/openai/v1/chat/completions')
    vi.unstubAllGlobals()
  })

  it('says why a key does not work, and can remove it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 })))
    render(<ProviderSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/rejected your API key/))
    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }))
    expect(useAiConfig.getState().apiKey).toBe('')
    vi.unstubAllGlobals()
  })

  it('hides the key by default, can reveal it, and explains where the key and messages go', () => {
    render(<ProviderSettings />)
    expect((screen.getByLabelText(/API key/) as HTMLInputElement).type).toBe('password')
    fireEvent.click(screen.getByRole('button', { name: 'Show key' }))
    expect((screen.getByLabelText(/API key/) as HTMLInputElement).type).toBe('text')
    expect(screen.getByText(/sent only to Groq/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /Get a key/ }).getAttribute('rel')).toContain('noopener')
  })
})
