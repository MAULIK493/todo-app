// @vitest-environment jsdom
import { onlineManager, QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Todo } from '@/features/todos/types'
import { MemoryKV } from './kv'
import { OfflineBanner } from './OfflineBanner'
import { Outbox, type OutboxOp } from './outbox'
import { createPersister, shouldPersist, type WorkspaceStates } from './persist'
import { SyncController } from './sync'
import { useOfflineStatus, type OfflineStatus } from './status'

// ---- what may be saved to the device ----------------------------------------------------------------------------

describe('shouldPersist', () => {
  const states: WorkspaceStates = { plain: 'none', secret: 'locked', mid: 'encrypting', undoing: 'decrypting' }
  const t = (ws: string) => ({ workspace_id: ws })

  it('saves lists from ordinary workspaces', () => {
    expect(shouldPersist(['workspaces'], [], states)).toBe(true)
    expect(shouldPersist(['todos', 'plain', 'all', ''], null, states)).toBe(true)
    expect(shouldPersist(['tags', 'plain'], null, states)).toBe(true)
    expect(shouldPersist(['note-folders', 'plain'], null, states)).toBe(true)
    expect(shouldPersist(['notes', 'recent', { workspaceId: 'plain' }], null, states)).toBe(true)
    expect(shouldPersist(['note', 'n1'], t('plain'), states)).toBe(true)
    expect(shouldPersist(['subtasks', 'p1'], [t('plain')], states)).toBe(true)
    expect(shouldPersist(['rewards', 'summary'], null, states)).toBe(true)
  })

  it('never saves anything from a private workspace, in any state', () => {
    for (const ws of ['secret', 'mid', 'undoing']) {
      expect(shouldPersist(['todos', ws, 'all', ''], null, states), ws).toBe(false)
      expect(shouldPersist(['tags', ws], null, states), ws).toBe(false)
      expect(shouldPersist(['notes', 'pinned', { workspaceId: ws }], null, states), ws).toBe(false)
      expect(shouldPersist(['note', 'n'], t(ws), states), ws).toBe(false)
      expect(shouldPersist(['subtasks', 'p'], [t('plain'), t(ws)], states), ws).toBe(false) // one private row taints the lot
    }
  })

  it('leaves out anything it cannot vouch for', () => {
    expect(shouldPersist(['todos', 'not-loaded-yet', 'all', ''], null, states)).toBe(false) // unknown workspace
    expect(shouldPersist(['note', 'n'], undefined, states)).toBe(false)
    expect(shouldPersist(['note', 'n'], null, states)).toBe(false)
    expect(shouldPersist(['subtasks', 'p'], 'nope', states)).toBe(false)
    expect(shouldPersist(['notes', 'recent', null], null, states)).toBe(false)
    for (const root of ['assistant', 'background-url', 'note-todos', 'todo-notes', 'link-todo-search', 'surprise']) expect(shouldPersist([root, 'plain'], [t('plain')], states), root).toBe(false)
  })
})

describe('persister', () => {
  it('saves, restores and removes the cached client', async () => {
    const p = createPersister(new MemoryKV())
    expect(await p.restoreClient()).toBeUndefined()
    await p.persistClient({ timestamp: 1, buster: 'v1', clientState: { mutations: [], queries: [] } })
    expect((await p.restoreClient())?.buster).toBe('v1')
    await p.removeClient()
    expect(await p.restoreClient()).toBeUndefined()
  })
})

// ---- the sync controller ----------------------------------------------------------------------------------------

