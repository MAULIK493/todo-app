// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '@/components/ErrorBoundary'

const rpc = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) }, isSupabaseConfigured: true }))

const { browserName, ErrorReporter, fingerprintOf, installErrorReporting, isStaleBundleError, normalizeRoute, scrub, toError, errorReporter } = await import('./errorReporting')

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

describe('scrub', () => {
  it('removes emails, tokens and long secrets but keeps the useful words', () => {
    const out = scrub(`Failed for jane.doe@example.com with ${JWT} and key sk_live_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdef`)
    expect(out).toBe('Failed for [email] with [token] and key [redacted]')
    expect(scrub('TypeError: Cannot read properties of undefined (reading "map")')).toBe('TypeError: Cannot read properties of undefined (reading "map")')
  })
})

describe('normalizeRoute', () => {
  it('keeps the screen and drops ids, queries and fragments', () => {
    expect(normalizeRoute('/w/3f2a9b1c-1111-4222-8333-444455556666/notes/9b1c3f2a-aaaa-4bbb-8ccc-ddddeeeeffff?token=abc#x')).toBe('/w/:id/notes/:id')
    expect(normalizeRoute('/rewards')).toBe('/rewards')
    expect(normalizeRoute('/' + 'a'.repeat(500)).length).toBe(200)
  })
})

describe('browserName', () => {
  it('summarises without the full user-agent', () => {
    expect(browserName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36')).toBe('Chrome 129 / Mac')
    expect(browserName('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/128.0')).toBe('Edge 128 / Windows')
    expect(browserName('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0')).toBe('Firefox 130 / Linux')
    expect(browserName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari 17 / iOS')
    expect(browserName('curl/8')).toBe('Unknown browser / unknown OS')
  })
})

describe('fingerprintOf', () => {
  const stack = (line: number) => `Error: x\n    at renderList (app.js:${line}:5)\n    at Page (app.js:${line + 40}:9)\n    at App (app.js:1:1)`
  it('is the same for the same cause, whatever the numbers and ids', () => {
    expect(fingerprintOf('Cannot read item 41 of 3f2a9b1c-1111-4222-8333-444455556666', stack(10))).toBe(fingerprintOf('Cannot read item 7 of 9b1c3f2a-aaaa-4bbb-8ccc-ddddeeeeffff', stack(99)))
  })
  it('differs for different causes and has a fixed short length', () => {
    expect(fingerprintOf('Cannot read x', stack(10))).not.toBe(fingerprintOf('Cannot read y', stack(10)))
    expect(fingerprintOf('Cannot read x', stack(10))).not.toBe(fingerprintOf('Cannot read x', 'Error\n    at somewhereElse (a.js:1:1)'))
    expect(fingerprintOf('x')).toHaveLength(16)
  })
})

describe('ErrorReporter', () => {
  const make = (over: Partial<ConstructorParameters<typeof ErrorReporter>[1]> = {}) => {
    const send = vi.fn().mockResolvedValue(undefined)
    let t = 1_000_000
    let online = true
    const reporter = new ErrorReporter(send, {
      ...over, env: { route: () => '/w/3f2a9b1c-1111-4222-8333-444455556666', release: '1.2.3', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/129.0 Safari/537.36', online: () => online, now: () => t },
    })
    return { reporter, send, tick: (ms: number) => { t += ms }, setOnline: (v: boolean) => { online = v } }
  }

  it('sends a scrubbed, anonymised report', () => {
    const { reporter, send } = make()
    expect(reporter.report(new TypeError(`Bad data for ${JWT} from a@b.co`), { scope: 'page' })).toBe(true)
    const r = send.mock.calls[0][0]
    expect(r).toMatchObject({ route: '/w/:id', release: '1.2.3', userAgent: 'Chrome 129 / Mac', context: { scope: 'page' } })
    expect(r.message).toBe('TypeError: Bad data for [token] from [email]')
    expect(JSON.stringify(r)).not.toMatch(/eyJ|a@b\.co/)
  })

  it('reports a problem once per window, and again after it', () => {
    const { reporter, send, tick } = make({ minGapMs: 60_000 })
    expect(reporter.report(new Error('same problem 1'))).toBe(true)
    expect(reporter.report(new Error('same problem 2'))).toBe(false) // same fingerprint (numbers ignored)
    tick(61_000)
    expect(reporter.report(new Error('same problem 3'))).toBe(true)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('stops after the per-session cap, so a crash loop cannot flood', () => {
    const { reporter, send } = make({ maxPerSession: 3 })
    for (let i = 0; i < 10; i++) reporter.report(new Error(`distinct problem ${'x'.repeat(i + 1)}`))
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('ignores noise, stale-bundle errors, and anything while offline', () => {
    const { reporter, send, setOnline } = make()
    for (const msg of ['ResizeObserver loop completed with undelivered notifications', 'AbortError: The user aborted a request', 'Failed to fetch dynamically imported module: /assets/x.js']) {
      expect(reporter.report(new Error(msg)), msg).toBe(false)
    }
    setOnline(false)
    expect(reporter.report(new Error('real problem'))).toBe(false)
    expect(send).not.toHaveBeenCalled()
    expect(isStaleBundleError('Importing a module script failed.')).toBe(true)
    expect(isStaleBundleError('Cannot read x')).toBe(false)
  })

  it('never throws, even if sending fails or the value is strange', () => {
    const failing = new ErrorReporter(() => Promise.reject(new Error('network')), { env: { online: () => true } })
    expect(() => failing.report(new Error('boom'))).not.toThrow()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(() => failing.report(circular)).not.toThrow()
    expect(toError('text').message).toBe('text')
    expect(toError({ a: 1 }).message).toBe('{"a":1}')
  })
})

describe('global handlers', () => {
  it('report uncaught errors and unhandled rejections, and can be removed', () => {
    const report = vi.fn()
    const off = installErrorReporting({ report } as never, window)
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('uncaught'), message: 'uncaught' }))
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'uncaught' }), { source: 'window' })
    const rejection = Object.assign(new Event('unhandledrejection'), { reason: new Error('rejected') })
    window.dispatchEvent(rejection)
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: 'rejected' }), { source: 'promise' })
    off()
    // Nothing is listening any more, so the test runner would flag this deliberate error as unhandled.
    const swallow = (e: Event) => e.preventDefault()
    window.addEventListener('error', swallow)
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('after'), message: 'after', cancelable: true }))
    window.removeEventListener('error', swallow)
    expect(report).toHaveBeenCalledTimes(2)
  })
})

