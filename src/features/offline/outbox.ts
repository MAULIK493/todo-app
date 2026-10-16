import type { KV } from './kv'

// Changes made without a connection wait here and are applied, in order, when the connection returns.
// Only two kinds of change are queued: adding a todo and completing/reopening one. Both are safe to repeat:
// a new todo carries its own id (a second attempt is recognised as already done), and completing is idempotent.

export type NewTodoOp = {
  id: string
  workspace_id: string
  parent_id: string | null
  /** For a private workspace these are already encrypted: the queue never holds readable private text. */
  title: string
  description: string
  priority: number
  due_at: string | null
  recurrence: string | null
  position: number
  tags: string[]
}
export type OutboxOp = { kind: 'create_todo'; todo: NewTodoOp } | { kind: 'set_done'; id: string; done: boolean }

export type Entry = { key: string; userId: string; op: OutboxOp; queuedAt: number; attempts: number }

const STORE = 'outbox'

export type FailureKind = 'network' | 'auth' | 'duplicate' | 'permanent'

/** Decides what a failed attempt means: try again later, or give up on this change. */
export function classifyError(e: unknown): FailureKind {
  const err = e as { status?: number; code?: string; message?: string; name?: string } | null
  const msg = (err?.message ?? String(e)).toLowerCase()
  if (err?.code === '23505') return 'duplicate' // the todo is already there: an earlier attempt got through
  if (err?.status === 401 || err?.code === 'PGRST301' || /jwt (expired|invalid)|invalid jwt/.test(msg)) return 'auth'
  if (err?.name === 'TypeError' || /failed to fetch|networkerror|load failed|network request failed|fetch failed|timeout|offline/.test(msg)) return 'network'
  if (err?.status === 0 || err?.status === 429 || (err?.status !== undefined && err.status >= 500)) return 'network'
  return 'permanent'
}

export type Dropped = { op: OutboxOp; reason: string }
export type FlushResult = { applied: number; dropped: Dropped[]; stopped: 'network' | 'auth' | null; remaining: number }

let counter = 0

export class Outbox {
  private kv: KV
  private flushing: Promise<FlushResult> | null = null
  constructor(kv: KV) { this.kv = kv }

  /** Keys sort by time, so the queue replays in the order things happened. */
  async add(userId: string, op: OutboxOp, now = Date.now()): Promise<Entry> {
    const entry: Entry = { key: `${String(now).padStart(15, '0')}-${String(++counter).padStart(6, '0')}`, userId, op, queuedAt: now, attempts: 0 }
    await this.kv.set(STORE, entry.key, entry)
    return entry
  }

  async list(userId: string): Promise<Entry[]> {
    return (await this.kv.entries<Entry>(STORE)).map(([, e]) => e).filter((e) => e.userId === userId)
  }

  async size(userId: string) { return (await this.list(userId)).length }

  /** Another person signing in on this device must never see or send someone else's queued changes. */
  async purgeOthers(userId: string) {
    for (const [key, e] of await this.kv.entries<Entry>(STORE)) if (e.userId !== userId) await this.kv.delete(STORE, key)
  }

  async clear() { await this.kv.clear(STORE) }

  /**
   * Applies queued changes one at a time. A lost connection stops the run and keeps everything for next time; a change
   * that can never succeed (deleted workspace, no permission) is dropped and reported so the queue can't get stuck.
   * Two calls at once share one run.
   */
  flush(userId: string, apply: (op: OutboxOp) => Promise<void>, onApplied?: (e: Entry) => void): Promise<FlushResult> {
    if (this.flushing) return this.flushing
    this.flushing = this.run(userId, apply, onApplied).finally(() => { this.flushing = null })
    return this.flushing
  }

  private async run(userId: string, apply: (op: OutboxOp) => Promise<void>, onApplied?: (e: Entry) => void): Promise<FlushResult> {
    const result: FlushResult = { applied: 0, dropped: [], stopped: null, remaining: 0 }
    for (const entry of await this.list(userId)) {
      try {
        await apply(entry.op)
        await this.kv.delete(STORE, entry.key)
        result.applied++
        onApplied?.(entry)
      } catch (e) {
        const kind = classifyError(e)
        if (kind === 'duplicate') {
          await this.kv.delete(STORE, entry.key)
          result.applied++
        } else if (kind === 'network' || kind === 'auth') {
          await this.kv.set(STORE, entry.key, { ...entry, attempts: entry.attempts + 1 })
          result.stopped = kind
          break
        } else {
          await this.kv.delete(STORE, entry.key)
          result.dropped.push({ op: entry.op, reason: e instanceof Error ? e.message : 'rejected' })
        }
      }
    }
    result.remaining = await this.size(userId)
    return result
  }
}
