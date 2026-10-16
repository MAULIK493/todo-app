// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { createKV, IndexedDbKV, MemoryKV, type KV } from './kv'
import { classifyError, Outbox, type OutboxOp } from './outbox'

const create = (id: string, over: Partial<Extract<OutboxOp, { kind: 'create_todo' }>['todo']> = {}): OutboxOp => ({
  kind: 'create_todo', todo: { id, workspace_id: 'w', parent_id: null, title: `Todo ${id}`, description: '', priority: 0, due_at: null, recurrence: null, position: -1, tags: [], ...over },
})
const done = (id: string, d = true): OutboxOp => ({ kind: 'set_done', id, done: d })

for (const [name, make] of [['memory', () => new MemoryKV()], ['IndexedDB', () => new IndexedDbKV(indexedDB)]] as [string, () => KV][]) {
  describe(`${name} store`, () => {
    it('stores, reads back, orders by key, and deletes', async () => {
      const kv = make()
      await kv.set('cache', 'b', { n: 2 }); await kv.set('cache', 'a', { n: 1 }); await kv.set('cache', 'c', [3])
      expect(await kv.get('cache', 'a')).toEqual({ n: 1 })
      expect(await kv.get('cache', 'missing')).toBeUndefined()
      expect((await kv.entries('cache')).map(([k]) => k)).toEqual(['a', 'b', 'c'])
      await kv.delete('cache', 'b')
      expect((await kv.entries('cache')).map(([k]) => k)).toEqual(['a', 'c'])
      await kv.clear('cache')
      expect(await kv.entries('cache')).toEqual([])
    })
    it('keeps stores separate and does not share objects with callers', async () => {
      const kv = make()
      const value = { x: [1] }
      await kv.set('outbox', 'k', value)
      value.x.push(2)
      expect(await kv.get('outbox', 'k')).toEqual({ x: [1] })
      expect(await kv.get('cache', 'k')).toBeUndefined()
    })
  })
}

describe('createKV', () => {
  it('works, and falls back to memory when IndexedDB fails', async () => {
    const kv = createKV()
    await kv.set('cache', 'k', 1)
    expect(await kv.get('cache', 'k')).toBe(1)

    const real = indexedDB.open.bind(indexedDB)
    indexedDB.open = (() => { throw new Error('blocked') }) as never
    try {
      const fallback = createKV()
      await fallback.set('cache', 'k', 2)
      expect(await fallback.get('cache', 'k')).toBe(2)
    } finally { indexedDB.open = real }
  })
})

describe('classifyError', () => {
  it('tells "try later" from "never going to work"', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('network')
    expect(classifyError(new Error('NetworkError when attempting to fetch resource'))).toBe('network')
    expect(classifyError({ status: 503, message: 'x' })).toBe('network')
    expect(classifyError({ status: 429, message: 'x' })).toBe('network')
    expect(classifyError({ status: 0, message: 'x' })).toBe('network')
    expect(classifyError({ code: '23505', message: 'duplicate key' })).toBe('duplicate')
    expect(classifyError({ status: 401, message: 'x' })).toBe('auth')
    expect(classifyError({ message: 'JWT expired' })).toBe('auth')
    expect(classifyError({ code: '42501', message: 'new row violates row-level security policy' })).toBe('permanent')
    expect(classifyError({ code: '23503', message: 'violates foreign key constraint' })).toBe('permanent')
    expect(classifyError(new Error('something odd'))).toBe('permanent')
  })
})

describe('Outbox', () => {
  const newBox = () => new Outbox(new MemoryKV())

  it('replays changes in the order they were made', async () => {
    const box = newBox()
    await box.add('u1', create('a'), 1000); await box.add('u1', done('a'), 1000); await box.add('u1', create('b'), 999) // same millisecond, and one older
    const seen: string[] = []
    await box.flush('u1', async (op) => { seen.push(op.kind === 'create_todo' ? `create ${op.todo.id}` : `done ${op.id}`) })
    expect(seen).toEqual(['create b', 'create a', 'done a'])
    expect(await box.size('u1')).toBe(0)
  })

  it('stops on a lost connection, keeps everything, and carries on later', async () => {
    const box = newBox()
    for (const id of ['a', 'b', 'c']) await box.add('u1', create(id))
    let calls = 0
    const r1 = await box.flush('u1', async () => { if (++calls === 2) throw new TypeError('Failed to fetch') })
    expect(r1).toMatchObject({ applied: 1, stopped: 'network', remaining: 2, dropped: [] })
    expect((await box.list('u1'))[0].attempts).toBe(1)
    const seen: string[] = []
    const r2 = await box.flush('u1', async (op) => { if (op.kind === 'create_todo') seen.push(op.todo.id) })
    expect(seen).toEqual(['b', 'c'])
    expect(r2).toMatchObject({ applied: 2, stopped: null, remaining: 0 })
  })

  it('drops a change that can never work, reports it, and still applies the rest', async () => {
    const box = newBox()
    await box.add('u1', create('gone', { workspace_id: 'deleted-ws' })); await box.add('u1', create('ok'))
    const r = await box.flush('u1', async (op) => { if (op.kind === 'create_todo' && op.todo.workspace_id === 'deleted-ws') throw Object.assign(new Error('violates foreign key constraint'), { code: '23503' }) })
    expect(r.applied).toBe(1)
    expect(r.dropped).toHaveLength(1)
    expect(r.dropped[0].reason).toMatch(/foreign key/)
    expect(r.remaining).toBe(0)
  })

  it('treats "already exists" as success, so a retried create is harmless', async () => {
    const box = newBox()
    await box.add('u1', create('a'))
    const r = await box.flush('u1', async () => { throw Object.assign(new Error('duplicate key value'), { code: '23505' }) })
    expect(r).toMatchObject({ applied: 1, dropped: [], remaining: 0 })
  })

  it('pauses (and keeps the queue) when the sign-in has expired', async () => {
    const box = newBox()
    await box.add('u1', done('a'))
    const r = await box.flush('u1', async () => { throw Object.assign(new Error('JWT expired'), { status: 401 }) })
    expect(r).toMatchObject({ stopped: 'auth', remaining: 1 })
  })

  it('never mixes users: others\' changes are invisible and can be purged', async () => {
    const box = newBox()
    await box.add('u1', create('mine')); await box.add('u2', create('theirs'))
    const applied: string[] = []
    await box.flush('u1', async (op) => { if (op.kind === 'create_todo') applied.push(op.todo.id) })
    expect(applied).toEqual(['mine'])
    expect(await box.size('u2')).toBe(1)
    await box.purgeOthers('u1')
    expect(await box.size('u2')).toBe(0)
  })

  it('two simultaneous flushes run once, so nothing is sent twice', async () => {
    const box = newBox()
    for (const id of ['a', 'b']) await box.add('u1', create(id))
    const apply = vi.fn(async () => { await new Promise((r) => setTimeout(r, 5)) })
    const [r1, r2] = await Promise.all([box.flush('u1', apply), box.flush('u1', apply)])
    expect(apply).toHaveBeenCalledTimes(2)
    expect(r1).toBe(r2)
  })

  it('survives a reload: queued changes are still there for a new Outbox on the same store', async () => {
    const kv = new IndexedDbKV(indexedDB)
    await new Outbox(kv).add('u1', create('persisted'))
    expect(await new Outbox(new IndexedDbKV(indexedDB)).size('u1')).toBeGreaterThanOrEqual(1)
  })
})