describe('ErrorBoundary', () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ error: null }); vi.spyOn(console, 'error').mockImplementation(() => undefined) })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  function Bomb({ explode }: { explode: boolean }) {
    if (explode) throw new Error('render exploded for jane@example.com')
    return <p>fine</p>
  }

  it('shows a way forward instead of a blank page, and reports the crash without personal data', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
    errorReporter['lastSent'].clear()
    render(<ErrorBoundary scope="page"><Bomb explode /></ErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toMatch(/Something went wrong/)
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
    expect(rpc).toHaveBeenCalledTimes(1)
    const args = rpc.mock.calls[0][1]
    expect(args.p_message).toContain('[email]')
    expect(JSON.stringify(args)).not.toContain('jane@example.com')
    expect(args.p_context.scope).toBe('page')
  })

  it('recovers when the user navigates (the key changes) or presses Try again', () => {
    errorReporter['lastSent'].clear()
    let explode = true
    const { rerender } = render(<ErrorBoundary scope="page" resetKey="/a"><Bomb explode={explode} /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeTruthy()
    explode = false
    rerender(<ErrorBoundary scope="page" resetKey="/b"><Bomb explode={explode} /></ErrorBoundary>)
    expect(screen.getByText('fine')).toBeTruthy()
  })

  it('"Try again" re-renders the page', () => {
    errorReporter['lastSent'].clear()
    let explode = true
    const Toggle = () => <Bomb explode={explode} />
    render(<ErrorBoundary scope="page"><Toggle /></ErrorBoundary>)
    explode = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('fine')).toBeTruthy()
  })

  it('tells people to reload when the app was updated under them', () => {
    function Stale(): never { throw new Error('Failed to fetch dynamically imported module: /assets/Notes-abc.js') }
    render(<ErrorBoundary scope="page"><Stale /></ErrorBoundary>)
    expect(screen.getByRole('alert').textContent).toMatch(/new version is available/)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(rpc).not.toHaveBeenCalled() // not a bug, so no report
  })
})
