// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerEvent } from '@shared/types.ts'
import type { RecognitionEventLike, SpeechRecognitionLike } from './recognition'

const streamChat = vi.fn()
vi.mock('@/features/assistant/api', () => ({ AssistantError: class extends Error {}, streamChat: (o: unknown) => streamChat(o) }))
vi.mock('@/features/assistant/privateLoader', () => ({ gatherPrivateContext: async () => null }))
vi.mock('@/features/assistant/actions', () => ({ refreshAfterAssistant: vi.fn(), runConfirm: vi.fn(), undoAction: vi.fn(), canUndo: () => false }))
const maybeSpeak = vi.fn()
vi.mock('./speech', async (orig) => ({ ...(await orig<typeof import('./speech')>()), maybeSpeak: (...a: unknown[]) => maybeSpeak(...a), cancelSpeech: vi.fn() }))

class FakeRecognizer implements SpeechRecognitionLike {
  static last: FakeRecognizer | null = null
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onresult: SpeechRecognitionLike['onresult'] = null
  onerror: SpeechRecognitionLike['onerror'] = null
  onend: SpeechRecognitionLike['onend'] = null
  started = false
  stopped = false
  constructor() { FakeRecognizer.last = this }
  start() { this.started = true }
  stop() { this.stopped = true; queueMicrotask(() => this.onend?.()) }
  abort() { queueMicrotask(() => this.onend?.()) }
  say(text: string, final = false) {
    act(() => this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: final })] } as unknown as RecognitionEventLike))
  }
  finish() { act(() => this.onend?.()) }
  fail(error: string) { act(() => this.onerror?.({ error })) }
}

const { Composer } = await import('@/features/assistant/Composer')
const { useAssistant } = await import('@/features/assistant/store')
const { DEFAULT_VOICE_SETTINGS, useVoiceSettings } = await import('./settings')

const done: ServerEvent = { type: 'done', conversationId: 'c', persisted: true, usage: { input: 1, output: 1 } }
const mic = () => screen.getByRole('button', { name: /speak to the assistant|stop listening/i })
const textarea = () => screen.getByLabelText('Message the assistant') as HTMLTextAreaElement

beforeEach(() => {
  ;(window as unknown as Record<string, unknown>).webkitSpeechRecognition = FakeRecognizer
  FakeRecognizer.last = null
  streamChat.mockReset()
  streamChat.mockImplementation(async (o: { onEvent: (e: ServerEvent) => void }) => { o.onEvent({ type: 'text', delta: 'Done.' }); o.onEvent(done) })
  maybeSpeak.mockReset()
  useAssistant.setState({ open: true, conversationId: null, messages: [], busy: false, notice: null, controller: null, pendingVoice: false })
  useVoiceSettings.setState({ ...DEFAULT_VOICE_SETTINGS })
  localStorage.clear()
})
afterEach(() => { cleanup(); delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition })

