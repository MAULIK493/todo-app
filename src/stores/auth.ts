import type { Session } from '@supabase/supabase-js'
import { create } from 'zustand'
import { clearAiKey } from '@/features/assistant/llm/config'
import { persister } from '@/features/offline/persist'
import { useVault } from '@/features/security/vault'
import { queryClient } from '@/lib/queryClient'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'

type AuthState = { session: Session | null; loading: boolean }

export const useAuth = create<AuthState>(() => ({ session: null, loading: isSupabaseConfigured }))

if (isSupabaseConfigured) {
  supabase.auth.getSession().then(({ data }) => useAuth.setState({ session: data.session, loading: false }))
  supabase.auth.onAuthStateChange((_event, session) => {
    if (!session) {
      // Signed out (or the session expired): nothing decrypted may stay in memory.
      useVault.getState().lockAll()
      clearAiKey()
      queryClient.clear()
      void persister.removeClient()
    }
    useAuth.setState({ session, loading: false })
  })
}
