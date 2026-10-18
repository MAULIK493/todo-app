import { Menu, Sparkles } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useLocation, useOutlet } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { PageTransition } from '@/components/fx/PageTransition'
import { routeKey } from '@/components/fx/logic'
import { useSpotlight } from '@/components/fx/useSpotlight'
import { FloatingMic } from '@/features/voice/FloatingMic'
import { useAssistant } from '@/features/assistant/store'
import { CelebrationHost } from '@/features/rewards/CelebrationHost'
import { FlyerHost } from '@/features/rewards/flyers'
import { RewardWatcher } from '@/features/rewards/RewardWatcher'
import { useAutoLock } from '@/features/security/autoLock'
import { clearAiKey } from '@/features/assistant/llm/config'
import { useVault } from '@/features/security/vault'
import { Sidebar } from '@/components/Sidebar'
import { cn } from '@/lib/cn'
import { trackPointer } from '@/lib/pointer'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useUi } from '@/stores/ui'
import { supabase } from '@/lib/supabase'
import { OfflineBanner } from '@/features/offline/OfflineBanner'
import { persister } from '@/features/offline/persist'
import { useOfflineStatus } from '@/features/offline/status'
import { outbox, syncNow } from '@/features/offline/sync'
import { useOfflineSync } from '@/features/offline/useOfflineSync'
import { useReminders } from '@/features/todos/reminders'
import { useEnvWatcher } from '@/features/appearance/useEnvWatcher'

const AssistantPanel = lazy(() => import('@/features/assistant/AssistantPanel').then((m) => ({ default: m.AssistantPanel })))

export function AppShell() {
  useAutoLock()
  useEnvWatcher()
  useSpotlight()
  const outlet = useOutlet()
  // The sidebar can shrink to a slim rail on larger screens; on phones it is always the full top panel.
  const desktop = useMediaQuery('(min-width: 768px)')
  const collapsed = useUi((s) => s.sidebarCollapsed) && desktop
  const toggleSidebar = useUi((s) => s.toggleSidebar)
  const location = useLocation()
  // Phones get a slide-out menu instead of a sidebar stacked above the page; it closes when you go somewhere.
  const [navOpen, setNavOpen] = useState(false)
  const [navPath, setNavPath] = useState(location.pathname)
  if (navPath !== location.pathname) { setNavPath(location.pathname); setNavOpen(false) }
  const drawer = !desktop
  useEffect(() => trackPointer(), [])
  useOfflineSync()
  useReminders()
  const pending = useOfflineStatus((s) => s.pending)

  const signOut = async () => {
    if (pending > 0 && !window.confirm(`${pending} change${pending === 1 ? ' hasn’t' : 's haven’t'} synced yet. Signing out will discard ${pending === 1 ? 'it' : 'them'}. Sign out anyway?`)) return
    useVault.getState().lockAll()
    clearAiKey()
    // Nothing of this person's may stay on the device: not the queue, and not the saved copy of their lists.
    await Promise.allSettled([outbox.clear(), persister.removeClient()])
    void supabase.auth.signOut()
  }
  const assistantOpen = useAssistant((s) => s.open)
  const setAssistantOpen = useAssistant((s) => s.setOpen)

  // Ctrl/Cmd + J opens and closes the assistant from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setAssistantOpen(!useAssistant.getState().open)
      }
      // Ctrl/Cmd + Shift + Space: open the assistant and start (or stop) listening.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'Space') {
        e.preventDefault()
        useAssistant.getState().requestVoice()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setAssistantOpen])

  return (
    <div className="flex h-full flex-col md:flex-row">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface-solid focus:px-3 focus:py-2">Skip to content</a>
      {drawer && (
        <header className="glass m-2 mb-0 flex items-center gap-2 rounded-2xl px-2 py-1.5">
          <button aria-label="Open menu" aria-expanded={navOpen} onClick={() => setNavOpen(true)} className="grid size-10 place-items-center rounded-lg hover:bg-white/10"><Menu size={20} /></button>
          <Link to="/" className="gradient-text flex-1 text-lg font-bold">Todo App</Link>
          <button aria-label="Assistant" aria-pressed={assistantOpen} onClick={() => setAssistantOpen(!assistantOpen)} className={`grid size-10 place-items-center rounded-lg hover:bg-white/10 ${assistantOpen ? 'bg-white/10 text-accent' : ''}`}><Sparkles size={20} /></button>
        </header>
      )}
      {drawer && navOpen && <div className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm" onClick={() => setNavOpen(false)} aria-hidden="true" />}
      <motion.aside aria-label="Workspaces and tools"
        initial={false} animate={drawer ? { x: navOpen ? 0 : '-110%' } : { x: 0, opacity: 1 }}
        inert={drawer && !navOpen}
        className={cn('glass flex shrink-0 flex-col rounded-2xl p-4 transition-[width,padding] duration-300', drawer ? 'fixed inset-y-2 left-2 z-40 w-[min(20rem,85vw)] bg-surface-solid' : 'm-2', collapsed ? 'md:w-[4.5rem] md:px-2' : 'md:w-64')}
      >
        <Sidebar
          collapsed={collapsed} showCollapse={!drawer} onToggleCollapse={toggleSidebar}
          assistantOpen={assistantOpen} onToggleAssistant={() => setAssistantOpen(!assistantOpen)}
          onSignOut={() => void signOut()}
        />
      </motion.aside>
      <RewardWatcher />
      <FlyerHost />
      <CelebrationHost />
      <main id="main" tabIndex={-1} className="min-h-0 outline-none p-3 sm:p-4 min-w-0 flex-1 overflow-auto">
        <OfflineBanner onSyncNow={() => void syncNow()} />
        <ErrorBoundary scope="page" resetKey={location.pathname}>
          <PageTransition routeKey={routeKey(location.pathname)}>{outlet}</PageTransition>
        </ErrorBoundary>
      </main>
      <AnimatePresence>{assistantOpen && <Suspense fallback={null}><AssistantPanel /></Suspense>}</AnimatePresence>
      <FloatingMic />
    </div>
  )
}
