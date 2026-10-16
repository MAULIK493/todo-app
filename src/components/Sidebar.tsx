import { Database, Home, LogOut, PanelLeftClose, PanelLeftOpen, Sparkles, Trophy, type LucideIcon } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { RewardHud } from '@/features/rewards/RewardHud'
import { WorkspaceList } from '@/features/workspaces/WorkspaceList'
import { cn } from '@/lib/cn'

type Props = {
  collapsed: boolean
  /** Phones show the sidebar as a drawer, where collapsing makes no sense. */
  showCollapse: boolean
  onToggleCollapse: () => void
  assistantOpen: boolean
  onToggleAssistant: () => void
  onSignOut: () => void
}

const row = 'flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors hover:bg-white/10'
const railRow = 'grid size-10 place-items-center rounded-xl transition-colors hover:bg-white/10'

function LinkItem({ to, icon: Icon, label, collapsed, end }: { to: string; icon: LucideIcon; label: string; collapsed: boolean; end?: boolean }) {
  return (
    <NavLink
      to={to} end={end} title={collapsed ? label : undefined} aria-label={collapsed ? label : undefined}
      className={({ isActive }) => cn(collapsed ? railRow : row, isActive && 'bg-white/10 font-medium text-accent')}
    >
      <Icon size={18} aria-hidden />
      {!collapsed && <span className="truncate">{label}</span>}
    </NavLink>
  )
}

function ActionItem({ icon: Icon, label, collapsed, onClick, pressed, hint }: { icon: LucideIcon; label: string; collapsed: boolean; onClick: () => void; pressed?: boolean; hint?: string }) {
  return (
    <button
      onClick={onClick} aria-pressed={pressed} title={collapsed ? label : hint} aria-label={collapsed ? label : undefined}
      className={cn(collapsed ? railRow : row + ' w-full text-left', pressed && 'bg-white/10 text-accent')}
    >
      <Icon size={18} aria-hidden />
      {!collapsed && <><span className="flex-1 truncate">{label}</span>{hint && <kbd className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-muted">{hint}</kbd>}</>}
    </button>
  )
}

/** The whole left panel: brand, rewards, main places, workspaces (scrolls), and settings pinned at the bottom. */
export function Sidebar({ collapsed, showCollapse, onToggleCollapse, assistantOpen, onToggleAssistant, onSignOut }: Props) {
  const align = collapsed ? 'items-center' : ''
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-4', align)}>
      <div className={cn('flex items-center', collapsed ? 'flex-col gap-3' : 'justify-between')}>
        <div className="flex items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-2 text-sm font-bold text-white" aria-hidden>✓</span>
          {!collapsed && <span className="gradient-text text-lg font-bold">Todo App</span>}
        </div>
        {showCollapse && (
          <button aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggleCollapse} className="rounded-lg p-2 text-muted hover:bg-white/10 hover:text-text">
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        )}
      </div>

      <RewardHud compact={collapsed} />

      <nav aria-label="Main" className={cn('flex flex-col gap-1', align)}>
        <LinkItem to="/" end icon={Home} label="Home" collapsed={collapsed} />
        <ActionItem icon={Sparkles} label="Assistant" hint="Ctrl J" pressed={assistantOpen} onClick={onToggleAssistant} collapsed={collapsed} />
        <LinkItem to="/rewards" icon={Trophy} label="Rewards" collapsed={collapsed} />
      </nav>

      <div className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden', collapsed && 'w-full')}>
        <WorkspaceList collapsed={collapsed} />
      </div>

      <nav aria-label="Settings" className={cn('flex flex-col gap-1 border-t border-border pt-3', align)}>
        <LinkItem to="/data" icon={Database} label="Your data" collapsed={collapsed} />
        <ActionItem icon={LogOut} label="Sign out" onClick={onSignOut} collapsed={collapsed} />
      </nav>
    </div>
  )
}