describe('SyncController', () => {
  const op: OutboxOp = { kind: 'set_done', id: 'a', done: true }

  function setup(over: { online?: boolean; apply?: (o: OutboxOp) => Promise<void>; user?: string | null } = {}) {
    let online = over.online ?? true
    const status: Partial<OfflineStatus> = {}
    const onResult = vi.fn()
    const apply = vi.fn(over.apply ?? (async () => undefined))
    const outbox = new Outbox(new MemoryKV())
    const c = new SyncController({
      outbox, apply, isOnline: () => online, userId: () => (over.user === undefined ? 'u1' : over.user), onResult, setStatus: (s) => Object.assign(status, s), retryEveryMs: 1000,
    })
    return { c, apply, status, onResult, outbox, setOnline: (v: boolean) => { online = v } }
  }

  it('sends straight away when online', async () => {
    const { c, apply, status } = setup()
    await c.enqueue(op)
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(status.pending).toBe(0))
  })

  it('holds changes while offline and reports how many are waiting', async () => {
    const { c, apply, status } = setup({ online: false })
    await c.enqueue(op); await c.enqueue({ ...op, id: 'b' })
    expect(apply).not.toHaveBeenCalled()
    expect(status.pending).toBe(2)
  })

  it('sends them when the connection returns, and tells the app what happened', async () => {
    const { c, apply, status, onResult, setOnline } = setup({ online: false })
    const stop = c.start(window)
    await c.enqueue(op)
    setOnline(true)
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(onResult).toHaveBeenCalled())
    expect(onResult.mock.calls.at(-1)![0]).toMatchObject({ applied: 1, remaining: 0 })
    expect(status.online).toBe(true)
    stop()
  })

  it('notes going offline', () => {
    const { c, status } = setup()
    const stop = c.start(window)
    window.dispatchEvent(new Event('offline'))
    expect(status.online).toBe(false)
    stop()
  })

  it('keeps trying on a timer while changes are waiting', async () => {
    vi.useFakeTimers()
    let failing = true
    const { c, apply } = setup({ apply: async () => { if (failing) throw new TypeError('Failed to fetch') } })
    useOfflineStatus.setState({ pending: 1 })
    const stop = c.start(window)
    await c.enqueue(op)
    await vi.advanceTimersByTimeAsync(0)
    const callsBefore = apply.mock.calls.length
    failing = false
    await vi.advanceTimersByTimeAsync(1100)
    expect(apply.mock.calls.length).toBeGreaterThan(callsBefore)
    stop()
    useOfflineStatus.setState({ pending: 0 })
    vi.useRealTimers()
  })

  it('asks the person to sign in when the session has expired', async () => {
    const { c, status } = setup({ apply: async () => { throw Object.assign(new Error('JWT expired'), { status: 401 }) } })
    await c.enqueue(op)
    await vi.waitFor(() => expect(status.needsSignIn).toBe(true))
    expect(status.pending).toBe(1)
  })

  it('does nothing without a signed-in user', async () => {
    const { c, apply } = setup({ user: null })
    expect(await c.flush()).toBeNull()
    await expect(c.enqueue(op)).rejects.toThrow(/sign in/)
    expect(apply).not.toHaveBeenCalled()
  })
})

// ---- adding and completing todos without a connection -----------------------------------------------------------

const enqueueOffline = vi.fn()
const applyOp = vi.fn()
vi.mock('./sync', async (orig) => ({ ...(await orig<typeof import('./sync')>()), enqueueOffline: (op: unknown) => enqueueOffline(op) }))
vi.mock('./executor', () => ({ applyOp: (op: unknown) => applyOp(op) }))
const cipher = { text: vi.fn(async (_f: string, t: string) => `enc:v1:${t}`) }
let activeCipher: typeof cipher | null = null
vi.mock('@/features/security/vault', () => ({ cipherFor: () => activeCipher, isPrivateWorkspace: () => !!activeCipher }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() }, isSupabaseConfigured: true }))

const { useTodoMutations } = await import('@/features/todos/api')

const row = (id: string, title = id): Todo => ({
  id, workspace_id: 'w', parent_id: null, title, description: '', status: 'open', priority: 0, due_at: null, reminder_at: null, recurrence: null, tags: [],
  position: 1, completed_at: null, created_at: '2026-10-01T00:00:00Z',
})

