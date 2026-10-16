import type { LLM } from '@shared/agent.ts'
import { createAnthropicLLM } from './anthropic'
import type { AiConfig } from './config'
import { createFreeLLM } from './free'
import { createOpenAILLM } from './openai'
import { providerById } from './providers'

export type MakeLLM = (o: { maxTokens: number; signal?: AbortSignal; briefing?: boolean }) => LLM

/** The model client for whatever provider the person chose. */
export function createLLM(config: AiConfig, o: { maxTokens: number; signal?: AbortSignal; briefing?: boolean }, fetchImpl?: typeof fetch): LLM {
  if (config.mode === 'free') return createFreeLLM({ maxTokens: o.maxTokens, signal: o.signal, fetch: fetchImpl })
  const provider = providerById(config.provider)
  const model = o.briefing && provider.briefingModel ? provider.briefingModel : config.model
  if (provider.api === 'anthropic') return createAnthropicLLM({ apiKey: config.apiKey, model, maxTokens: o.maxTokens, signal: o.signal, baseUrl: provider.baseUrl, fetch: fetchImpl })
  return createOpenAILLM({ provider, apiKey: config.apiKey, model, maxTokens: o.maxTokens, signal: o.signal, fetch: fetchImpl })
}

/** One tiny request to find out whether the key, provider and model work together. */
export async function testConnection(config: AiConfig, fetchImpl?: typeof fetch): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const stream = createLLM(config, { maxTokens: 32 }, fetchImpl).stream({ system: 'Reply with the single word OK.', tools: [], messages: [{ role: 'user', content: 'ping' }] })
    await stream.final()
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'That did not work.' }
  }
}
