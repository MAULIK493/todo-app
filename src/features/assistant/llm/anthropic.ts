import type { AMessage, ContentBlock, LLM, LLMRequest } from '@shared/agent.ts'
import { RetryableLLMError } from '@shared/agent.ts'
import { failureFromResponse, networkFailure, ProviderError } from './errors'
import { readSse } from './sse'

export type AnthropicOptions = {
  apiKey: string
  model: string
  baseUrl?: string
  maxTokens: number
  signal?: AbortSignal
  fetch?: typeof fetch
}

type Pending = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; json: string } | { type: 'other' }

/** Streams Claude's Messages API straight from the browser (the key is the person's own, kept on this device). */
export function createAnthropicLLM(o: AnthropicOptions): LLM {
  const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  return {
    stream(req: LLMRequest) {
      let onText: (d: string) => void = () => {}
      return {
        onText(cb) { onText = cb },
        async final(): Promise<AMessage> {
          let res: Response
          try {
            res = await doFetch(`${o.baseUrl ?? 'https://api.anthropic.com/v1'}/messages`, {
              method: 'POST',
              signal: o.signal,
              headers: {
                'content-type': 'application/json',
                'x-api-key': o.apiKey,
                'anthropic-version': '2023-06-01',
                // Anthropic requires this acknowledgement for calls made from a browser. It is safe here because
                // the key belongs to the person using the page and is never sent anywhere else.
                'anthropic-dangerous-direct-browser-access': 'true',
              },
              body: JSON.stringify({
                model: o.model,
                max_tokens: o.maxTokens,
                stream: true,
                system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
                ...(req.tools.length ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })) } : {}),
                messages: req.messages,
              }),
            })
          } catch (e) {
            if (e instanceof DOMException && e.name === 'AbortError') throw e
            throw networkFailure()
          }
          if (!res.ok || !res.body) throw await failureFromResponse(res)

          const blocks: Pending[] = []
          const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
          let stop: string | null = null

          for await (const { data } of readSse(res.body)) {
            let ev: Record<string, any>
            try { ev = JSON.parse(data) } catch { continue }
            switch (ev.type) {
              case 'message_start': {
                const u = ev.message?.usage ?? {}
                usage.input_tokens = u.input_tokens ?? 0
                usage.cache_creation_input_tokens = u.cache_creation_input_tokens ?? 0
                usage.cache_read_input_tokens = u.cache_read_input_tokens ?? 0
                break
              }
              case 'content_block_start': {
                const b = ev.content_block ?? {}
                blocks[ev.index] = b.type === 'text' ? { type: 'text', text: b.text ?? '' } : b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, json: '' } : { type: 'other' }
                break
              }
              case 'content_block_delta': {
                const b = blocks[ev.index]
                const d = ev.delta ?? {}
                if (b?.type === 'text' && d.type === 'text_delta') { b.text += d.text; onText(d.text) }
                else if (b?.type === 'tool_use' && d.type === 'input_json_delta') b.json += d.partial_json ?? ''
                break
              }
              case 'message_delta':
                stop = ev.delta?.stop_reason ?? stop
                usage.output_tokens = ev.usage?.output_tokens ?? usage.output_tokens
                break
              case 'error':
                throw new ProviderError(ev.error?.type === 'overloaded_error' ? 'server' : 'server', 0, 'The provider is busy or having problems. Try again in a moment.')
            }
          }

          const content: ContentBlock[] = []
          for (const b of blocks) {
            if (!b || b.type === 'other') continue
            if (b.type === 'text') { if (b.text) content.push({ type: 'text', text: b.text }); continue }
            let input: unknown
            try { input = b.json.trim() ? JSON.parse(b.json) : {} } catch { throw new RetryableLLMError(`could not read the input of ${b.name}`) }
            content.push({ type: 'tool_use', id: b.id, name: b.name, input })
          }
          return { content, stop_reason: stop, usage }
        },
      }
    },
  }
}