describe('adding and completing todos', () => {
  let qc: QueryClient
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  const titles = (view = 'all') => (qc.getQueryData<InfiniteData<Todo[]>>(['todos', 'w', view, ''])?.pages.flat() ?? []).map((t) => t.title)

  beforeEach(() => {
    enqueueOffline.mockReset().mockResolvedValue(undefined)
    applyOp.mockReset().mockResolvedValue(undefined)
    activeCipher = null
    onlineManager.setOnline(true)
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    for (const view of ['all', 'todo', 'today']) qc.setQueryData(['todos', 'w', view, ''], { pages: [[row('existing')]], pageParams: [null] })
    qc.setQueryData(['todos', 'w', 'all', 'milk'], { pages: [[]], pageParams: [null] }) // a filtered list
  })
  afterEach(() => onlineManager.setOnline(true))

  it('online: sent immediately with an id chosen by the app, and shown at once', async () => {
    const { result } = renderHook(() => useTodoMutations(), { wrapper })
    await act(async () => { await result.current.create.mutateAsync({ workspace_id: 'w', title: 'Buy milk', priority: 2 }) })
    expect(enqueueOffline).not.toHaveBeenCalled()
    const op = applyOp.mock.calls[0][0]
    expect(op).toMatchObject({ kind: 'create_todo', todo: { workspace_id: 'w', title: 'Buy milk', priority: 2, parent_id: null } })
    expect(op.todo.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(op.todo.position).toBeLessThan(0)
    expect(titles()).toEqual(['Buy milk', 'existing'])
    expect(titles('todo')).toEqual(['Buy milk', 'existing'])
    expect(titles('today')).toEqual(['existing']) // views it doesn't belong in are untouched
    expect(qc.getQueryData<InfiniteData<Todo[]>>(['todos', 'w', 'all', 'milk'])?.pages.flat()).toEqual([]) // and so are searches
  })

  it('offline: queued instead of sent, still shown, and no refresh that would fail', async () => {
    onlineManager.setOnline(false)
    const invalidate = vi.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useTodoMutations(), { wrapper })
    await act(async () => { await result.current.create.mutateAsync({ workspace_id: 'w', title: 'Offline todo', tags: ['home'] }) })
    expect(applyOp).not.toHaveBeenCalled()
    expect(enqueueOffline).toHaveBeenCalledTimes(1)
    expect(enqueueOffline.mock.calls[0][0]).toMatchObject({ kind: 'create_todo', todo: { title: 'Offline todo', tags: ['home'] } })
    expect(titles()).toContain('Offline todo')
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('a connection that drops mid-request falls back to the queue instead of losing the todo', async () => {
    applyOp.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useTodoMutations(), { wrapper })
    await act(async () => { await result.current.create.mutateAsync({ workspace_id: 'w', title: 'Flaky' }) })
    expect(enqueueOffline).toHaveBeenCalledTimes(1)
    expect(titles()).toContain('Flaky')
  })

  it('a real rejection (not a connection problem) is shown to the user, not queued', async () => {
    applyOp.mockRejectedValue({ code: '42501', message: 'new row violates row-level security policy' })
    const { result } = renderHook(() => useTodoMutations(), { wrapper })
    await act(async () => { await result.current.create.mutateAsync({ workspace_id: 'w', title: 'Nope' }).catch(() => undefined) })
    expect(enqueueOffline).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(result.current.create.error?.message).toMatch(/row-level security/))
  })

  it('private workspace: what is queued (and so stored on the device) is already encrypted, and has no tags', async () => {
    activeCipher = cipher
    onlineManager.setOnline(false)
    const { result } = renderHook(() => useTodoMutations(), { wrapper })
    await act(async () => { await result.current.create.mutateAsync({ workspace_id: 'w', title: 'secret plan', tags: ['x'] }) })
    const queued = enqueueOffline.mock.calls[0][0]
    expect(queued.todo.title).toBe('enc:v1:secret plan')
    expect(queued.todo.tags).toEqual([])
    expect(JSON.stringify(queued)).not.toContain('"secret plan"')
  })

  it('subtasks are queued too, without being shown as top-level todos', async () => {
    onlineManager.setOnline(false)
    const { result } = renderHook(() => useTodoMutations(), { wrapper })
    await act(async () => { await result.current.create.mutateAsync({ workspace_id: 'w', parent_id: 'p', title: 'Sub' }) })
    expect(enqueueOffline.mock.calls[0][0].todo.parent_id).toBe('p')
    expect(titles()).toEqual(['existing'])
  })

  it('completing offline: queued, and the row leaves the list', async () => {
    onlineManager.setOnline(false)
    const { result } = renderHook(() => useTodoMutations(), { wrapper })
    await act(async () => { await result.current.toggle.mutateAsync({ id: 'existing', done: true }) })
    expect(enqueueOffline).toHaveBeenCalledWith({ kind: 'set_done', id: 'existing', done: true })
    expect(applyOp).not.toHaveBeenCalled()
    expect(titles()).toEqual([])
  })

  it('reopening offline is queued the same way', async () => {
    onlineManager.setOnline(false)
    const { result } = renderHook(() => useTodoMutations(), { wrapper })
    await act(async () => { await result.current.toggle.mutateAsync({ id: 'x', done: false }) })
    expect(enqueueOffline).toHaveBeenCalledWith({ kind: 'set_done', id: 'x', done: false })
  })
})

// ---- the banner -------------------------------------------------------------------------------------------------

describe('OfflineBanner', () => {
  afterEach(() => { cleanup(); useOfflineStatus.setState({ online: true, pending: 0, syncing: false, needsSignIn: false }) })
  const set = (s: Partial<OfflineStatus>) => act(() => useOfflineStatus.setState(s))

  it('is invisible when everything is normal', () => {
    render(<OfflineBanner />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says what still works offline, and how many changes are waiting', () => {
    set({ online: false, pending: 0 })
    const { rerender } = render(<OfflineBanner />)
    expect(screen.getByRole('status').textContent).toMatch(/offline.*add and complete todos/)
    set({ pending: 3 })
    rerender(<OfflineBanner />)
    expect(screen.getByRole('status').textContent).toMatch(/3 changes saved on this device will sync/)
    set({ pending: 1 })
    expect(screen.getByRole('status').textContent).toMatch(/1 change saved/)
  })

  it('shows progress and offers a manual sync when back online', () => {
    const onSyncNow = vi.fn()
    set({ online: true, pending: 2, syncing: true })
    render(<OfflineBanner onSyncNow={onSyncNow} />)
    expect(screen.getByRole('status').textContent).toMatch(/Syncing 2 changes/)
    set({ syncing: false })
    screen.getByRole('button', { name: 'Sync now' }).click()
    expect(onSyncNow).toHaveBeenCalled()
  })

  it('asks for sign-in when the session expired', () => {
    set({ online: true, pending: 2, needsSignIn: true })
    render(<OfflineBanner onSyncNow={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toMatch(/Sign in again to sync them/)
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull()
  })
})
