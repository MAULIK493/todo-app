import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import { useState } from 'react'
import { Modal } from '@/components/Modal'
import type { Workspace } from '@/features/workspaces/types'
import { startLock } from './api'
import { CreateCode } from './CreateCode'
import { createWorkspaceLock, type LockType } from './crypto'
import { RecoveryKeyPanel } from './RecoveryKeyPanel'
import { LOCK_LABELS, STRENGTH_NOTE } from './secrets'
import { useVault } from './vault'

type Lock = Awaited<ReturnType<typeof createWorkspaceLock>>
type Step = 'intro' | 'code' | 'recovery' | 'show-key'

export function SetupLockDialog({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>('intro')
  const [type, setType] = useState<LockType>('pin')
  const [secret, setSecret] = useState('')
  const [withRecovery, setWithRecovery] = useState(true)
  const [ack, setAck] = useState(false)
  const [lock, setLock] = useState<Lock | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Tell the server to start encrypting. From here the work is resumable, so the dialog can close.
  const begin = async (l: Lock) => {
    setBusy(true)
    setError(null)
    try {
      await startLock(workspace.id, l.params)
      await qc.invalidateQueries({ queryKey: ['workspaces'] })
      useVault.getState().unlock(workspace.id, l.key)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start encryption')
      setBusy(false)
    }
  }

  const derive = async () => {
    setBusy(true)
    setError(null)
    try {
      const l = await createWorkspaceLock({ type, secret, withRecovery })
      setLock(l)
      if (l.recoveryKey) { setStep('show-key'); setBusy(false) } else await begin(l)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the lock')
      setBusy(false)
    }
  }

  return (
    <AnimatePresence>
      <Modal title={`Make “${workspace.name}” private`} onClose={onClose} dismissible={!busy && step !== 'show-key'}>
        {step === 'intro' && (
          <div className="space-y-4">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
              <li>Todos and notes in this workspace are <b className="text-text">encrypted in your browser</b> before they are saved. The server only ever stores scrambled text.</li>
              <li>You unlock it with a code that is <b className="text-text">never sent anywhere</b>. If you forget it and have no recovery key, nobody, including us, can get your data back.</li>
              <li>Private workspaces have no tags or note folders, and search only looks at titles in notes.</li>
              <li>Existing tags and folders here will be removed. Older copies of content may linger in backups, so the safest time to do this is before adding sensitive things.</li>
            </ul>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">How do you want to unlock it?</legend>
              {(Object.keys(LOCK_LABELS) as LockType[]).map((t) => (
                <label key={t} className={`glass block cursor-pointer rounded-xl p-3 text-sm ${type === t ? 'ring-2 ring-accent' : ''}`}>
                  <input type="radio" name="lock-type" className="sr-only" checked={type === t} onChange={() => setType(t)} />
                  <span className="font-medium">{LOCK_LABELS[t]}</span>
                  <span className="mt-0.5 block text-xs text-muted">{STRENGTH_NOTE[t]}</span>
                </label>
              ))}
            </fieldset>
            <button onClick={() => setStep('code')} className="w-full rounded-xl bg-accent py-2 font-medium text-white">Continue</button>
          </div>
        )}

        {step === 'code' && (
          <CreateCode type={type} onChosen={(s) => { setSecret(s); setStep('recovery') }} />
        )}

        {step === 'recovery' && (
          <div className="space-y-4">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" checked={withRecovery} onChange={(e) => setWithRecovery(e.target.checked)} className="mt-1" />
              <span><b>Create a recovery key</b> (recommended). A long key you keep somewhere safe that can open the workspace if you forget your code.</span>
            </label>
            {!withRecovery && (
              <label className="flex items-start gap-2 text-sm text-amber-400">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-1" />
                <span>I understand that if I forget my code, this workspace can never be opened again.</span>
              </label>
            )}
            <button
              onClick={() => void derive()} disabled={busy || (!withRecovery && !ack)}
              className="w-full rounded-xl bg-accent py-2 font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Securing…' : withRecovery ? 'Create recovery key' : 'Encrypt workspace'}
            </button>
          </div>
        )}

        {step === 'show-key' && lock?.recoveryKey && (
          <RecoveryKeyPanel recoveryKey={lock.recoveryKey} workspaceName={workspace.name} confirmLabel={busy ? 'Starting…' : 'Encrypt workspace'} onConfirmed={() => void begin(lock)} />
        )}

        {error && <p className="mt-3 text-sm text-red-400" role="alert">{error}</p>}
      </Modal>
    </AnimatePresence>
  )
}
