import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceLock, decryptJson, decryptText, isEncrypted, isEncryptedJson } from './crypto'
import type { NoteRow, PendingBatch, TodoRow } from './api'

// finishLock/finishUnlock call Supabase; the engine is exercised with fakes instead.
vi.mock('./api', () => ({
  applyBatch: vi.fn(), pendingBatch: vi.fn(), pendingCounts: vi.fn(),
  finishLock: vi.fn(async () => {}), finishUnlock: vi.fn(async () => {}),
}))
const api = await import('./api')
const { encryptWorkspaceContent, decryptWorkspaceContent, ConversionError, MAX_PRIVATE_NOTE_CHARS } = await import('./convert')

const WS = '11111111-1111-1111-1111-111111111111'
const doc = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

type Note = NoteRow & { content_text: string }

/** In-memory stand-in for the database side of the batch API. */
function fakeServer(todos: TodoRow[], notes: Note[]) {
  const isEncTodo = (t: TodoRow) => t.title.startsWith('enc:v1:') || t.description.startsWith('enc:v1:')
  const plainTodo = (t: TodoRow) => !t.title.startsWith('enc:v1:') || (t.description !== '' && !t.description.startsWith('enc:v1:'))
  const isEncNote = (n: Note) => n.title.startsWith('enc:v1:') || isEncryptedJson(n.content)
  const plainNote = (n: Note) => !n.title.startsWith('enc:v1:') || !isEncryptedJson(n.content) || n.content_text !== ''
  const rows = () => ({ todos, notes })

  const deps = {
    pendingCounts: async () => ({
      plain_todos: todos.filter(plainTodo).length, plain_notes: notes.filter(plainNote).length,
      enc_todos: todos.filter(isEncTodo).length, enc_notes: notes.filter(isEncNote).length,
    }),
    pendingBatch: async (kind: 'encryption' | 'decryption', _ws: string, limit: number): Promise<PendingBatch> => {
      const wantTodo = kind === 'encryption' ? plainTodo : isEncTodo
      const wantNote = kind === 'encryption' ? plainNote : isEncNote
      return {
        todos: todos.filter(wantTodo).slice(0, limit).map(({ id, title, description }) => ({ id, title, description })),
        notes: notes.filter(wantNote).slice(0, 20).map(({ id, title, content }) => ({ id, title, content })),
      }
    },
    applyBatch: vi.fn(async (_ws: string, t: TodoRow[], n: Note[]) => {
      for (const u of t) Object.assign(todos.find((x) => x.id === u.id)!, u)
      for (const u of n) Object.assign(notes.find((x) => x.id === u.id)!, u)
      return { todos: t.length, notes: n.length }
    }),
  }
  return { deps, rows }
}

beforeEach(() => vi.clearAllMocks())

describe('workspace conversion', () => {
  it('encrypts every field, leaves nothing readable, and reports progress', async () => {
    const { key } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, iterations: 1000 })
    const todos: TodoRow[] = Array.from({ length: 250 }, (_, i) => ({ id: `t${i}`, title: `secret title ${i}`, description: i % 2 ? `detail ${i}` : '' }))
    const notes: Note[] = [
      { id: 'n1', title: 'Diary', content: doc('dear diary'), content_text: 'dear diary' },
      { id: 'n2', title: '', content: doc('untitled'), content_text: 'untitled' },
    ]
    const server = fakeServer(todos, notes)
    const progress = vi.fn()

    await encryptWorkspaceContent(WS, key, progress, server.deps)

    expect(JSON.stringify(server.rows())).not.toMatch(/secret title|detail \d|Diary|dear diary|untitled/)
    expect(todos.every((t) => isEncrypted(t.title) && (t.description === '' || isEncrypted(t.description)))).toBe(true)
    expect(notes.every((n) => isEncrypted(n.title) && isEncryptedJson(n.content) && n.content_text === '')).toBe(true)
    expect(progress).toHaveBeenLastCalledWith(252, 252)
    expect(api.finishLock).toHaveBeenCalledWith(WS)
    // and it is the real data, recoverable with the key
    expect(await decryptText(key, WS, 'title', todos[7].title)).toBe('secret title 7')
    expect(await decryptJson(key, WS, 'content', notes[0].content as never)).toEqual(doc('dear diary'))
  })

  it('resumes: already-encrypted rows are left alone and not re-encrypted', async () => {
    const { key } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, iterations: 1000 })
    const todos: TodoRow[] = [{ id: 'a', title: 'one', description: '' }, { id: 'b', title: 'two', description: '' }]
    const server = fakeServer(todos, [])
    await encryptWorkspaceContent(WS, key, undefined, server.deps)
    const firstPass = todos.map((t) => t.title)
    server.deps.applyBatch.mockClear()
    await encryptWorkspaceContent(WS, key, undefined, server.deps) // nothing left to do
    expect(server.deps.applyBatch).not.toHaveBeenCalled()
    expect(todos.map((t) => t.title)).toEqual(firstPass)
  })

  it('round-trips through decryption back to the original plaintext', async () => {
    const { key } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, iterations: 1000 })
    const todos: TodoRow[] = [{ id: 'a', title: 'plan the heist', description: 'bring snacks' }]
    const notes: Note[] = [{ id: 'n', title: 'Notes', content: doc('hello world'), content_text: 'hello world' }]
    const server = fakeServer(todos, notes)
    await encryptWorkspaceContent(WS, key, undefined, server.deps)
    await decryptWorkspaceContent(WS, key, undefined, server.deps)

    expect(todos[0]).toMatchObject({ title: 'plan the heist', description: 'bring snacks' })
    expect(notes[0]).toMatchObject({ title: 'Notes', content: doc('hello world'), content_text: 'hello world' })
    expect(api.finishUnlock).toHaveBeenCalledWith(WS)
  })

  it('refuses to finish a decryption it cannot complete, leaving the lock in place', async () => {
    const a = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, iterations: 1000 })
    const b = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, iterations: 1000 })
    const todos: TodoRow[] = [{ id: 'a', title: 'private', description: '' }]
    const server = fakeServer(todos, [])
    await encryptWorkspaceContent(WS, a.key, undefined, server.deps)
    await expect(decryptWorkspaceContent(WS, b.key, undefined, server.deps)).rejects.toBeInstanceOf(ConversionError)
    expect(api.finishUnlock).not.toHaveBeenCalled()
    expect(isEncrypted(todos[0].title)).toBe(true) // untouched
  })

  it('stops instead of looping forever when the server applies nothing', async () => {
    const { key } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, iterations: 1000 })
    const server = fakeServer([{ id: 'a', title: 'x', description: '' }], [])
    server.deps.applyBatch.mockResolvedValue({ todos: 0, notes: 0 })
    await expect(encryptWorkspaceContent(WS, key, undefined, server.deps)).rejects.toBeInstanceOf(ConversionError)
    expect(api.finishLock).not.toHaveBeenCalled()
  })

  it('rejects notes too large for the encrypted envelope', async () => {
    const { key } = await createWorkspaceLock({ type: 'pin', secret: '482915', withRecovery: false, iterations: 1000 })
    const huge = doc('x'.repeat(MAX_PRIVATE_NOTE_CHARS + 10))
    const server = fakeServer([], [{ id: 'n', title: 't', content: huge, content_text: 'x' }])
    await expect(encryptWorkspaceContent(WS, key, undefined, server.deps)).rejects.toThrow(/too large/)
  })
})
