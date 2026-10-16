// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Todo } from './types'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), from: vi.fn() }, isSupabaseConfigured: true }))
vi.mock('@/features/security/vault', () => ({ cipherFor: () => null, isPrivateWorkspace: () => false }))

const { useTodoMutations } = await import('./api')

const row = (id: string): Todo => ({
  id, workspace_id: 'w', parent_id: null, title: id, description: '', status: 'open', priority: 0, due_at: null, reminder_at: null,
  recurrence: null, tags: [], position: 1, completed_at: null, created_at: '2026-10-01T00:00:00Z',
})

let qc: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
const ids = () => (qc.getQueryData<InfiniteData<Todo[]>>(['todos', 'w', 'all', ''])?.pages.flat() ?? []).map((t) => t.id)

beforeEach(() => {
  vi.useFakeTimers()
  rpc.mockReset()
  rpc.mockResolvedValue({ error: null })
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  qc.setQueryData(['todos', 'w', 'all', ''], { pages: [[row('a'), row('b')]], pageParams: [null] })
})
afterEach(() => vi.useRealTimers())

describe('completing a todo', () => {
  it('without an animation, the row leaves at once', async () => {
    const { result } = renderHook(() => useTodoMutations(), { wrapper })
    await act(async () => { result.current.toggle.mutate({ id: 'a', done: true }) })
    expect(rpc).toHaveBeenCalledWith('complete_todo', { p_id: 'a' })
    expect(ids()).toEqual(['b'])
  })

  it('with an animation, the server hears about it immediately but the row stays until the animation is over', async () => {
    const { result } = renderHook(() => useTodoMutations(), { wrapper })
    await act(async () => { result.current.toggle.mutate({ id: 'a', done: true, delayMs: 500 }) })
    expect(rpc).toHaveBeenCalledWith('complete_todo', { p_id: 'a' }) // never waits on the animation
    expect(ids()).toEqual(['a', 'b'])
    await act(async () => { await vi.advanceTimersByTimeAsync(499) })
    expect(ids()).toEqual(['a', 'b'])
    await act(async () => { await vi.advanceTimersByTimeAsync(2) })
    expect(ids()).toEqual(['b'])
  })

  it('reopening is never delayed', async () => {
    const { result } = renderHook(() => useTodoMutations(), { wrapper })
    await act(async () => { result.current.toggle.mutate({ id: 'b', done: false }) })
    expect(rpc).toHaveBeenCalledWith('reopen_todo', { p_id: 'b' })
    expect(ids()).toEqual(['a'])
  })
})
