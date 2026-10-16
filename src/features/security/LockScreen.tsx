import { Lock } from 'lucide-react'
import { motion } from 'motion/react'
import type { Workspace } from '@/features/workspaces/types'
import { UnlockForm } from './UnlockForm'

export function LockScreen({ workspace }: { workspace: Workspace }) {
  return (
    <div className="grid flex-1 place-items-center py-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        className="glass w-full max-w-sm space-y-5 rounded-3xl p-8 text-center"
      >
        <motion.div
          animate={{ boxShadow: [`0 0 0 0 ${workspace.color}55`, `0 0 0 18px ${workspace.color}00`] }}
          transition={{ repeat: Infinity, duration: 2.2 }}
          className="mx-auto grid size-16 place-items-center rounded-full text-white" style={{ background: workspace.color }}
        >
          <Lock size={28} />
        </motion.div>
        <div>
          <h1 className="text-xl font-bold">{workspace.name}</h1>
          <p className="text-sm text-muted">This workspace is private and locked.</p>
        </div>
        <UnlockForm workspace={workspace} />
      </motion.div>
    </div>
  )
}
