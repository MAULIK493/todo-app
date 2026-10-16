// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerEvent } from '@shared/types.ts'
import type { RecorderCallbacks } from './recorder'

// A browser with no built-in speech recognition (e.g. Firefox): the microphone is recorded and transcribed on the server.
const streamChat = vi.fn()
vi.mock('@/features/assistant/api', () => ({ AssistantError: class extends Error {}, streamChat: (o: unknown) => streamChat(o) }))
vi.mock('@/features/assistant/privateLoader', () => ({ gatherPrivateContext: async () => null }))
vi.mock('@/features/assistant/actions', () => ({ refreshAfterAssistant: vi.fn(), runConfirm: vi.fn(), undoAction: vi.fn(), canUndo: () => false }))
vi.mock('./speech', async (orig) => ({ ...(await orig<typeof import('./speech')>()), maybeSpeak: vi.fn(), cancelSpeech: vi.fn() }))

const transcribe = vi.fn()
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), transcribe: (...a: unknown[]) => transcribe(...a) }))

class FakeRecorder {
  static last: FakeRecorder | null = null
  cb: RecorderCallbacks
  opts: { autoStop: boolean }
  started = false
  stopped = false
  cancelled = false
  constructor(cb: RecorderCallbacks, opts: { autoStop: boolean }) { this.cb = cb; this.opts = opts; FakeRecorder.last = this }
  async start() { this.started = true }
  stop() { this.stopped = true }
  cancel() { this.cancelled = true; this.cb.onEnd() }
}
vi.mock('./recorder', async (orig) => ({ ...(await orig<typeof import('./recorder')>()), RecorderSession: FakeRecorder, recorderSupported: () => true }))

const { Composer } = await import('@/features/assistant/Composer')
const { useAssistant } = await import('@/features/assistant/store')
const { DEFAULT_VOICE_SETTINGS, useVoiceSettings } = await import('./settings')
const { TranscribeError } = await import('./api')

const done: ServerEvent = { type: 'done', conversationId: 'c', persisted: true, usage: { input: 1, output: 1 } }
const mic = () => screen.getByRole('button', { name: /speak to the assistant|stop listening|transcribing/i })

beforeEach(() => {
  streamChat.mockReset()
  streamChat.mockImplementation(async (o: { onEvent: (e: ServerEvent) => void }) => { o.onEvent({ type: 'text', delta: 'Done.' }); o.onEvent(done) })
  transcribe.mockReset()
  FakeRecorder.last = null
  useAssistant.setState({ open: true, conversationId: null, messages: [], busy: false, notice: null, controller: null, pendingVoice: false })
  useVoiceSettings.setState({ ...DEFAULT_VOICE_SETTINGS })
})
afterEach(cleanup)

describe('voice fallback (record, then transcribe on the server)', () => {
  it('records, shows that it is transcribing, then sends the transcript as a normal instruction', async () => {
    let resolve!: (t: string) => void
    transcribe.mockReturnValue(new Promise<string>((r) => { resolve = r }))
    render(<Composer />)

    fireEvent.click(mic())
    expect(FakeRecorder.last!.started).toBe(true)
    expect(FakeRecorder.last!.opts.autoStop).toBe(true) // hands-free: ends itself after a pause

    act(() => { FakeRecorder.last!.cb.onAudio(new Blob(['x'], { type: 'audio/webm' })); FakeRecorder.last!.cb.onEnd() })
    expect(screen.getByText('Transcribing…')).toBeTruthy()
    expect(streamChat).not.toHaveBeenCalled()

    await act(async () => resolve('add buy milk'))
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1))
    expect(streamChat.mock.calls[0][0].message).toBe('add buy milk')
    expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), expect.any(String))
  })

  it('shows a clear message when the server has no speech service set up', async () => {
    transcribe.mockRejectedValue(new TranscribeError('unsupported', "Voice input isn't available in this browser."))
    render(<Composer />)
    fireEvent.click(mic())
    act(() => { FakeRecorder.last!.cb.onAudio(new Blob(['x'], { type: 'audio/webm' })); FakeRecorder.last!.cb.onEnd() })
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn't available in this browser/)
    expect(streamChat).not.toHaveBeenCalled()
  })

  it('reports a microphone problem from the recorder', () => {
    render(<Composer />)
    fireEvent.click(mic())
    act(() => { FakeRecorder.last!.cb.onError('permission'); FakeRecorder.last!.cb.onEnd() })
    expect(screen.getByRole('alert').textContent).toMatch(/Microphone access is blocked/)
  })

  it('releases the microphone when the user cancels or leaves', () => {
    const { unmount } = render(<Composer />)
    fireEvent.click(mic())
    const recorder = FakeRecorder.last!
    unmount()
    expect(recorder.cancelled).toBe(true)
  })

  it('in review mode the recording runs until stopped, and the text goes into the box', async () => {
    useVoiceSettings.getState().update({ autoSend: false })
    transcribe.mockResolvedValue('what is due today')
    render(<Composer />)
    fireEvent.click(mic())
    expect(FakeRecorder.last!.opts.autoStop).toBe(false)
    fireEvent.click(mic()) // tap again to finish
    expect(FakeRecorder.last!.stopped).toBe(true)
    act(() => { FakeRecorder.last!.cb.onAudio(new Blob(['x'], { type: 'audio/webm' })); FakeRecorder.last!.cb.onEnd() })
    await waitFor(() => expect((screen.getByLabelText('Message the assistant') as HTMLTextAreaElement).value).toBe('what is due today'))
    expect(streamChat).not.toHaveBeenCalled()
  })
})
