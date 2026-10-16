import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Workspace } from '@/features/workspaces/types'
import { lockParamsOf } from '@/features/workspaces/types'
import { rewrapKey } from './api'
import { CreateCode } from './CreateCode'
import { rewrapLock, verifySecret, WrongCodeError, type LockType } from './crypto'
import { RecoveryKeyPanel } from './RecoveryKeyPanel'
import { SecretInput } from './SecretInput'
import { LOCK_LABELS, LOCK_NOUN, STRENGTH_NOTE } from './secrets'

type Props = {
  workspace: Workspace
  /** 'code' picks a new code; 'recovery-key' keeps the code and issues a fresh recovery key. */
  purpose: 'code' | 'recovery-key'
  /** Already proven (e.g. the user just got in with their recovery key), so the current code isn't asked for. */
  known?: { recoveryKey: string }
  onDone: () => void
}

type Current = { secret: string } | { recoveryKey: string }

export function ChangeCodeForm({ workspace, purpose, known, onDone }: Props) {
  const qc = useQueryClient()
  const params = lockParamsOf(workspace)!
  const [current, setCurrent] = useState<Current | null>(known ?? null)
  const [type, setType] = useState<LockType>(params.lock_type)
  const [chosen, setChosen] = useState<string | null>(null)
  const [withRecovery, setWithRecovery] = useState(true)
  const [ack, setAck] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shake, setShake] = useState(0)

  const apply = async (cur: Current, next: { type: LockType; secret: string; withRecovery: boolean }) => {
    setBusy(true)
    setError(null)
    try {
      const result = await rewrapLock(params, cur, next)
      await rewrapKey(workspace.id, result.params)
      await qc.invalidateQueries({ queryKey: ['workspaces'] })
      if (result.recoveryKey) setNewKey(result.recoveryKey)
      else onDone()
    } catch (e) {
      setError(e instanceof WrongCodeError ? 'That code is not correct.' : e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const checkCurrent = async (secret: string) => {
    setBusy(true)
    const ok = await verifySecret(params, secret)
    setBusy(false)
    if (!ok) { setError('That is not your current code.'); setShake((n) => n + 1); return }
    setError(null)
    setCurrent({ secret })
    // Issuing a new recovery key keeps the same code, so there is nothing more to choose.
    if (purpose === 'recovery-key') void apply({ secret }, { type: params.lock_type, secret, withRecovery: true })
  }

  if (newKey) {
    return <RecoveryKeyPanel recoveryKey={newKey} workspaceName={workspace.name} confirmLabel="Done" onConfirmed={onDone} />
  }

  if (!current) {
    return (
      <div className="space-y-3">
        <p className="text-center text-sm font-medium">Enter your current {LOCK_NOUN[params.lock_type]}</p>
        <SecretInput type={params.lock_type} onSubmit={checkCurrent} disabled={busy} shakeKey={shake} autoFocus />
        {error && <p className="text-center text-sm text-red-400" role="alert">{error}</p>}
      </div>
    )
  }

  if (purpose === 'recovery-key') {
    return <p className="text-center text-sm text-muted" role="status">{error ?? 'Creating a new recovery key…'}</p>
  }

  if (chosen === null) {
    return (
      <div className="space-y-4">
        <div role="radiogroup" aria-label="Code type" className="grid gap-2">
          {(Object.keys(LOCK_LABELS) as LockType[]).map((t) => (
            <label key={t} className={`glass cursor-pointer rounded-xl p-3 text-sm ${type === t ? 'ring-2 ring-accent' : ''}`}>
              <input type="radio" name="type" className="sr-only" checked={type === t} onChange={() => setType(t)} />
              <span className="font-medium">{LOCK_LABELS[t]}</span>
              <span className="mt-0.5 block text-xs text-muted">{STRENGTH_NOTE[t]}</span>
            </label>
          ))}
        </div>
        <CreateCode type={type} onChosen={setChosen} disabled={busy} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={withRecovery} onChange={(e) => setWithRecovery(e.target.checked)} className="mt-1" />
        <span>Create a new recovery key (recommended). Any previous recovery key stops working.</span>
      </label>
      {!withRecovery && (
        <label className="flex items-start gap-2 text-sm text-amber-400">
          <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
          <span>I understand that if I forget this code, the workspace can never be opened again.</span>
        </label>
      )}
      <button
        disabled={busy || (!withRecovery && !ack)} onClick={() => void apply(current, { type, secret: chosen, withRecovery })}
        className="w-full rounded-xl bg-accent py-2 font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save new code'}
      </button>
      {error && <p className="text-center text-sm text-red-400" role="alert">{error}</p>}
    </div>
  )
}
