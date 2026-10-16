import { useQueryClient } from '@tanstack/react-query'
import { AnimatePresence } from 'motion/react'
import { useState } from 'react'
import { Modal } from '@/components/Modal'
import type { Workspace } from '@/features/workspaces/types'
import { lockParamsOf } from '@/features/workspaces/types'
import { startUnlock } from './api'
import { ChangeCodeForm } from './ChangeCodeForm'
import { verifySecret } from './crypto'
import { IDLE_CHOICES, readAutoLock, writeAutoLock } from './autoLock'
import { SecretInput } from './SecretInput'
import { LOCK_NOUN } from './secrets'
import { useVault } from './vault'

type View = 'main' | 'code' | 'recovery-key' | 'remove'

const btn = 'glass w-full rounded-xl px-4 py-2 text-left text-sm hover:bg-white/10'

export function ManageLockDialog({ workspace, onClose }: { workspace: Workspace; onClose: () => void }) {
  const qc = useQueryClient()
  const params = lockParamsOf(workspace)!
  const [view, setView] = useState<View>('main')
  const [settings, setSettings] = useState(readAutoLock)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(0)

  const update = (next: Partial<typeof settings>) => {
    const merged = { ...settings, ...next }
    setSettings(merged)
    writeAutoLock(merged)
  }

  const lockNow = () => {
    useVault.getState().lock(workspace.id)
    onClose()
  }

  const remove = async (secret: string) => {
    setBusy(true)
    setError(null)
    if (!(await verifySecret(params, secret))) {
      setBusy(false)
      setError('That is not your current code.')
      setShake((n) => n + 1)
      return
    }
    try {
      await startUnlock(workspace.id)
      await qc.invalidateQueries({ queryKey: ['workspaces'] })
      onClose() // the workspace page now shows the decryption progress
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the lock')
      setBusy(false)
    }
  }

  const titles: Record<View, string> = {
    main: 'Privacy settings', code: 'Change code', 'recovery-key': 'New recovery key', remove: 'Remove the lock',
  }

  return (
    <AnimatePresence>
      <Modal title={titles[view]} onClose={onClose} dismissible={!busy}>
        {view === 'main' && (
          <div className="space-y-5">
            <p className="text-sm text-muted">
              “{workspace.name}” is private and protected with a {LOCK_NOUN[params.lock_type]}.{' '}
              {params.recovery_wrapped_key ? 'A recovery key is set.' : 'No recovery key is set.'}
            </p>

            <section className="space-y-2" aria-label="Auto-lock">
              <h3 className="text-sm font-medium">Auto-lock on this device</h3>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted">Lock after being idle for</span>
                <select
                  value={settings.idleMinutes} onChange={(e) => update({ idleMinutes: Number(e.target.value) })}
                  className="glass rounded-lg px-2 py-1 outline-none"
                >
                  {IDLE_CHOICES.map((m) => <option key={m} value={m} className="text-black">{m === 0 ? 'Never' : `${m} minute${m === 1 ? '' : 's'}`}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={settings.lockOnHide} onChange={(e) => update({ lockOnHide: e.target.checked })} />
                <span className="text-muted">Lock when I leave this tab for a while</span>
              </label>
              <p className="text-xs text-muted">Reloading the page or signing out always locks private workspaces.</p>
            </section>

            <div className="space-y-2">
              <button className={btn} onClick={lockNow}>Lock now</button>
              <button className={btn} onClick={() => setView('code')}>Change code…</button>
              <button className={btn} onClick={() => setView('recovery-key')}>Create a new recovery key…</button>
              <button className={`${btn} text-red-400`} onClick={() => setView('remove')}>Remove the lock…</button>
            </div>
          </div>
        )}

        {view === 'code' && <ChangeCodeForm workspace={workspace} purpose="code" onDone={() => setView('main')} />}
        {view === 'recovery-key' && <ChangeCodeForm workspace={workspace} purpose="recovery-key" onDone={() => setView('main')} />}

        {view === 'remove' && (
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Everything in this workspace will be decrypted and stored as normal, readable data again, and the code and recovery key
              will stop mattering. Enter your code to confirm.
            </p>
            <SecretInput type={params.lock_type} onSubmit={remove} disabled={busy} shakeKey={shake} submitLabel="Remove lock" autoFocus />
            {error && <p className="text-center text-sm text-red-400" role="alert">{error}</p>}
          </div>
        )}

        {view !== 'main' && !busy && (
          <button onClick={() => { setView('main'); setError(null) }} className="mt-4 w-full text-sm text-muted">Back</button>
        )}
      </Modal>
    </AnimatePresence>
  )
}
