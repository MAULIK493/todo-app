// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerEvent } from '@shared/types.ts'

// Mock the network and the browser-only helpers so the real store and components run against scripted events.
const streamChat = vi.fn()
vi.mock('./api', async () => {
  class AssistantError extends Error {
    code: string
    constructor(code: string, message: string) { super(message); this.code = code }
  }
  return { AssistantError, streamChat: (o: unknown) => streamChat(o) }
})
const gather = vi.fn<() => Promise<string | null>>()
vi.mock('./privateLoader', () => ({ gatherPrivateContext: () => gather() }))
const runConfirm = vi.fn()
const undoAction = vi.fn()
vi.mock('./actions', () => ({
  refreshAfterAssistant: vi.fn(), runConfirm: (c: unknown) => runConfirm(c), undoAction: (a: unknown) => undoAction(a),
  canUndo: (a: { kind: string }) => ['todo_created', 'todo_completed', 'note_created'].includes(a.kind),
}))

const { AssistantError } = await import('./api')
const { useAssistant } = await import('./store')
const { MessageBubble } = await import('./MessageBubble')

const script = (events: ServerEvent[]) => streamChat.mockImplementationOnce(async (o: { onEvent: (e: ServerEvent) => void }) => { events.forEach(o.onEvent) })
const reset = () => useAssistant.setState({ open: true, conversationId: null, messages: [], busy: false, notice: null, controller: null })
const done = (over: Partial<Extract<ServerEvent, { type: 'done' }>> = {}): ServerEvent => ({ type: 'done', conversationId: 'conv-1', persisted: true, usage: { input: 1, output: 1 }, ...over })

beforeEach(() => { reset(); streamChat.mockReset(); gather.mockReset(); gather.mockResolvedValue(null); runConfirm.mockReset(); undoAction.mockReset() })
afterEach(cleanup)

describe('assistant store', () => {
  it('streams a reply into the conversation and remembers the saved conversation', async () => {
    script([{ type: 'text', delta: 'You have ' }, { type: 'text', delta: '2 todos.' }, done()])
    await useAssistant.getState().send('  what is due?  ')
    const s = useAssistant.getState()
    expect(s.messages.map((m) => [m.role, m.text])).toEqual([['user', 'what is due?'], ['assistant', 'You have 2 todos.']])
    expect(s.messages[1].status).toBe('done')
    expect(s.conversationId).toBe('conv-1')
    expect(s.busy).toBe(false)
    expect(streamChat.mock.calls[0][0]).toMatchObject({ message: 'what is due?', conversationId: null, privateContext: null })
  })

  it('continues the same conversation on the next message', async () => {
    script([{ type: 'text', delta: 'a' }, done()])
    await useAssistant.getState().send('one')
    script([{ type: 'text', delta: 'b' }, done()])
    await useAssistant.getState().send('two')
    expect(streamChat.mock.calls[1][0].conversationId).toBe('conv-1')
  })

  it('ignores empty messages and sends while busy', async () => {
    await useAssistant.getState().send('   ')
    expect(streamChat).not.toHaveBeenCalled()
    useAssistant.setState({ busy: true })
    await useAssistant.getState().send('hello')
    expect(streamChat).not.toHaveBeenCalled()
  })

  it('marks an exchange that used private content as not saved, and does not adopt a conversation', async () => {
    gather.mockResolvedValue('Private workspace "Diary" (read-only):\n- secret')
    script([{ type: 'text', delta: 'ok' }, done({ persisted: false, conversationId: '' })])
    await useAssistant.getState().send('what is in my diary workspace?')
    const s = useAssistant.getState()
    expect(streamChat.mock.calls[0][0].privateContext).toContain('secret')
    expect(s.messages.every((m) => m.unsaved)).toBe(true)
    expect(s.conversationId).toBeNull()
  })

  it('still answers when sharing private content fails', async () => {
    gather.mockRejectedValue(new Error('locked'))
    script([{ type: 'text', delta: 'ok' }, done()])
    await useAssistant.getState().send('hi')
    expect(streamChat.mock.calls[0][0].privateContext).toBeNull()
    expect(useAssistant.getState().messages[1].text).toBe('ok')
  })

  it('shows setup and limit problems above the composer instead of an empty bubble', async () => {
    streamChat.mockRejectedValueOnce(new AssistantError('not_configured', 'The assistant is not set up yet.'))
    await useAssistant.getState().send('hi')
    let s = useAssistant.getState()
    expect(s.notice).toEqual({ code: 'not_configured', message: 'The assistant is not set up yet.' })
    expect(s.messages.map((m) => m.role)).toEqual(['user'])

    streamChat.mockRejectedValueOnce(new AssistantError('rate_limited', "You've reached today's limit."))
    await useAssistant.getState().send('again')
    s = useAssistant.getState()
    expect(s.notice?.code).toBe('rate_limited')
    expect(s.busy).toBe(false)
  })

  it('keeps partial text and shows the error when the stream fails midway', async () => {
    script([{ type: 'text', delta: 'Half an ans' }, { type: 'error', message: 'The assistant is busy.' }])
    await useAssistant.getState().send('hi')
    expect(useAssistant.getState().messages[1]).toMatchObject({ status: 'error', text: 'Half an ans', error: 'The assistant is busy.' })
  })

  it('turns network failures into a readable error on the message', async () => {
    streamChat.mockRejectedValueOnce(new AssistantError('network', 'Could not reach the assistant.'))
    await useAssistant.getState().send('hi')
    expect(useAssistant.getState().messages[1]).toMatchObject({ status: 'error', error: 'Could not reach the assistant.' })
  })

  it('stop keeps what was written so far', async () => {
    streamChat.mockImplementationOnce(async (o: { onEvent: (e: ServerEvent) => void; signal: AbortSignal }) => {
      o.onEvent({ type: 'text', delta: 'Working on' })
      await new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    })
    const pending = useAssistant.getState().send('long task')
    await waitFor(() => expect(useAssistant.getState().messages[1]?.text).toBe('Working on'))
    useAssistant.getState().stop()
    await pending
    const s = useAssistant.getState()
    expect(s.messages[1]).toMatchObject({ status: 'done', text: 'Working on' })
    expect(s.busy).toBe(false)
  })

  it('new chat clears everything', async () => {
    script([{ type: 'text', delta: 'a' }, done()])
    await useAssistant.getState().send('one')
    useAssistant.getState().newChat()
    expect(useAssistant.getState()).toMatchObject({ messages: [], conversationId: null, busy: false })
  })
})

