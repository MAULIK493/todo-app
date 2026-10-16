import { CloudOff, RefreshCw } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useOfflineStatus } from './status'

/** Tells people they're offline, what still works, and what is waiting to sync. */
export function OfflineBanner({ onSyncNow }: { onSyncNow?: () => void }) {
  const { online, pending, syncing, needsSignIn } = useOfflineStatus()
  const show = !online || pending > 0 || needsSignIn
  const waiting = `${pending} change${pending === 1 ? '' : 's'}`

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          role="status" aria-live="polite" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden"
        >
          <p className="glass mb-3 flex flex-wrap items-center gap-2 rounded-xl border-amber-400/40 px-3 py-2 text-sm">
            {!online ? <CloudOff size={16} className="shrink-0 text-amber-400" aria-hidden /> : <RefreshCw size={16} className={syncing ? 'shrink-0 animate-spin text-accent' : 'shrink-0 text-accent'} aria-hidden />}
            <span className="flex-1">
              {!online
                ? `You’re offline.${pending > 0 ? ` ${waiting} saved on this device will sync when you’re back.` : ' You can still add and complete todos; they’ll sync when you’re back.'}`
                : needsSignIn ? `${waiting} are waiting. Sign in again to sync them.`
                : syncing ? `Syncing ${waiting}…` : `${waiting} waiting to sync.`}
            </span>
            {online && !syncing && pending > 0 && !needsSignIn && onSyncNow && <button onClick={onSyncNow} className="rounded-lg px-2 py-0.5 text-accent hover:bg-white/10">Sync now</button>}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
