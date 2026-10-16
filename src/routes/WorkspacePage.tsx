import { Lock, LockOpen, Settings } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { NavLink, Navigate, Outlet, useParams } from 'react-router-dom'
import { Modal } from '@/components/Modal'
import { ChangeCodeForm } from '@/features/security/ChangeCodeForm'
import { ConversionScreen } from '@/features/security/ConversionScreen'
import { LockScreen } from '@/features/security/LockScreen'
import { ManageLockDialog } from '@/features/security/ManageLockDialog'
import { useRecoveryPrompt } from '@/features/security/recoveryPrompt'
import { SetupLockDialog } from '@/features/security/SetupLockDialog'
import { useVault } from '@/features/security/vault'
import { useEffectFlags } from '@/features/appearance/store'
import { TodoPanel } from '@/features/todos/TodoPanel'
import { useWorkspaces } from '@/features/workspaces/api'
import { cn } from '@/lib/cn'

// Shared header + tabs for a workspace; the child route renders either todos or notes.
// A private workspace shows a lock screen (or conversion progress) instead until it is unlocked.
export function WorkspacePage() {
  const { workspaceId } = useParams()
  const { data: workspaces, isLoading } = useWorkspaces()
  const hasKey = useVault((s) => !!s.keys[workspaceId ?? ''])
  const recovery = useRecoveryPrompt((s) => s.prompt)
  const [dialog, setDialog] = useState<'setup' | 'manage' | null>(null)
  const flags = useEffectFlags()
  const workspace = workspaces?.find((w) => w.id === workspaceId)

  // When a private workspace goes from locked to open, its content un-blurs into view for a moment.
  const lockedNow = workspace?.lock_state === 'locked' && !hasKey
  const [wasLocked, setWasLocked] = useState(lockedNow)
  const [reveal, setReveal] = useState(false)
  if (wasLocked !== lockedNow) {
    setWasLocked(lockedNow)
    setReveal(wasLocked && !lockedNow)
  }
  useEffect(() => {
    if (!reveal) return
    const t = setTimeout(() => setReveal(false), 900)
    return () => clearTimeout(t)
  }, [reveal])

  if (isLoading) return null
  if (!workspace) return <Navigate to="/" replace />

  const state = workspace.lock_state
  const converting = state === 'encrypting' || state === 'decrypting'
  const locked = state === 'locked' && !hasKey
  const open = !converting && !locked

  const tab = ({ isActive }: { isActive: boolean }) =>
    cn('rounded-lg px-4 py-1.5 text-sm', isActive ? 'bg-accent text-white' : 'text-muted hover:text-text')
  const action = 'glass flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm hover:bg-white/10'

  return (
    <section className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold" style={{ color: workspace.color }}>{workspace.name}</h1>
        {open && (
          <nav aria-label="Workspace sections" className="glass flex rounded-xl p-1">
            <NavLink to={`/w/${workspace.id}`} end className={tab}>Todos</NavLink>
            <NavLink to={`/w/${workspace.id}/notes`} className={tab}>Notes</NavLink>
          </nav>
        )}
        {open && (
          <div className="ml-auto flex gap-2">
            {state === 'none' ? (
              <button className={action} onClick={() => setDialog('setup')}><Lock size={14} /> Make private</button>
            ) : (
              <>
                <span className="flex items-center gap-1 text-sm text-muted"><LockOpen size={14} /> Private</span>
                <button className={action} onClick={() => useVault.getState().lock(workspace.id)}><Lock size={14} /> Lock</button>
                <button className={action} onClick={() => setDialog('manage')} aria-label="Privacy settings"><Settings size={14} /></button>
              </>
            )}
          </div>
        )}
      </div>

      {converting ? <ConversionScreen workspace={workspace} /> : locked ? <LockScreen workspace={workspace} /> : (
        <motion.div
          className="flex min-h-0 flex-1 flex-col" data-testid="workspace-content"
          initial={reveal && flags.springs ? { filter: 'blur(14px)', opacity: 0.3, scale: 0.985 } : false}
          animate={{ filter: 'blur(0px)', opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <Outlet context={workspace} />
        </motion.div>
      )}

      <AnimatePresence>
        {dialog === 'setup' && <SetupLockDialog workspace={workspace} onClose={() => setDialog(null)} />}
        {dialog === 'manage' && <ManageLockDialog workspace={workspace} onClose={() => setDialog(null)} />}
        {recovery?.workspaceId === workspace.id && hasKey && state === 'locked' && (
          <Modal title="Set a new code" onClose={() => useRecoveryPrompt.getState().set(null)}>
            <p className="mb-4 text-sm text-muted">You got in with your recovery key. Choose a new code now so you can unlock normally next time.</p>
            <ChangeCodeForm workspace={workspace} purpose="code" known={{ recoveryKey: recovery.recoveryKey }} onDone={() => useRecoveryPrompt.getState().set(null)} />
          </Modal>
        )}
      </AnimatePresence>
    </section>
  )
}

export function TodosTab() {
  const { workspaceId } = useParams()
  // key resets list state (search, open details) when switching workspaces
  return <TodoPanel key={workspaceId} workspaceId={workspaceId!} />
}