describe('message cards', () => {
  const withEvents = (events: ServerEvent[]) => {
    reset()
    script([...events, done()])
    return useAssistant.getState().send('go').then(() => useAssistant.getState().messages[1])
  }

  it('confirm buttons run the change only when pressed', async () => {
    const message = await withEvents([
      { type: 'text', delta: 'Waiting for your confirmation.' },
      { type: 'confirm', confirm: { id: 'c1', kind: 'delete_todos', summary: 'Delete 2 todos', items: [{ id: 'a', title: 'Old A' }, { id: 'b', title: 'Old B' }] } },
    ])
    runConfirm.mockResolvedValue('Deleted 2 todos.')
    render(<MessageBubble message={message} />)
    expect(screen.getByText('Delete 2 todos')).toBeTruthy()
    expect(screen.getByText('Old A')).toBeTruthy()
    expect(runConfirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(useAssistant.getState().messages[1].confirms[0].state).toBe('done'))
    expect(runConfirm).toHaveBeenCalledTimes(1)
    expect(runConfirm.mock.calls[0][0]).toMatchObject({ id: 'c1', kind: 'delete_todos' })
  })

  it('cancel changes nothing', async () => {
    const message = await withEvents([{ type: 'confirm', confirm: { id: 'c2', kind: 'reschedule_todos', summary: 'Move 2 todos', items: [], due_at: '2026-10-20T09:00:00Z' } }])
    render(<MessageBubble message={message} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useAssistant.getState().messages[1].confirms[0].state).toBe('cancelled')
    expect(runConfirm).not.toHaveBeenCalled()
  })

  it('a failed confirmation reports the problem and can be retried', async () => {
    const message = await withEvents([{ type: 'confirm', confirm: { id: 'c3', kind: 'delete_todos', summary: 'Delete 1 todo', items: [] } }])
    runConfirm.mockRejectedValueOnce(new Error('permission denied'))
    render(<MessageBubble message={message} />)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(useAssistant.getState().messages[1].confirms[0].state).toBe('error'))
    expect(useAssistant.getState().messages[1].confirms[0].note).toBe('permission denied')
  })

  it('shows what the assistant did, with Undo only where it makes sense', async () => {
    const message = await withEvents([
      { type: 'action', action: { kind: 'todo_created', id: '1', title: 'Call mom', workspace: 'Personal' } },
      { type: 'action', action: { kind: 'todo_updated', id: '2', title: 'Report', changes: ['priority → high'] } },
    ])
    render(<MessageBubble message={message} />)
    expect(screen.getByText(/Added “Call mom” to Personal/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Undo/ })).toHaveLength(1)

    undoAction.mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }))
    await waitFor(() => expect(screen.getByText('Undone')).toBeTruthy())
    expect(undoAction).toHaveBeenCalledWith({ kind: 'todo_created', id: '1', title: 'Call mom', workspace: 'Personal' })
  })

  it('renders reply text safely, with no raw HTML injection', async () => {
    const message = await withEvents([{ type: 'text', delta: 'Hi <img src=x onerror=alert(1)> **bold**\n\n- one\n- two' }])
    const { container } = render(<MessageBubble message={message} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.querySelectorAll('li')).toHaveLength(2)
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('notes when an exchange was not saved because private content was used', () => {
    const m = { ...useAssistant.getState().messages[0], id: 'x', role: 'assistant' as const, text: 'ok', unsaved: true, status: 'done' as const, actions: [], confirms: [], activity: null }
    render(<MessageBubble message={m} />)
    expect(screen.getByText(/isn’t saved/)).toBeTruthy()
  })
})
