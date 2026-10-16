import { clearAiKey } from '@/features/assistant/llm/config'
import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useVault } from '@/features/security/vault'
import { queryClient } from '@/lib/queryClient'
import { supabase } from '@/lib/supabase'
import { CONFIRM_WORD } from '@shared/account.ts'

/** Permanently deletes the account and everything in it. */
export function DeleteAccount() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      const { data } = await supabase.auth.getSession()
      if (!data.session) throw new Error('Please sign in again.')
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-account`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: typed }),
      })
      const body = (await res.json().catch(() => ({}))) as { deleted?: boolean; error?: string }
      if (!res.ok || !body.deleted) throw new Error(body.error ?? 'Could not delete the account.')
      // Nothing of theirs may stay on this device either.
      useVault.getState().lockAll()
      clearAiKey()
      queryClient.clear()
      for (const k of Object.keys(localStorage)) if (/^(ai-|voice|sound|auto-lock|lock-attempts|sidebar|effects|sb-)/.test(k)) localStorage.removeItem(k)
      await supabase.auth.signOut()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the account.')
      setBusy(false)
    }
  }

  return (
    <section className="glass space-y-3 rounded-2xl border border-red-400/30 p-5" aria-label="Delete account">
      <h2 className="flex items-center gap-2 font-semibold text-red-400"><Trash2 size={18} aria-hidden /> Delete account</h2>
      <p className="text-sm text-muted">Permanently deletes your account and everything in it: todos, notes, workspaces, rewards, chats and uploaded backgrounds. This can’t be undone, so export a backup first.</p>
      {!open ? (
        <button onClick={() => setOpen(true)} className="rounded-xl border border-red-400/50 px-4 py-2 text-sm text-red-400">Delete my account…</button>
      ) : (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (typed === CONFIRM_WORD) void remove() }}>
          <label className="space-y-1 text-sm">
            <span className="block text-muted">Type {CONFIRM_WORD} to confirm</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus className="glass rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-red-400" />
          </label>
          <button disabled={typed !== CONFIRM_WORD || busy} className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Deleting…' : 'Delete everything'}</button>
          <button type="button" onClick={() => { setOpen(false); setTyped('') }} disabled={busy} className="glass rounded-xl px-4 py-2 text-sm">Cancel</button>
        </form>
      )}
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
    </section>
  )
}
