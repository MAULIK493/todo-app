import { onlineManager } from '@tanstack/react-query'
import { applyOp } from './executor'
import { createKV, type KV } from './kv'
import { Outbox, type FlushResult, type OutboxOp } from './outbox'
import { useOfflineStatus, type OfflineStatus } from './status'

type Deps = {
  outbox: Outbox
  apply: (op: OutboxOp) => Promise<void>
  isOnline: () => boolean
  userId: () => string | null
  /** Told after every run, e.g. to refresh lists and mention changes that had to be dropped. */
  onResult: (r: FlushResult) => void
  setStatus: (s: Partial<OfflineStatus>) => void
  retryEveryMs?: number
}

/** Decides when queued changes are sent: right away if online, then whenever the connection, tab or timer says so. */
export class SyncController {
  private d: Deps
  constructor(deps: Deps) { this.d = deps }

  async enqueue(op: OutboxOp): Promise<void> {
    const user = this.d.userId()
    if (!user) throw new Error('Please sign in again.')
    await this.d.outbox.add(user, op)
    await this.refreshPending()
    if (this.d.isOnline()) void this.flush()
  }

  async refreshPending() {
    const user = this.d.userId()
    this.d.setStatus({ pending: user ? await this.d.outbox.size(user) : 0 })
  }

  async flush(): Promise<FlushResult | null> {
    const user = this.d.userId()
    if (!user || !this.d.isOnline()) return null
    this.d.setStatus({ syncing: true })
    try {
      const result = await this.d.outbox.flush(user, this.d.apply)
      this.d.setStatus({ pending: result.remaining, needsSignIn: result.stopped === 'auth' })
      this.d.onResult(result)
      return result
    } finally {
      this.d.setStatus({ syncing: false })
    }
  }

  /** Starts listening. Returns a function that stops. */
  start(win: Pick<Window, 'addEventListener' | 'removeEventListener'> & { document?: Document } = window): () => void {
    const trigger = () => void this.flush().catch(() => undefined)
    const online = () => { this.d.setStatus({ online: true }); trigger() }
    const offline = () => this.d.setStatus({ online: false })
    const visible = () => { if (document.visibilityState === 'visible') trigger() }
    win.addEventListener('online', online)
    win.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', visible)
    // While changes are waiting, try again now and then: the browser's "online" signal is not always reliable.
    const timer = setInterval(() => { if (useOfflineStatus.getState().pending > 0) trigger() }, this.d.retryEveryMs ?? 30_000)
    void this.refreshPending().then(trigger)
    return () => {
      win.removeEventListener('online', online)
      win.removeEventListener('offline', offline)
      document.removeEventListener('visibilitychange', visible)
      clearInterval(timer)
    }
  }
}

export const kv: KV = createKV()
export const outbox = new Outbox(kv)

let controller: SyncController | null = null

/** Created lazily so importing this file has no side effects. */
export function getSync(deps: Omit<Deps, 'outbox' | 'apply' | 'isOnline' | 'setStatus'> & Partial<Pick<Deps, 'apply' | 'isOnline' | 'setStatus'>>): SyncController {
  controller ??= new SyncController({
    outbox, apply: applyOp, isOnline: () => onlineManager.isOnline(), setStatus: (s) => useOfflineStatus.setState(s), ...deps,
  })
  return controller
}

export const resetSyncForTests = () => { controller = null }

/** Send whatever is waiting, now (the "Sync now" button). */
export const syncNow = () => controller?.flush() ?? Promise.resolve(null)

/** Used by the app to queue a change; set up by useOfflineSync() in the shell. */
export async function enqueueOffline(op: OutboxOp): Promise<void> {
  if (!controller) throw new Error('Offline support is not ready yet.')
  await controller.enqueue(op)
}
