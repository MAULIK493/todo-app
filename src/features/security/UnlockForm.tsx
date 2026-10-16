import { useEffect, useState } from 'react'
import type { Workspace } from '@/features/workspaces/types'
import { lockParamsOf } from '@/features/workspaces/types'
import { unlockWithRecoveryKey, unlockWithSecret, WrongCodeError } from './crypto'
import { useRecoveryPrompt } from './recoveryPrompt'
import { SecretInput } from './SecretInput'
import { clearAttempts, formatWait, LOCK_NOUN, msRemaining, readAttempts, recordFailure } from './secrets'
import { useVault } from './vault'

/** Asks for the workspace code (with throttling) or, if the user set one up, the recovery key. */
export function UnlockForm({ workspace }: { workspace: Workspace }) {
  const params = lockParamsOf(workspace)
  const [attempts, setAttempts] = useState(() => readAttempts(workspace.id))
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)
  const [recovering, setRecovering] = useState(false)
  const [recoveryText, setRecoveryText] = useState('')

  const remaining = msRemaining(attempts, now)
  const blocked = remaining > 0

  useEffect(() => {
    if (!blocked) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [blocked])

  if (!params) return <p className="text-sm text-red-400" role="alert">This workspace's lock details are missing.</p>

  const fail = () => {
    const next = recordFailure(workspace.id)
    setAttempts(next)
    setNow(Date.now())
    setShake((n) => n + 1)
    const wait = msRemaining(next)
    setError(wait > 0 ? `Incorrect code. Too many attempts: try again in ${formatWait(wait)}.` : `Incorrect ${LOCK_NOUN[params.lock_type]}. ${3 - next.failures} tries left before a short wait.`)
  }

  const submit = async (secret: string) => {
    if (blocked || busy) return
    setBusy(true)
    setError(null)
    try {
      const key = await unlockWithSecret(params, secret)
      clearAttempts(workspace.id)
      useVault.getState().unlock(workspace.id, key)
    } catch (e) {
      if (e instanceof WrongCodeError) fail()
      else setError('Could not unlock: your browser blocked the cryptography needed.')
    } finally {
      setBusy(false)
    }
  }

  const submitRecovery = async () => {
    setBusy(true)
    setError(null)
    try {
      const key = await unlockWithRecoveryKey(params, recoveryText)
      clearAttempts(workspace.id)
      useVault.getState().unlock(workspace.id, key)
      useRecoveryPrompt.getState().set({ workspaceId: workspace.id, recoveryKey: recoveryText })
    } catch {
      setError('That recovery key does not match this workspace.')
    } finally {
      setBusy(false)
    }
  }

  if (recovering) {
    return (
      <form className="mx-auto w-full max-w-xs space-y-3" onSubmit={(e) => { e.preventDefault(); void submitRecovery() }}>
        <label className="block space-y-1 text-sm">
          <span className="text-muted">Recovery key</span>
          <input
            value={recoveryText} onChange={(e) => setRecoveryText(e.target.value)} autoFocus autoComplete="off" spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-…" className="glass w-full rounded-xl px-3 py-2 font-mono uppercase outline-none focus:ring-2 focus:ring-accent"
          />
        </label>
        <button disabled={busy || !recoveryText.trim()} className="w-full rounded-xl bg-accent py-2 font-medium text-white disabled:opacity-50">{busy ? 'Checking…' : 'Unlock with recovery key'}</button>
        <button type="button" onClick={() => { setRecovering(false); setError(null) }} className="w-full text-sm text-muted">Back to {LOCK_NOUN[params.lock_type]}</button>
        {error && <p className="text-center text-sm text-red-400" role="alert">{error}</p>}
      </form>
    )
  }

  return (
    <div className="space-y-3">
      <SecretInput type={params.lock_type} onSubmit={submit} disabled={busy || blocked} shakeKey={shake} autoFocus />
      {blocked && <p className="text-center text-sm text-amber-400" role="status">Locked for {formatWait(remaining)} after too many attempts.</p>}
      {error && !blocked && <p className="text-center text-sm text-red-400" role="alert">{error}</p>}
      {busy && <p className="text-center text-xs text-muted" role="status">Checking…</p>}
      {params.recovery_wrapped_key && (
        <button type="button" onClick={() => { setRecovering(true); setError(null) }} className="mx-auto block text-sm text-muted underline">Forgot your code?</button>
      )}
    </div>
  )
}
