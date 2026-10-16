import { useEffect } from 'react'
import { queryClient } from '@/lib/queryClient'
import { useAuth } from '@/stores/auth'
import { useToasts } from '@/stores/toasts'
import { getSync, outbox } from './sync'

const REFRESH = ['todos', 'subtasks', 'rewards', 'tags']

/** Starts syncing queued offline changes while someone is signed in. */
export function useOfflineSync() {
  const userId = useAuth((s) => s.session?.user.id ?? null)

  useEffect(() => {
    if (!userId) return
    const push = useToasts.getState().push
    const sync = getSync({
      userId: () => useAuth.getState().session?.user.id ?? null,
      onResult: (r) => {
        if (r.applied > 0) for (const key of REFRESH) void queryClient.invalidateQueries({ queryKey: [key] })
        if (r.applied > 0 && r.dropped.length === 0) push(`${r.applied} offline change${r.applied === 1 ? '' : 's'} synced`)
        for (const d of r.dropped) {
          const what = d.op.kind === 'create_todo' ? 'adding a todo' : d.op.done ? 'completing a todo' : 'reopening a todo'
          push(`A change made offline (${what}) couldn’t be applied, so it was dropped.`)
        }
      },
    })
    void outbox.purgeOthers(userId) // changes queued by someone else on this device are not ours to send
    return sync.start()
  }, [userId])
}
