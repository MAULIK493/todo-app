import { useQuery } from '@tanstack/react-query'
import type { LLM } from '@shared/agent.ts'
import { supabase } from '@/lib/supabase'
import { ProviderError } from './errors'
import { createOpenAILLM } from './openai'

/** The app's own free assistant: a small server function that forwards to a free-tier model on the host's key. */
const endpoint = () => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/llm-proxy`

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  if (!data.session) throw new ProviderError('session', 401, 'Please sign in again.')
  return { authorization: `Bearer ${data.session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string }
}

export function createFreeLLM(o: { maxTokens: number; signal?: AbortSignal; fetch?: typeof fetch }): LLM {
  // The model name is the server's choice; "free" is only a placeholder the server ignores.
  return createOpenAILLM({
    provider: { id: 'free' as never, baseUrl: endpoint(), tokenParam: 'max_tokens', streamUsage: false },
    apiKey: '', model: 'free', maxTokens: o.maxTokens, signal: o.signal, fetch: o.fetch, headers: authHeaders,
  })
}

export type FreeStatus = { available: boolean; provider: string | null; dailyRequests: number; used: number }

/** Whether the free assistant is set up, and how much of today's allowance this person has used. Null if it could not be checked. */
export async function fetchFreeStatus(fetchImpl: typeof fetch = fetch): Promise<FreeStatus | null> {
  try {
    const res = await fetchImpl(endpoint(), { headers: await authHeaders() })
    // 404: the function has not been deployed. 503: it is deployed but no free key has been set.
    if (res.status === 404 || res.status === 503) return { available: false, provider: null, dailyRequests: 0, used: 0 }
    if (!res.ok) return null
    const b = (await res.json()) as Partial<FreeStatus>
    return { available: b.available === true, provider: typeof b.provider === 'string' ? b.provider : null, dailyRequests: Number(b.dailyRequests) || 0, used: Number(b.used) || 0 }
  } catch {
    return null
  }
}

export function useFreeStatus(enabled: boolean) {
  return useQuery({ queryKey: ['assistant', 'free-status'], enabled, staleTime: 60_000, retry: false, queryFn: () => fetchFreeStatus() })
}
