import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tone } from '@shared/types.ts'
import { supabase } from '@/lib/supabase'
import { isAiConfigured, useAiConfig } from './llm/config'

const fail = (e: { message: string } | null) => {
  if (e) throw new Error(e.message)
}

export { AssistantError } from './errors'

/** Runs one assistant turn in the browser with the person's own AI key. */
// Loaded on first use: the agent and tool code is only needed once someone actually sends a message.
export const streamChat = async (o: Parameters<typeof import('./runChat').runChat>[0]) => (await import('./runChat')).runChat(o)

// ---- conversations ----

export type ConversationSummary = { id: string; title: string; updated_at: string }

export function useConversations() {
  return useQuery({
    queryKey: ['assistant', 'conversations'],
    queryFn: async (): Promise<ConversationSummary[]> => {
      const { data, error } = await supabase.from('ai_conversations').select('id, title, updated_at').order('updated_at', { ascending: false }).limit(30)
      fail(error)
      return data as ConversationSummary[]
    },
  })
}

export function useConversationMutations() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: ['assistant', 'conversations'] })
  return {
    remove: useMutation({
      mutationFn: async (id: string) => fail((await supabase.from('ai_conversations').delete().eq('id', id)).error),
      onSettled: done,
    }),
    clearAll: useMutation({
      mutationFn: async () => fail((await supabase.from('ai_conversations').delete().not('id', 'is', null)).error),
      onSettled: done,
    }),
  }
}

// ---- preferences ----

export type AiPrefs = { tone: Tone; briefing_enabled: boolean }
const DEFAULT_PREFS: AiPrefs = { tone: 'friendly', briefing_enabled: true }

export function useAiPrefs() {
  return useQuery({
    queryKey: ['assistant', 'prefs'],
    queryFn: async (): Promise<AiPrefs> => {
      const { data, error } = await supabase.from('ai_preferences').select('tone, briefing_enabled').maybeSingle()
      fail(error)
      return (data as AiPrefs | null) ?? DEFAULT_PREFS
    },
  })
}

export function useSetAiPrefs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (patch: Partial<AiPrefs>) => {
      const current = qc.getQueryData<AiPrefs>(['assistant', 'prefs']) ?? DEFAULT_PREFS
      fail((await supabase.from('ai_preferences').upsert({ ...current, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })).error)
    },
    onMutate: (patch) => qc.setQueryData<AiPrefs>(['assistant', 'prefs'], (old) => ({ ...(old ?? DEFAULT_PREFS), ...patch })),
    onSettled: () => qc.invalidateQueries({ queryKey: ['assistant', 'prefs'] }),
  })
}

/** workspace id -> explicit choice. A missing entry means the default (on for normal workspaces, off for private ones). */
export function useWorkspaceAccess() {
  return useQuery({
    queryKey: ['assistant', 'access'],
    queryFn: async (): Promise<Record<string, boolean>> => {
      const { data, error } = await supabase.from('ai_workspace_prefs').select('workspace_id, allowed')
      fail(error)
      return Object.fromEntries((data ?? []).map((r: { workspace_id: string; allowed: boolean }) => [r.workspace_id, r.allowed]))
    },
  })
}

export function useSetWorkspaceAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { workspaceId: string; allowed: boolean }) =>
      fail((await supabase.from('ai_workspace_prefs').upsert({ workspace_id: v.workspaceId, allowed: v.allowed }, { onConflict: 'user_id,workspace_id' })).error),
    onMutate: (v) => qc.setQueryData<Record<string, boolean>>(['assistant', 'access'], (old) => ({ ...(old ?? {}), [v.workspaceId]: v.allowed })),
    onSettled: () => qc.invalidateQueries({ queryKey: ['assistant', 'access'] }),
  })
}

export type UsageSummary = { requests_today: number; tokens_today: number; tokens_month: number }

export function useAiUsage(enabled: boolean) {
  return useQuery({
    queryKey: ['assistant', 'usage'],
    enabled,
    queryFn: async (): Promise<UsageSummary> => {
      const { data, error } = await supabase.rpc('ai_usage_summary')
      fail(error)
      return data as UsageSummary
    },
  })
}

// ---- briefing ----

export function useBriefing(kind: 'morning' | 'evening' | null, enabled: boolean) {
  const hasKey = useAiConfig(isAiConfigured)
  return useQuery({
    queryKey: ['assistant', 'briefing', kind, hasKey],
    enabled: enabled && kind !== null,
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async (): Promise<string | null> => (await import('./briefing')).loadBriefing(kind!),
  })
}
