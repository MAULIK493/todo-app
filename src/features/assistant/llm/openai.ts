import type { AMessage, ContentBlock, LLM, LLMRequest, MsgParam } from '@shared/agent.ts'
import { RetryableLLMError } from '@shared/agent.ts'
import { failureFromResponse, networkFailure } from './errors'
import type { Provider } from './providers'
import { readSse } from './sse'

export type OpenAIOptions = {
  provider: Pick<Provider, 'baseUrl' | 'tokenParam' | 'streamUsage' | 'id'>
  apiKey: string
  model: string
  maxTokens: number
  signal?: AbortSignal
  fetch?: typeof fetch
  /** Replaces the usual bearer-token header (the free assistant signs in with the person's session instead). */
  headers?: () => Promise<Record<string, string>>
}

type OAIMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string }

/** Our conversation uses Claude-style content blocks; chat-completions APIs want tool calls and tool results as their own messages. */
export function toOpenAIMessages(system: string, messages: MsgParam[]): OAIMessage[] {
  const out: OAIMessage[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue }
    const blocks = m.content as { type: string; [k: string]: unknown }[]
    if (m.role === 'assistant') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text as string).join('')
      const calls = blocks.filter((b) => b.type === 'tool_use').map((b) => ({
        id: b.id as string, type: 'function' as const, function: { name: b.name as string, arguments: JSON.stringify(b.input ?? {}) },
      }))
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) })
    } else {
      for (const b of blocks) {
        if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id as string, content: (b.is_error ? 'Error: ' : '') + String(b.content ?? '') })
        else if (b.type === 'text') out.push({ role: 'user', content: b.text as string })
      }
    }
  }
  return out
}

const STOP: Record<string, string> = { stop: 'end_turn', tool_calls: 'tool_use', function_call: 'tool_use', length: 'max_tokens', content_filter: 'refusal' }

/** Streams any "chat completions" style API (Gemini, Groq, OpenRouter, OpenAI) and presents it in the shape the agent loop expects. */
export function createOpenAILLM(o: OpenAIOptions): LLM {
  const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  return {
    stream(req: LLMRequest) {
      let onText: (d: string) => void = () => {}
      return {
        onText(cb) { onText = cb },
        async final(): Promise<AMessage> {
          const headers = o.headers
            ? await o.headers()
            : { authorization: `Bearer ${o.apiKey}`, ...(o.provider.id === 'openrouter' ? { 'X-Title': 'Todo App' } : {}) }
          let res: Response
          try {
            res = await doFetch(`${o.provider.baseUrl}/chat/completions`, {
              method: 'POST',
              signal: o.signal,
              headers: { 'content-type': 'application/json', ...headers },
              body: JSON.stringify({
                model: o.model,
                stream: true,
                [o.provider.tokenParam]: o.maxTokens,
                ...(o.provider.streamUsage ? { stream_options: { include_usage: true } } : {}),
                messages: toOpenAIMessages(req.system, req.messages),
                ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })) } : {}),
              }),
            })
          } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') throw e
            throw networkFailure()
          }
          if (!res.ok || !res.body) throw await failureFromResponse(res)

          let text = ''
          const calls: { id: string; name: string; args: string }[] = []
          let finish: string | null = null
          const usage = { input_tokens: 0, output_tokens: 0 }

          for await (const { data } of readSse(res.body)) {
            if (data === '[DONE]') break
            let chunk: Record<string, any>
            try { chunk = JSON.parse(data) } catch { continue }
            if (chunk.usage) { usage.input_tokens = chunk.usage.prompt_tokens ?? 0; usage.output_tokens = chunk.usage.completion_tokens ?? 0 }
            const choice = chunk.choices?.[0]
            if (!choice) continue
            const d = choice.delta ?? {}
            if (typeof d.content === 'string' && d.content) { text += d.content; onText(d.content) }
            for (const tc of d.tool_calls ?? []) {
              // Pieces of one call share an index; the id and name arrive first, the arguments in fragments.
              const i = tc.index ?? 0
              const c = (calls[i] ??= { id: '', name: '', args: '' })
              if (tc.id) c.id = tc.id
              if (tc.function?.name) c.name += tc.function.name
              if (tc.function?.arguments) c.args += tc.function.arguments
            }
            if (choice.finish_reason) finish = choice.finish_reason
          }

          const content: ContentBlock[] = []
          if (text) content.push({ type: 'text', text })
          const used = calls.filter(Boolean)
          used.forEach((c, i) => {
            let input: unknown
            try { input = c.args.trim() ? JSON.parse(c.args) : {} } catch { throw new RetryableLLMError(`could not read the input of ${c.name}`) }
            // Some providers leave the id empty; it only has to match between the call and its result.
            content.push({ type: 'tool_use', id: c.id || `call_${i}_${Math.random().toString(36).slice(2, 8)}`, name: c.name, input })
          })
          // A model that calls tools but reports "stop" is still asking for the tools to run.
          const stop = used.length > 0 && (!finish || finish === 'stop') ? 'tool_use' : (STOP[finish ?? ''] ?? 'end_turn')
          return { content, stop_reason: stop, usage }
        },
      }
    },
  }
}
