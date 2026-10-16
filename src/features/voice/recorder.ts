/**
 * Fallback for browsers without built-in speech recognition (Firefox, for example): record a short clip with the
 * microphone and have the server transcribe it. The clip is sent for transcription and not stored.
 */

/** Root-mean-square loudness of a block of audio samples (0 = silence, 1 = full scale). */
export function rms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/** The first recording format this browser can produce (Chrome/Firefox: webm or ogg; Safari: mp4). */
export function pickMimeType(isSupported: (type: string) => boolean): string | undefined {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/aac'].find(isSupported)
}

export type SilenceDecision = 'continue' | 'stop-after-speech' | 'stop-no-speech' | 'stop-max'

/** Decides when a hands-free recording is over: a pause after speech, no speech at all, or the time limit. */
export class SilenceDetector {
  private o: { threshold: number; silenceMs: number; minSpeechMs: number; noSpeechMs: number; maxMs: number }
  private startedAt: number | null = null
  private lastFeed = 0
  private lastVoice = 0
  private speechMs = 0

  constructor(opts: Partial<{ threshold: number; silenceMs: number; minSpeechMs: number; noSpeechMs: number; maxMs: number }> = {}) {
    this.o = { threshold: 0.02, silenceMs: 1400, minSpeechMs: 250, noSpeechMs: 6000, maxMs: 45_000, ...opts }
  }

  feed(level: number, nowMs: number): SilenceDecision {
    if (this.startedAt === null) { this.startedAt = nowMs; this.lastFeed = nowMs; this.lastVoice = nowMs }
    const dt = nowMs - this.lastFeed
    this.lastFeed = nowMs
    if (level >= this.o.threshold) { this.speechMs += dt; this.lastVoice = nowMs }

    if (nowMs - this.startedAt >= this.o.maxMs) return 'stop-max'
    if (this.speechMs < this.o.minSpeechMs) return nowMs - this.startedAt >= this.o.noSpeechMs ? 'stop-no-speech' : 'continue'
    return nowMs - this.lastVoice >= this.o.silenceMs ? 'stop-after-speech' : 'continue'
  }
}

export type RecorderCallbacks = {
  onLevel: (level: number) => void
  onAudio: (clip: Blob) => void
  onError: (code: 'permission' | 'no-mic' | 'no-speech' | 'unknown') => void
  onEnd: () => void
}

export const recorderSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'

export class RecorderSession {
  private cb: RecorderCallbacks
  private autoStop: boolean
  private stream: MediaStream | null = null
  private recorder: MediaRecorder | null = null
  private audioCtx: AudioContext | null = null
  private raf = 0
  private chunks: Blob[] = []
  private cancelled = false
  private noSpeech = false
  private closed = false

  constructor(cb: RecorderCallbacks, opts: { autoStop: boolean }) {
    this.cb = cb
    this.autoStop = opts.autoStop
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch (e) {
      const name = e instanceof DOMException ? e.name : ''
      this.cb.onError(name === 'NotAllowedError' || name === 'SecurityError' ? 'permission' : name === 'NotFoundError' ? 'no-mic' : 'unknown')
      return this.close()
    }
    if (this.cancelled) return this.close()

    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t))
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data) }
    this.recorder.onstop = () => {
      if (!this.cancelled && !this.noSpeech && this.chunks.length) this.cb.onAudio(new Blob(this.chunks, { type: this.recorder?.mimeType || mimeType || 'audio/webm' }))
      this.close()
    }
    this.recorder.start()
    this.watchLevel()
  }

  /** Finish and send what was recorded. */
  stop() {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    else this.close()
  }

  cancel() {
    this.cancelled = true
    this.stop()
  }

  private watchLevel() {
    if (!this.stream) return
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    this.audioCtx = new Ctx()
    const analyser = this.audioCtx.createAnalyser()
    analyser.fftSize = 1024
    this.audioCtx.createMediaStreamSource(this.stream).connect(analyser)
    const data = new Float32Array(analyser.fftSize)
    const detector = new SilenceDetector()

    const tick = () => {
      analyser.getFloatTimeDomainData(data)
      const level = rms(data)
      this.cb.onLevel(level)
      const decision = this.autoStop ? detector.feed(level, performance.now()) : 'continue'
      if (decision === 'stop-no-speech') { this.noSpeech = true; this.cb.onError('no-speech'); return this.stop() }
      if (decision !== 'continue') return this.stop()
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  private close() {
    if (this.closed) return
    this.closed = true
    cancelAnimationFrame(this.raf)
    this.stream?.getTracks().forEach((t) => t.stop())
    void this.audioCtx?.close()
    this.cb.onEnd()
  }
}
