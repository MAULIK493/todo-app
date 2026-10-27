import { Check, Lock, LockOpen, MoreHorizontal, Pencil, Plus, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion, Reorder } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { useVault } from '@/features/security/vault'
import { useEffectFlags } from '@/features/appearance/store'
import { cn } from '@/lib/cn'
import { spring } from '@/lib/motion'
import {
  useCreateWorkspace, useDeleteWorkspace, useReorderWorkspaces, useUpdateWorkspace, useWorkspaces,
} from './api'
import { WORKSPACE_COLORS, WORKSPACE_SUGGESTIONS, type Workspace } from './types'

export function WorkspaceList({ collapsed = false }: { collapsed?: boolean }) {
  const { data: workspaces = [], isLoading, error } = useWorkspaces()
  const reorder = useReorderWorkspaces()
  const create = useCreateWorkspace()
  const navigate = useNavigate()
  const [adding, setAdding] = useState(false)

  const add = (name: string, color: string) =>
    create.mutate({ name, color, position: workspaces.length }, { onSuccess: () => setAdding(false) })

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>
  if (error) return <p className="text-sm text-red-400" role="alert">Could not load workspaces.</p>

  if (collapsed) {
    return (
      <nav aria-label="Workspaces" className="flex flex-col items-center gap-2">
        {workspaces.map((w) => <CollapsedWorkspace key={w.id} workspace={w} />)}
      </nav>
    )
  }

  return (
    <nav aria-label="Workspaces" className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted">
        <span>Workspaces</span>
        <button aria-label="New workspace" title="New workspace" onClick={() => setAdding(true)} className="grid size-7 place-items-center rounded-lg hover:bg-white/10">
          <Plus size={16} />
        </button>
      </div>

      {workspaces.length === 0 && !adding && (
        <div className="space-y-2">
          <p className="text-sm text-muted">Start with a workspace for each area of your life.</p>
          <div className="flex flex-wrap gap-2">
            {WORKSPACE_SUGGESTIONS.map((s, i) => (
              <motion.button
                key={s} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                onClick={() => add(s, WORKSPACE_COLORS[i])}
                className="glass rounded-full px-3 py-1 text-sm"
              >
                + {s}
              </motion.button>
            ))}
          </div>
        </div>
      )}

      <Reorder.Group axis="y" values={workspaces} onReorder={(o) => reorder.mutate(o)} className="flex flex-col gap-2">
        {workspaces.map((w) => (
          <WorkspaceRow key={w.id} workspace={w} onDeleted={() => navigate('/')} />
        ))}
      </Reorder.Group>

      <AnimatePresence>
        {adding && <NewWorkspaceForm onSubmit={add} onCancel={() => setAdding(false)} busy={create.isPending} />}
      </AnimatePresence>
      {create.error && <p className="text-sm text-red-400" role="alert">{create.error.message}</p>}
    </nav>
  )
}

function WorkspaceRow({ workspace: w, onDeleted }: { workspace: Workspace; onDeleted: () => void }) {
  const { workspaceId } = useParams()
  const update = useUpdateWorkspace()
  const remove = useDeleteWorkspace()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(w.name)
  const [confirming, setConfirming] = useState(false)
  const isPrivate = w.lock_state !== 'none'
  const flags = useEffectFlags()
  const active = workspaceId === w.id
  const unlocked = useVault((s) => !!s.keys[w.id])

  const save = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== w.name) update.mutate({ id: w.id, name: trimmed })
    setEditing(false)
  }

  return (
    <Reorder.Item value={w} layout transition={spring} whileDrag={{ scale: 1.03, boxShadow: '0 8px 30px rgba(0,0,0,.3)' }}>
      <div className={cn('group relative flex items-center gap-2.5 rounded-xl border border-transparent px-3 py-2 hover:bg-white/5', active && !flags.springs && 'bg-white/10')}>
        {/* One highlight that slides between workspaces instead of blinking on and off. */}
        {active && flags.springs && <motion.span layoutId="ws-active" className="absolute inset-0 -z-10 rounded-lg bg-white/10" transition={spring} aria-hidden />}
        <span className="size-3 shrink-0 rounded-full" style={{ background: w.color }} aria-hidden />
        {isPrivate && (
          <span className="shrink-0 text-muted" role="img" aria-label={unlocked ? 'Private, unlocked' : 'Private, locked'}>
            {unlocked ? <LockOpen size={13} /> : <Lock size={13} />}
          </span>
        )}
        {editing ? (
          <input
            autoFocus value={name} maxLength={60} aria-label="Workspace name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
            onBlur={save}
            className="min-w-0 flex-1 bg-transparent outline-none ring-1 ring-accent rounded px-1"
          />
        ) : (
          <NavLink to={`/w/${w.id}`} className="min-w-0 flex-1 truncate py-1.5">{w.name}</NavLink>
        )}
        {confirming ? (
          <span className="flex gap-1">
            <button aria-label={`Confirm delete ${w.name}`} className="rounded p-1 text-red-400 hover:bg-white/10"
              onClick={() => remove.mutate(w.id, { onSuccess: () => workspaceId === w.id && onDeleted() })}>
              <Check size={14} />
            </button>
            <button aria-label="Cancel delete" className="rounded p-1 hover:bg-white/10" onClick={() => setConfirming(false)}>
              <X size={14} />
            </button>
          </span>
        ) : (
          <RowMenu name={w.name} canLock={isPrivate && unlocked}
            onLock={() => useVault.getState().lock(w.id)}
            onRename={() => { setName(w.name); setEditing(true) }}
            onDelete={() => setConfirming(true)} />
        )}
      </div>
      {confirming && <p className="px-2 text-xs text-red-400">Delete this workspace and everything in it?</p>}
    </Reorder.Item>
  )
}

