import { ShieldCheck } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Workspace } from '@/features/workspaces/types'
import { startUnlock } from './api'
import { runConversion, useConversion } from './conversionStore'
import { UnlockForm } from './UnlockForm'
import { useVault } from './vault'

/**
 * Shown while a workspace is being encrypted or decrypted. If the browser was closed part-way, the server
 * still knows what is left, so entering the code resumes where it stopped.
 */
export function ConversionScreen({ workspace }: { workspace: Workspace }) {
  const qc = useQueryClient()
  const key = useVault((s) => s.keys[workspace.id])
  const status = useConversion((s) => s[workspace.id])
  const direction = workspace.lock_state === 'decrypting' ? 'decrypt' : 'encrypt'
  const [retry, setRetry] = useState(0)
  const [undoError, setUndoError] = useState<string | null>(null)

  useEffect(() => {
    if (key) void runConversion(workspace.id, key, direction)
  }, [key, direction, retry, workspace.id])

  const undo = async () => {
    setUndoError(null)
    try {
      await startUnlock(workspace.id)
      await qc.invalidateQueries({ queryKey: ['workspaces'] })
    } catch (e) {
      setUndoError(e instanceof Error ? e.message : 'Could not undo')
    }
  }

  const pct = status && status.total > 0 ? Math.round((status.done / status.total) * 100) : 0
  const verb = direction === 'encrypt' ? 'Encrypting' : 'Removing the lock from'

  return (
    <div className="grid flex-1 place-items-center py-6">
      <div className="glass w-full max-w-sm space-y-5 rounded-3xl p-8 text-center">
        <motion.div animate={{ rotate: [0, 8, -8, 0] }} transition={{ repeat: Infinity, duration: 2 }} className="mx-auto grid size-16 place-items-center rounded-full bg-accent text-white">
          <ShieldCheck size={28} />
        </motion.div>
        <h1 className="text-xl font-bold">{verb} “{workspace.name}”</h1>

        {!key ? (
          <>
            <p className="text-sm text-muted">This was interrupted. Enter your code to continue where it left off.</p>
            <UnlockForm workspace={workspace} />
          </>
        ) : status?.error ? (
          <>
            <p className="text-sm text-red-400" role="alert">{status.error}</p>
            <button onClick={() => setRetry((n) => n + 1)} className="w-full rounded-xl bg-accent py-2 font-medium text-white">Try again</button>
          </>
        ) : (
          <div className="space-y-2" role="status" aria-live="polite">
            <div className="h-2.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Conversion progress">
              <motion.div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2" animate={{ width: `${pct}%` }} />
            </div>
            <p className="text-sm text-muted">{status && status.total > 0 ? `${status.done} of ${status.total} items` : 'Preparing…'}</p>
            <p className="text-xs text-muted">Keep this tab open until it finishes.</p>
          </div>
        )}

        {key && direction === 'encrypt' && (
          <button onClick={undo} className="text-sm text-muted underline">Cancel and remove the lock instead</button>
        )}
        {undoError && <p className="text-sm text-red-400" role="alert">{undoError}</p>}
      </div>
    </div>
  )
}
