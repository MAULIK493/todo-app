/**
 * A speech-recognition session built on the browser's SpeechRecognition API (Chrome, Edge, Safari).
 * Written against a small interface so it can be tested with a fake recognizer.
 *
 * Privacy note: in most browsers the audio is processed by the browser vendor's speech service, not on the device.
 */

export type RecognitionErrorCode = 'permission' | 'no-speech' | 'no-mic' | 'network' | 'language' | 'unsupported' | 'unknown'

type ResultLike = { isFinal: boolean; length: number; [index: number]: { transcript: string } }
export type RecognitionEventLike = { resultIndex: number; results: ArrayLike<ResultLike> }

export type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: RecognitionEventLike) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type RecognitionCtor = new () => SpeechRecognitionLike

export function getRecognitionCtor(win: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): RecognitionCtor | null {
  return (win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null) as RecognitionCtor | null
}

export const ERROR_MESSAGES: Record<RecognitionErrorCode, string> = {
  permission: "Microphone access is blocked. Allow it in your browser's site settings, then try again.",
  'no-speech': "I didn't hear anything. Tap the mic and try again.",
  'no-mic': 'No microphone was found.',
  network: 'Speech recognition needs an internet connection.',
  language: "That language isn't supported for voice input in this browser.",
  unsupported: "Voice input isn't available in this browser.",
  unknown: 'Voice input stopped unexpectedly. Please try again.',
}

export function mapRecognitionError(error: string): RecognitionErrorCode | 'ignore' {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed': return 'permission'
    case 'no-speech': return 'no-speech'
    case 'audio-capture': return 'no-mic'
    case 'network': return 'network'
    case 'language-not-supported': return 'language'
    case 'aborted': return 'ignore' // we asked it to stop
    default: return 'unknown'
  }
}

export type RecognitionMode = 'command' | 'dictate'

export type RecognitionCallbacks = {
  onInterim: (text: string) => void
  /** The session ended with this much recognised speech. Called at most once, never after cancel(). */
  onFinal: (text: string) => void
  onError: (code: RecognitionErrorCode) => void
  onEnd: () => void
}

const MAX_RESTARTS = 6

export class RecognitionSession {
  private rec: SpeechRecognitionLike
  private opts: { lang: string; mode: RecognitionMode }
  private cb: RecognitionCallbacks
  private interim = ''
  private stopping = false
  private cancelled = false
  private failed = false
  private restarts = 0
  private ended = false

  /**
   * command: the browser ends the session by itself when you stop talking (one spoken instruction).
   * dictate: keeps listening across pauses until stop() is called (some browsers end sessions on their own, so it restarts).
   */
  constructor(ctor: RecognitionCtor, opts: { lang: string; mode: RecognitionMode }, cb: RecognitionCallbacks) {
    this.opts = opts
    this.cb = cb
    this.rec = new ctor()
    this.rec.lang = opts.lang
    this.rec.continuous = opts.mode === 'dictate'
    this.rec.interimResults = true
    this.rec.maxAlternatives = 1
    this.rec.onresult = (e) => this.handleResult(e)
    this.rec.onerror = (e) => this.handleError(e.error)
    this.rec.onend = () => this.handleEnd()
  }

  start() {
    this.rec.start()
  }

  /** Finish up: whatever was heard so far is delivered through onFinal. */
  stop() {
    this.stopping = true
    this.rec.stop()
  }

  /** Throw the session away: nothing is delivered. */
  cancel() {
    this.cancelled = true
    this.rec.abort()
    if (!this.ended) this.finish()
  }

  private handleResult(e: RecognitionEventLike) {
    if (this.cancelled) return
    // Rebuild from the whole result list each time: that is robust to browsers that re-send earlier segments.
    let finals = ''
    let interim = ''
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i]
      const t = r[0]?.transcript ?? ''
      if (r.isFinal) finals += t
      else interim += t
    }
    this.finalsThisRun = finals
    this.interim = interim
    this.cb.onInterim(this.joined(this.finalsThisRun + interim))
  }

  // Segments confirmed in previous runs (restarts) plus the current run.
  private finalsThisRun = ''
  private carried = ''
  private joined(current: string) {
    return `${this.carried}${current}`.replace(/\s+/g, ' ').trim()
  }

  private handleError(error: string) {
    if (this.cancelled) return
    const code = mapRecognitionError(error)
    if (code === 'ignore') return
    this.failed = true
    this.cb.onError(code)
  }

  private handleEnd() {
    if (this.cancelled) return
    const wantMore = this.opts.mode === 'dictate' && !this.stopping && !this.failed && this.restarts < MAX_RESTARTS
    if (wantMore) {
      this.restarts++
      this.carried += this.finalsThisRun + (this.finalsThisRun && !/\s$/.test(this.finalsThisRun) ? ' ' : '')
      this.finalsThisRun = ''
      this.interim = ''
      try {
        this.rec.start()
        return
      } catch {
        /* could not restart: fall through and deliver what we have */
      }
    }
    this.finish()
  }

  private finish() {
    if (this.ended) return
    this.ended = true
    const text = this.cancelled ? '' : this.joined(this.finalsThisRun + this.interim)
    if (text && !this.cancelled) this.cb.onFinal(text)
    this.cb.onEnd()
  }
}