/** Always-visible "more" button (hover-only icons do not exist on a phone) with the row's actions. */
function RowMenu(props: { name: string; canLock: boolean; onLock: () => void; onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc) }
  }, [open])
  const item = 'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10'
  const pick = (fn: () => void) => () => { setOpen(false); fn() }
  return (
    <div ref={box} className="relative shrink-0">
      <button aria-label={`Options for ${props.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className="grid size-8 place-items-center rounded-lg text-muted opacity-70 hover:bg-white/10 hover:text-text hover:opacity-100 focus-visible:opacity-100">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu" className="glass absolute right-0 top-full z-30 mt-1 w-44 rounded-xl bg-surface-solid p-1 shadow-xl">
          <button role="menuitem" className={item} onClick={pick(props.onRename)}><Pencil size={14} /> Rename</button>
          {props.canLock && <button role="menuitem" className={item} onClick={pick(props.onLock)}><Lock size={14} /> Lock now</button>}
          <button role="menuitem" className={item + ' text-red-400'} onClick={pick(props.onDelete)}><Trash2 size={14} /> Delete…</button>
        </div>
      )}
    </div>
  )
}

function NewWorkspaceForm(props: { onSubmit: (name: string, color: string) => void; onCancel: () => void; busy: boolean }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(WORKSPACE_COLORS[0])

  return (
    <motion.form
      initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
      onSubmit={(e) => { e.preventDefault(); if (name.trim()) props.onSubmit(name.trim(), color) }}
      className="glass space-y-2 overflow-hidden rounded-lg p-2"
    >
      <input
        autoFocus value={name} maxLength={60} placeholder="Workspace name" aria-label="Workspace name"
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}
        className="w-full bg-transparent px-1 outline-none"
      />
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colour">
        {WORKSPACE_COLORS.map((c) => (
          <button
            key={c} type="button" role="radio" aria-checked={c === color} aria-label={c}
            onClick={() => setColor(c)}
            className={cn('size-5 rounded-full transition-transform', c === color && 'scale-125 ring-2 ring-white')}
            style={{ background: c }}
          />
        ))}
      </div>
      <p className="px-1 text-xs text-muted">
        Stored readable on our server. For sensitive notes, make the workspace private afterwards (encrypted on your device).
      </p>
      <div className="flex justify-end gap-2 text-sm">
        <button type="button" onClick={props.onCancel} className="px-2 text-muted">Cancel</button>
        <button disabled={!name.trim() || props.busy} className="rounded bg-accent px-3 py-1 text-white disabled:opacity-50">Create</button>
      </div>
    </motion.form>
  )
}

/** A workspace in the slim sidebar: its colour dot, with the name on hover/focus and a small lock when private. */
function CollapsedWorkspace({ workspace: w }: { workspace: Workspace }) {
  const unlocked = useVault((s) => !!s.keys[w.id])
  const isPrivate = w.lock_state !== 'none'
  return (
    <NavLink
      to={`/w/${w.id}`} title={w.name} aria-label={`${w.name}${isPrivate ? (unlocked ? ' (private, unlocked)' : ' (private, locked)') : ''}`}
      className={({ isActive }) => cn('relative grid size-10 place-items-center rounded-xl hover:bg-white/10', isActive && 'bg-white/10 ring-1 ring-accent')}
    >
      <span className="size-4 rounded-full" style={{ background: w.color }} aria-hidden />
      {isPrivate && <span className="absolute -bottom-0.5 -right-0.5 text-muted">{unlocked ? <LockOpen size={11} /> : <Lock size={11} />}</span>}
    </NavLink>
  )
}
