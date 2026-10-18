export type ProviderId = 'gemini' | 'groq' | 'openrouter' | 'openai' | 'anthropic'

export type Provider = {
  id: ProviderId
  name: string
  /** Claude has its own API; the rest all speak the common "chat completions" format. */
  api: 'anthropic' | 'openai'
  baseUrl: string
  defaultModel: string
  /** Cheaper model for the daily briefing, when the provider has an obvious one. */
  briefingModel?: string
  models: string[]
  /** Where a person creates a key. */
  keyUrl: string
  free: string | null
  note: string
  /** Newer OpenAI models reject `max_tokens` and want `max_completion_tokens`. */
  tokenParam: 'max_tokens' | 'max_completion_tokens'
  /** Whether it reports token usage while streaming. */
  streamUsage: boolean
}

export const PROVIDERS: Provider[] = [
  {
    id: 'gemini', name: 'Google Gemini', api: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash', models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
    keyUrl: 'https://aistudio.google.com/apikey', free: 'Free tier', note: 'A good place to start: the free tier is generous and needs no card.',
    tokenParam: 'max_tokens', streamUsage: false,
  },
  {
    id: 'groq', name: 'Groq', api: 'openai', baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    keyUrl: 'https://console.groq.com/keys', free: 'Free tier', note: 'Very fast replies, with a free tier that has daily limits.',
    tokenParam: 'max_tokens', streamUsage: true,
  },
  {
    id: 'openrouter', name: 'OpenRouter', api: 'openai', baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-oss-20b:free', models: ['openai/gpt-oss-20b:free', 'meta-llama/llama-3.3-70b-instruct:free', 'anthropic/claude-sonnet-4.5'],
    keyUrl: 'https://openrouter.ai/keys', free: 'Free models', note: 'One key for many models. Models ending in ":free" cost nothing but may be slower or busy.',
    tokenParam: 'max_tokens', streamUsage: true,
  },
  {
    id: 'openai', name: 'OpenAI', api: 'openai', baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini', briefingModel: 'gpt-4.1-mini', models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini'],
    keyUrl: 'https://platform.openai.com/api-keys', free: null, note: 'Paid. You are billed by OpenAI for what you use.',
    tokenParam: 'max_completion_tokens', streamUsage: true,
  },
  {
    id: 'anthropic', name: 'Claude (Anthropic)', api: 'anthropic', baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-5-5', briefingModel: 'claude-haiku-5-5', models: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
    keyUrl: 'https://console.anthropic.com/settings/keys', free: null, note: 'Paid. The strongest at following instructions and using your todos and notes.',
    tokenParam: 'max_tokens', streamUsage: true,
  },
]

export const providerById = (id: string): Provider => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0]
export const isProviderId = (v: unknown): v is ProviderId => PROVIDERS.some((p) => p.id === v)

/** Hostnames the browser app may talk to for AI (also listed in the security headers in vercel.json). */
export const PROVIDER_ORIGINS = PROVIDERS.map((p) => new URL(p.baseUrl).origin)