describe('voice commands', () => {
  it('tap, speak, and the instruction goes straight to the assistant', async () => {
    render(<Composer />)
    fireEvent.click(mic())
    expect(FakeRecognizer.last!.started).toBe(true)
    expect(screen.getByText(/Listening/)).toBeTruthy()

    FakeRecognizer.last!.say('add call mom tomorrow')
    expect(screen.getByText('add call mom tomorrow')).toBeTruthy() // live transcript
    FakeRecognizer.last!.say('add call mom tomorrow at six', true)
    FakeRecognizer.last!.finish()

    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1))
    expect(streamChat.mock.calls[0][0]).toMatchObject({ message: 'add call mom tomorrow at six' })
    expect(useAssistant.getState().messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('uses the single-instruction mode when sending automatically, and listens in the chosen language', () => {
    useVoiceSettings.getState().update({ lang: 'hi-IN' })
    render(<Composer />)
    fireEvent.click(mic())
    expect(FakeRecognizer.last).toMatchObject({ lang: 'hi-IN', continuous: false })
  })

  it('can review first: the spoken words land in the box and nothing is sent', async () => {
    useVoiceSettings.getState().update({ autoSend: false })
    render(<Composer />)
    fireEvent.click(mic())
    expect(FakeRecognizer.last!.continuous).toBe(true) // keeps listening across pauses until you stop it
    FakeRecognizer.last!.say('what is overdue', true)
    fireEvent.click(mic()) // tap again to finish
    await waitFor(() => expect(textarea().value).toBe('what is overdue'))
    expect(streamChat).not.toHaveBeenCalled()
  })

  it('appends to what was already typed', async () => {
    useVoiceSettings.getState().update({ autoSend: false })
    render(<Composer />)
    fireEvent.change(textarea(), { target: { value: 'Also,' } })
    fireEvent.click(mic())
    FakeRecognizer.last!.say('add milk', true)
    fireEvent.click(mic())
    await waitFor(() => expect(textarea().value).toBe('Also, add milk'))
  })

  it('press and hold to talk: letting go finishes; a quick tap keeps listening', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    render(<Composer />)

    fireEvent.pointerDown(mic(), { button: 0 })
    expect(FakeRecognizer.last!.started).toBe(true)
    FakeRecognizer.last!.say('quick tap', false)
    now += 100
    fireEvent.pointerUp(mic())
    expect(FakeRecognizer.last!.stopped).toBe(false) // still listening after a tap

    FakeRecognizer.last!.say('quick tap', true)
    FakeRecognizer.last!.finish()
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useAssistant.getState().busy).toBe(false))

    now += 5000
    fireEvent.pointerDown(mic(), { button: 0 })
    FakeRecognizer.last!.say('held to talk', true)
    now += 900
    fireEvent.pointerUp(mic())
    expect(FakeRecognizer.last!.stopped).toBe(true) // release ends a hold
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(2))
    expect(streamChat.mock.calls[1][0].message).toBe('held to talk')
    vi.restoreAllMocks()
  })

  it('a quick tap on a mic that is already listening finishes it', async () => {
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    render(<Composer />)
    fireEvent.pointerDown(mic(), { button: 0 })
    now += 80
    fireEvent.pointerUp(mic()) // first tap: starts and keeps listening
    FakeRecognizer.last!.say('plan my week', true)
    now += 3000
    fireEvent.pointerDown(mic(), { button: 0 })
    now += 80
    fireEvent.pointerUp(mic()) // second tap: finish
    expect(FakeRecognizer.last!.stopped).toBe(true)
    await waitFor(() => expect(streamChat).toHaveBeenCalledTimes(1))
    vi.restoreAllMocks()
  })

  it('explains a blocked microphone and sends nothing', () => {
    render(<Composer />)
    fireEvent.click(mic())
    FakeRecognizer.last!.fail('not-allowed')
    FakeRecognizer.last!.finish()
    expect(screen.getByRole('alert').textContent).toMatch(/Microphone access is blocked/)
    expect(streamChat).not.toHaveBeenCalled()
  })

  it('cancelling throws the speech away', async () => {
    render(<Composer />)
    fireEvent.click(mic())
    FakeRecognizer.last!.say('delete everything', true)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel voice input' }))
    await Promise.resolve()
    expect(streamChat).not.toHaveBeenCalled()
    expect(screen.queryByText(/Listening/)).toBeNull()
  })

  it('the floating mic / shortcut opens listening, and a second request stops it', () => {
    render(<Composer />)
    act(() => useAssistant.getState().requestVoice())
    expect(FakeRecognizer.last!.started).toBe(true)
    expect(useAssistant.getState().pendingVoice).toBe(false)
    act(() => useAssistant.getState().requestVoice())
    expect(FakeRecognizer.last!.stopped).toBe(true)
  })

  it('does not start listening while the assistant is busy answering', () => {
    useAssistant.setState({ busy: true })
    render(<Composer />)
    expect(screen.queryByRole('button', { name: /speak to the assistant/i })).toBeNull() // Stop is shown instead
  })

  it('tells the reply logic whether the message was spoken', async () => {
    render(<Composer />)
    await act(async () => { await useAssistant.getState().send('typed question') })
    expect(maybeSpeak).toHaveBeenLastCalledWith('Done.', { viaVoice: false, usedPrivate: false })

    fireEvent.click(mic())
    FakeRecognizer.last!.say('spoken question', true)
    FakeRecognizer.last!.finish()
    await waitFor(() => expect(maybeSpeak).toHaveBeenCalledTimes(2))
    expect(maybeSpeak).toHaveBeenLastCalledWith('Done.', { viaVoice: true, usedPrivate: false })
  })

  it('hides the mic when the browser can do neither built-in recognition nor recording', () => {
    delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    render(<Composer />)
    expect(screen.queryByRole('button', { name: /speak to the assistant/i })).toBeNull()
    expect(textarea()).toBeTruthy() // typing still works
  })
})
