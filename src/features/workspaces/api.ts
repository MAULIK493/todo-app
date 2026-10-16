import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useVault } from '@/features/security/vault'
import { supabase } from '@/lib/supabase'
import type { Workspace } from './types'

const KEY = ['workspaces'] as const
const COLUMNS =
  'id, name, color, icon, position, background, lock_state, lock_type, lock_salt, lock_iterations, wrapped_key, recovery_salt, recovery_wrapped_key'

export function useWorkspaces() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<Workspace[]> => {
      const { data, error } = await supabase.from('workspaces').select(COLUMNS).order('position').order('created_at')
      if (error) throw error
      useVault.getState().setInfo(data)
      return data
    },
  })
}

function useWorkspaceMutation<V>(fn: (v: V) => PromiseLike<{ error: { message: string } | null }>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: V) => {
      const { error } = await fn(v)
      if (error) throw new Error(error.message)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}

export const useCreateWorkspace = () =>
  useWorkspaceMutation((v: { name: string; color: string; position: number }) => supabase.from('workspaces').insert(v))

export const useUpdateWorkspace = () =>
  useWorkspaceMutation((v: { id: string; name?: string; color?: string; background?: unknown | null }) => {
    const { id, ...patch } = v
    return supabase.from('workspaces').update(patch).eq('id', id)
  })

export const useDeleteWorkspace = () =>
  useWorkspaceMutation((id: string) => supabase.from('workspaces').delete().eq('id', id))

export function useReorderWorkspaces() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ordered: Workspace[]) => {
      const results = await Promise.all(
        ordered.map((w, position) => supabase.from('workspaces').update({ position }).eq('id', w.id)),
      )
      const failed = results.find((r) => r.error)
      if (failed?.error) throw new Error(failed.error.message)
    },
    onMutate: async (ordered) => {
      await qc.cancelQueries({ queryKey: KEY })
      qc.setQueryData(KEY, ordered.map((w, position) => ({ ...w, position })))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
