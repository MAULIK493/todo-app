// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConflictError } from './api'
import { useAutosave } from './useAutosave'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useAutosave', () => {
  it('merges rapid edits into one save after the debounce', async () => {
    const save = vi.fn().mockResolvedValue('t1')
    const { result } = renderHook(() => useAutosave('t0', save))

    act(() => { result.current.queue({ title: 'A' }); result.current.queue({ content_text: 'hello' }) })
    expect(result.current.status).toBe('dirty')
    expect(save).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(800) })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({ expectedUpdatedAt: 't0', patch: { title: 'A', content_text: 'hello' }, tags: undefined })
    expect(result.current.status).toBe('saved')
  })

  it('uses the updated_at returned by the previous save', async () => {
    const save = vi.fn().mockResolvedValueOnce('t1').mockResolvedValueOnce('t2')
    const { result } = renderHook(() => useAutosave('t0', save))

    act(() => result.current.queue({ title: 'one' }, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    act(() => result.current.queue({ title: 'two' }, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(save.mock.calls.map((c) => c[0].expectedUpdatedAt)).toEqual(['t0', 't1'])
  })

  it('stops saving after a conflict so the other version is not overwritten', async () => {
    const save = vi.fn().mockRejectedValue(new ConflictError())
    const { result } = renderHook(() => useAutosave('t0', save))

    act(() => result.current.queue({ title: 'mine' }, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('conflict')

    act(() => result.current.queue({ title: 'more' }, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('keeps edits and retries after a transient failure', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('t1')
    const { result } = renderHook(() => useAutosave('t0', save))

    act(() => result.current.queue({ title: 'keep me' }, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('error')

    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1][0].patch).toEqual({ title: 'keep me' })
    expect(result.current.status).toBe('saved')
  })

  it('flushes pending edits on unmount', async () => {
    const save = vi.fn().mockResolvedValue('t1')
    const { result, unmount } = renderHook(() => useAutosave('t0', save))
    act(() => result.current.queue({ title: 'bye' }))
    unmount()
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(1)
  })
})
