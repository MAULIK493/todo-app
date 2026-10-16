import { describe, expect, it, vi } from 'vitest'
import {
  getRecognitionCtor, mapRecognitionError, RecognitionSession, type RecognitionCallbacks, type RecognitionEventLike, type SpeechRecognitionLike,
} from './recognition'

class FakeRecognizer implements SpeechRecognitionLike {
  static instances: FakeRecognizer[] = []
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onresult: SpeechRecognitionLike['onresult'] = null
  onerror: SpeechRecognitionLike['onerror'] = null
  onend: SpeechRecognitionLike['onend'] = null
  starts = 0
  aborted = false
  constructor() { FakeRecognizer.instances.push(this) }
  start() { this.starts++ }
  stop() { queueMicrotask(() => this.onend?.()) }
  abort() { this.aborted = true; queueMicrotask(() => this.onend?.()) }
  // test helpers
  say(parts: { text: string; final: boolean }[]) {
    const results = parts.map((p) => Object.assign([{ transcript: p.text }], { isFinal: p.final }))
    this.onresult?.({ resultIndex: 0, results } as unknown as RecognitionEventLike)
  }
  end() { this.onend?.() }
  fail(error: string) { this.onerror?.({ error }) }
}

function make(mode: 'command' | 'dictate' = 'command') {
  FakeRecognizer.instances = []
  const calls = { interim: [] as string[], final: [] as string[], errors: [] as string[], ended: 0 }
  const cb: RecognitionCallbacks = {
    onInterim: (t) => calls.interim.push(t), onFinal: (t) => calls.final.push(t), onError: (c) => calls.errors.push(c), onEnd: () => calls.ended++,
  }
  const session = new RecognitionSession(FakeRecognizer, { lang: 'hi-IN', mode }, cb)
  return { session, rec: FakeRecognizer.instances[0], calls }
}

describe('RecognitionSession', () => {
  it('configures the recognizer for the mode and language', () => {
    const cmd = make('command').rec
    expect([cmd.lang, cmd.continuous, cmd.interimResults]).toEqual(['hi-IN', false, true])
    expect(make('dictate').rec.continuous).toBe(true)
  })

  it('shows interim words live and delivers the final text once when the browser ends the session', () => {
    const { session, rec, calls } = make()
    session.start()
    rec.say([{ text: 'add call', final: false }])
    rec.say([{ text: 'add call mom', final: false }])
    rec.say([{ text: 'add call mom tomorrow', final: true }])
    rec.end()
    expect(calls.interim).toEqual(['add call', 'add call mom', 'add call mom tomorrow'])
    expect(calls.final).toEqual(['add call mom tomorrow'])
    expect(calls.ended).toBe(1)
  })

  it('joins several final segments and keeps unfinished words', () => {
    const { session, rec, calls } = make()
    session.start()
    rec.say([{ text: 'add call mom', final: true }, { text: ' and buy milk', final: false }])
    rec.end()
    expect(calls.final).toEqual(['add call mom and buy milk'])
  })

  it('stop() delivers what was heard', async () => {
    const { session, rec, calls } = make()
    session.start()
    rec.say([{ text: 'what is due today', final: false }])
    session.stop()
    await Promise.resolve()
    expect(calls.final).toEqual(['what is due today'])
  })

  it('cancel() discards everything and reports nothing', async () => {
    const { session, rec, calls } = make()
    session.start()
    rec.say([{ text: 'delete everything', final: true }])
    session.cancel()
    await Promise.resolve()
    rec.end()
    expect(rec.aborted).toBe(true)
    expect(calls.final).toEqual([])
    expect(calls.ended).toBe(1)
  })

  it('delivers nothing when nothing was said', () => {
    const { session, rec, calls } = make()
    session.start()
    rec.end()
    expect(calls.final).toEqual([])
    expect(calls.ended).toBe(1)
  })

  it('maps errors to friendly codes and ignores our own aborts', () => {
    const { session, rec, calls } = make()
    session.start()
    rec.fail('aborted')
    rec.fail('not-allowed')
    expect(calls.errors).toEqual(['permission'])
    expect(mapRecognitionError('audio-capture')).toBe('no-mic')
    expect(mapRecognitionError('network')).toBe('network')
    expect(mapRecognitionError('language-not-supported')).toBe('language')
    expect(mapRecognitionError('weird')).toBe('unknown')
  })

  it('dictation restarts when the browser ends it early, keeping earlier words', () => {
    const { session, rec, calls } = make('dictate')
    session.start()
    rec.say([{ text: 'first part', final: true }])
    rec.end() // browser timed out; session continues
    expect(rec.starts).toBe(2)
    expect(calls.ended).toBe(0)
    rec.say([{ text: 'second part', final: true }])
    session.stop()
    return Promise.resolve().then(() => {
      expect(calls.final).toEqual(['first part second part'])
      expect(calls.ended).toBe(1)
    })
  })

  it('does not restart after an error, and gives up after too many restarts', () => {
    const a = make('dictate')
    a.session.start()
    a.rec.fail('not-allowed')
    a.rec.end()
    expect(a.rec.starts).toBe(1)
    expect(a.calls.ended).toBe(1)

    const b = make('dictate')
    b.session.start()
    for (let i = 0; i < 20; i++) b.rec.end()
    expect(b.rec.starts).toBeLessThanOrEqual(7)
    expect(b.calls.ended).toBe(1)
  })

  it('command mode never restarts', () => {
    const { session, rec } = make('command')
    session.start()
    rec.end()
    expect(rec.starts).toBe(1)
  })
})

describe('getRecognitionCtor', () => {
  it('finds the standard or webkit constructor, or null', () => {
    const ctor = vi.fn()
    expect(getRecognitionCtor({ SpeechRecognition: ctor })).toBe(ctor)
    expect(getRecognitionCtor({ webkitSpeechRecognition: ctor })).toBe(ctor)
    expect(getRecognitionCtor({})).toBeNull()
  })
})
