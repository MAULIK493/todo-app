import { isSupabaseConfigured, supabase } from '@/lib/supabase'

// Crash reporting without a third-party service: reports go to the project's own database (see
// supabase/migrations/0010_error_reports.sql). Everything is scrubbed here first, and again on the server.

/** Emails, login tokens and long opaque strings (keys, hashes) are replaced. Mirrors scrub_error_text() in SQL. */
export function scrub(text: string): string {
  return text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.?[A-Za-z0-9_-]*/g, '[token]')
    .replace(/[A-Za-z0-9+/_=-]{40,}/g, '[redacted]')
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** "/w/3f2a…/notes/9b1c…?x=1" -> "/w/:id/notes/:id": which screen, without which data. */
export function normalizeRoute(path: string): string {
  return path.split(/[?#]/)[0].replace(UUID, ':id').slice(0, 200)
}

/** Short browser description without the full user-agent string, e.g. "Chrome 129 / Mac". */
export function browserName(ua: string): string {
  const pick = (re: RegExp) => re.exec(ua)?.[1]
  const edge = pick(/Edg\/(\d+)/), chrome = pick(/Chrome\/(\d+)/), firefox = pick(/Firefox\/(\d+)/), safari = pick(/Version\/(\d+)[^ ]* .*Safari/)
  const name = edge ? `Edge ${edge}` : firefox ? `Firefox ${firefox}` : chrome ? `Chrome ${chrome}` : safari ? `Safari ${safari}` : 'Unknown browser'
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'unknown OS'
  return `${name} / ${os}`
}

/** Two crashes with the same cause get the same fingerprint, whatever the line numbers, ids or timing in the message. */
export function fingerprintOf(message: string, stack = ''): string {
  const generic = message.replace(UUID, ':id').replace(/\d+/g, '#').slice(0, 200)
  const frames = stack.split('\n').map((l) => /at\s+([^\s(]+)/.exec(l)?.[1]).filter((f): f is string => !!f && f !== 'new').slice(0, 3)
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (const ch of `${generic}|${frames.join('>')}`) {
    h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619)
    h2 = Math.imul(h2 + ch.charCodeAt(0), 2246822519) ^ (h1 >>> 7)
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}

/** Errors that are noise, or that have a better remedy than a report. */
const IGNORED = [
  /ResizeObserver loop/i,
  /AbortError|The user aborted a request|signal is aborted/i,
  /Non-Error promise rejection/i,
]
/** After a new release, old pages may ask for files that no longer exist: the fix is a reload, not a bug report. */
export const isStaleBundleError = (message: string) => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError/i.test(message)

export type Report = {
  fingerprint: string; message: string; stack: string | null; route: string; release: string; userAgent: string; context: Record<string, string | number | boolean>
}

export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  return new Error(typeof value === 'string' ? value : (() => { try { return JSON.stringify(value) } catch { return String(value) } })())
}

type Env = { route: () => string; release: string; userAgent: string; online: () => boolean; now: () => number }

const browserEnv = (): Env => ({
  route: () => location.pathname, release: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev', userAgent: navigator.userAgent, online: () => navigator.onLine, now: () => Date.now(),
})

export class ErrorReporter {
  private send: (r: Report) => Promise<void>
  private env: Env
  private maxPerSession: number
  private minGapMs: number
  private sent = 0
  private lastSent = new Map<string, number>()

  constructor(send: (r: Report) => Promise<void>, opts: { maxPerSession?: number; minGapMs?: number; env?: Partial<Env> } = {}) {
    this.send = send
    this.env = { ...browserEnv(), ...opts.env }
    this.maxPerSession = opts.maxPerSession ?? 15
    this.minGapMs = opts.minGapMs ?? 5 * 60_000
  }

  /** Returns true if the error was sent. Never throws: reporting a problem must not cause another one. */
  report(value: unknown, context: Report['context'] = {}): boolean {
    try {
      const error = toError(value)
      const message = scrub(`${error.name !== 'Error' ? `${error.name}: ` : ''}${error.message}`).slice(0, 600)
      if (!message || IGNORED.some((re) => re.test(message)) || isStaleBundleError(message)) return false
      if (!this.env.online()) return false // offline failures are expected, and there is nowhere to send them

      const fingerprint = fingerprintOf(message, error.stack)
      const now = this.env.now()
      if (this.sent >= this.maxPerSession) return false
      const last = this.lastSent.get(fingerprint)
      if (last !== undefined && now - last < this.minGapMs) return false

      this.sent++
      this.lastSent.set(fingerprint, now)
      void this.send({
        fingerprint, message, stack: error.stack ? scrub(error.stack).slice(0, 4000) : null, route: normalizeRoute(this.env.route()),
        release: this.env.release, userAgent: browserName(this.env.userAgent), context,
      }).catch(() => undefined)
      return true
    } catch {
      return false
    }
  }
}

async function sendToDatabase(r: Report) {
  if (!isSupabaseConfigured) return
  await supabase.rpc('report_client_error', {
    p_fingerprint: r.fingerprint, p_message: r.message, p_stack: r.stack, p_route: r.route, p_release: r.release, p_user_agent: r.userAgent, p_context: r.context,
  })
}

export const errorReporter = new ErrorReporter(sendToDatabase)
export const reportError = (e: unknown, context?: Report['context']) => errorReporter.report(e, context)

/** Reports errors nothing else caught. Returns a function that removes the handlers. */
export function installErrorReporting(reporter: ErrorReporter = errorReporter, target: Window = window) {
  const onError = (e: ErrorEvent) => { reporter.report(e.error ?? e.message, { source: 'window' }) }
  const onRejection = (e: PromiseRejectionEvent) => { reporter.report(e.reason, { source: 'promise' }) }
  target.addEventListener('error', onError)
  target.addEventListener('unhandledrejection', onRejection)
  return () => {
    target.removeEventListener('error', onError)
    target.removeEventListener('unhandledrejection', onRejection)
  }
}
