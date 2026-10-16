import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TranscribeError, transcribe } from './api'
import { ERROR_MESSAGES, getRecognitionCtor, RecognitionSession, type RecognitionMode } from './recognition'
import { RecorderSession, recorderSupported } from './recorder'
import { cancelSpeech } from './speech'

export type VoiceStatus = 'idle' | 'listening' | 'transcribing'
export type VoiceEngine = 'speech' | 'recorder' | 'none'

export type StartOptions = { mode: RecognitionMode; lang: string; onFinal: (text: string) => void }

/**
 * Voice input with whichever engine the browser offers: its built-in speech recognition, or (without it) a recording
 * transcribed on the server. Listening only ever starts from a user gesture, so the browser asks for the microphone
 * the first time the user taps the mic, not before.
 */
export function useVoiceInput() {
  const engine: VoiceEngine = useMemo(() => (getRecognitionCtor() ? 'speech' : recorderSupported() ? 'recorder' : 'none'), [])
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [interim, setInterim] = useState('')
  const [level, setLevel] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const session = useRef<{ stop(): void; cancel(): void } | null>(null)

  const cancel = useCallback(() => {
    session.current?.cancel()
    session.current = null
    setStatus('idle')
    setInterim('')
    setLevel(0)
  }, [])

  const stop = useCallback(() => session.current?.stop(), [])

  const start = useCallback((o: StartOptions) => {
    session.current?.cancel()
    if (engine === 'none') { setError(ERROR_MESSAGES.unsupported); return }
    cancelSpeech() // never listen while the assistant is still talking: the mic would hear it
    setError(null)
    setInterim('')
    setStatus('listening')

    const done = () => { session.current = null; setInterim(''); setLevel(0) }

    if (engine === 'speech') {
      const rec = new RecognitionSession(getRecognitionCtor()!, { lang: o.lang, mode: o.mode }, {
        onInterim: setInterim,
        onFinal: o.onFinal,
        onError: (code) => setError(ERROR_MESSAGES[code]),
        onEnd: () => { done(); setStatus('idle') },
      })
      session.current = rec
      try { rec.start() } catch { setError(ERROR_MESSAGES.unknown); done(); setStatus('idle') }
      return
    }

    const rec = new RecorderSession({
      onLevel: setLevel,
      onError: (code) => setError(ERROR_MESSAGES[code]),
      onAudio: (clip) => {
        setStatus('transcribing')
        transcribe(clip, o.lang)
          .then(o.onFinal)
          .catch((e: unknown) => setError(e instanceof TranscribeError ? e.message : ERROR_MESSAGES.unknown))
          .finally(() => setStatus('idle'))
      },
      onEnd: () => { done(); setStatus((s) => (s === 'transcribing' ? s : 'idle')) },
    }, { autoStop: o.mode === 'command' })
    session.current = rec
    void rec.start()
  }, [engine])

  // Leaving the screen must release the microphone.
  useEffect(() => () => { session.current?.cancel() }, [])

  return { engine, supported: engine !== 'none', status, interim, level, error, start, stop, cancel, clearError: () => setError(null) }
}

export type VoiceInput = ReturnType<typeof useVoiceInput>
