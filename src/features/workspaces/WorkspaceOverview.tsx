import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import GlassFolder, { type ArtPreset, type FolderFile } from '@/components/ui/glass-folder-cards'
import { supabase } from '@/lib/supabase'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { isPrivateState, type Workspace } from './types'

const ARTS: ArtPreset[] = ['aurora', 'ember', 'dusk', 'verdant', 'glacier']
const PREVIEW = 4

type Preview = { id: string; title: string; due_at: string | null }

/** The first few open todos of an ordinary workspace. Private workspaces are never read from here. */
function usePreview(workspace: Workspace) {
  return useQuery({
    queryKey: ['todos', workspace.id, 'preview'],
    enabled: !isPrivateState(workspace.lock_state),
    queryFn: async (): Promise<Preview[]> => {
      const { data, error } = await supabase
        .from('todos').select('id, title, due_at')
        .eq('workspace_id', workspace.id).is('parent_id', null).neq('status', 'done')
        .order('position').limit(PREVIEW)
      if (error) throw error
      return data
    },
  })
}

const dueLabel = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : undefined)

function FolderCard({ workspace, index }: { workspace: Workspace; index: number }) {
  const navigate = useNavigate()
  const roomy = useMediaQuery('(min-width: 480px)')
  const priv = isPrivateState(workspace.lock_state)
  const { data, isLoading } = usePreview(workspace)
  const width = roomy ? 300 : 250
  const height = ((272 + 54) * width) / 340

  // The folder reads its files once, so wait for them rather than showing an empty folder that fills in later.
  if (!priv && isLoading) return <div className="shimmer rounded-3xl" style={{ width, height: height - 54 }} aria-hidden="true" />

  const files: FolderFile[] = (data ?? []).map((t) => ({ name: t.title, meta: dueLabel(t.due_at) }))
  const open = `/w/${workspace.id}`
  const meta = priv ? 'Private' : files.length === 0 ? 'Nothing open' : files.length >= PREVIEW ? `${PREVIEW}+ open` : `${files.length} open`

  return (
    <div className="flex flex-col items-center gap-4">
      <GlassFolder
        label={workspace.name} meta={meta} files={files}
        tone="dark" art={ARTS[index % ARTS.length]} seed={index * 7 + 3}
        action="more" width={width} appearDelay={index * 90}
        menu={[{ label: 'Open workspace', onSelect: () => navigate(open) }, ...(priv ? [] : [{ label: 'Notes', onSelect: () => navigate(`${open}/notes`) }])]}
        onFileSelect={() => navigate(open)}
      />
      <Link to={open} className="rounded-lg px-3 py-1 text-sm font-medium hover:bg-white/10" style={{ color: workspace.color }}>
        Open {workspace.name} →
      </Link>
    </div>
  )
}

export function WorkspaceOverview({ workspaces }: { workspaces: Workspace[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] justify-items-center gap-x-12 gap-y-20 pb-8 pt-10">
      {workspaces.map((w, i) => <FolderCard key={w.id} workspace={w} index={i} />)}
    </div>
  )
}
