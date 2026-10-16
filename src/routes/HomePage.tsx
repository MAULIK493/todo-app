import { motion } from 'motion/react'
import { useWorkspaces } from '@/features/workspaces/api'
import { WorkspaceOverview } from '@/features/workspaces/WorkspaceOverview'
import { fadeUp } from '@/lib/motion'

// Landing route: every workspace as a folder, or an invitation to create the first one.
export function HomePage() {
  const { data: workspaces, isLoading } = useWorkspaces()
  if (isLoading) return null

  if (!workspaces?.length) {
    return (
      <motion.section variants={fadeUp} initial="hidden" animate="show" className="glass rounded-2xl p-6 sm:p-8">
        <h1 className="gradient-text text-3xl font-bold">Welcome</h1>
        <p className="mt-2 text-muted">Create your first workspace from the menu to get started.</p>
      </motion.section>
    )
  }

  return (
    <motion.section variants={fadeUp} initial="hidden" animate="show">
      <h1 className="gradient-text text-2xl font-bold sm:text-3xl">Your workspaces</h1>
      <p className="mt-1 text-sm text-muted">Hover a folder to peek inside, click to open it, then pick a todo to jump in.</p>
      <WorkspaceOverview workspaces={workspaces} />
    </motion.section>
  )
}
