import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { useFolderMutations, useFolders } from './api'
import type { FolderFilter } from './types'

type Props = { workspaceId: string; value: FolderFilter; onChange: (v: FolderFilter) => void }

const chip = 'whitespace-nowrap rounded-full px-3 py-1 text-sm'

export function FolderBar({ workspaceId, value, onChange }: Props) {
  const { data: folders = [] } = useFolders(workspaceId)
  const { create, rename, remove } = useFolderMutations(workspaceId)
  const [mode, setMode] = useState<'idle' | 'adding' | 'renaming' | 'deleting'>('idle')
  const [name, setName] = useState('')

  const current = folders.find((f) => f.id === value)
  const reset = () => { setMode('idle'); setName('') }

  const submit = () => {
    const n = name.trim()
    if (!n) return reset()
    if (mode === 'adding') create.mutate({ name: n, position: folders.length }, { onSuccess: reset })
    else if (mode === 'renaming' && current) rename.mutate({ id: current.id, name: n }, { onSuccess: reset })
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Folders">
        {([['all', 'All'], ['none', 'Unfiled']] as const).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={value === id} onClick={() => onChange(id)} className={cn(chip, value === id ? 'bg-accent text-white' : 'glass')}>
            {label}
          </button>
        ))}
        {folders.map((f) => (
          <button key={f.id} role="tab" aria-selected={value === f.id} onClick={() => onChange(f.id)} className={cn(chip, value === f.id ? 'bg-accent text-white' : 'glass')}>
            {f.name}
          </button>
        ))}
        <button aria-label="New folder" onClick={() => { setName(''); setMode('adding') }} className="glass rounded-full p-1.5"><Plus size={14} /></button>
      </div>

      {(mode === 'adding' || mode === 'renaming') && (
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); submit() }}>
          <input
            autoFocus value={name} maxLength={60} aria-label="Folder name" placeholder="Folder name"
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && reset()}
            className="glass min-w-0 flex-1 rounded-lg px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-accent"
          />
          <button aria-label="Save folder" className="rounded p-1 hover:bg-white/10"><Check size={14} /></button>
          <button type="button" aria-label="Cancel" onClick={reset} className="rounded p-1 hover:bg-white/10"><X size={14} /></button>
        </form>
      )}
      {(create.error || rename.error || remove.error) && (
        <p className="text-xs text-red-400" role="alert">{(create.error ?? rename.error ?? remove.error)!.message}</p>
      )}

      {current && mode === 'idle' && (
        <div className="flex items-center gap-1 text-xs text-muted">
          <span className="flex-1 truncate">Folder: {current.name}</span>
          <button aria-label={`Rename ${current.name}`} className="rounded p-1 hover:bg-white/10" onClick={() => { setName(current.name); setMode('renaming') }}><Pencil size={13} /></button>
          <button aria-label={`Delete ${current.name}`} className="rounded p-1 hover:bg-white/10" onClick={() => setMode('deleting')}><Trash2 size={13} /></button>
        </div>
      )}
      {current && mode === 'deleting' && (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <span className="flex-1">Delete folder? Its notes stay, as unfiled.</span>
          <button aria-label={`Confirm delete ${current.name}`} className="rounded p-1 hover:bg-white/10" onClick={() => remove.mutate(current.id, { onSuccess: () => { onChange('all'); reset() } })}><Check size={14} /></button>
          <button aria-label="Cancel delete" className="rounded p-1 hover:bg-white/10" onClick={reset}><X size={14} /></button>
        </div>
      )}
    </div>
  )
}
