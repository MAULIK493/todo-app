// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantOrb, orbState } from '@/features/assistant/AssistantOrb'
import { useVault } from '@/features/security/vault'
import { useAppearance } from '@/features/appearance/store'
import type { Workspace } from '@/features/workspaces/types'
import { EmptyState } from './EmptyState'
import { magnetOffset, routeKey, SWIPE_DISTANCE, SWIPE_VELOCITY, swipeIntent } from './logic'
import { PageTransition } from './PageTransition'
import { SwipeRow } from './SwipeRow'
import { useSpotlight } from './useSpotlight'
import { Check } from 'lucide-react'

const workspaces: Workspace[] = []
vi.mock('@/features/workspaces/api', () => ({ useWorkspaces: () => ({ data: workspaces, isLoading: false }) }))

beforeEach(() => {
  useAppearance.setState({ effects: 'full', env: { reducedMotion: false, lowEnd: false, saveData: false, lowBattery: false } })
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('hover'), addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); workspaces.length = 0 })

describe('gesture and motion decisions', () => {
  it('swipe: far enough, or a quick flick, in either direction', () => {
    expect(swipeIntent(SWIPE_DISTANCE, 0)).toBe('complete')
    expect(swipeIntent(-SWIPE_DISTANCE, 0)).toBe('delete')
    expect(swipeIntent(SWIPE_DISTANCE - 1, 0)).toBeNull()
    expect(swipeIntent(60, SWIPE_VELOCITY)).toBe('complete')
    expect(swipeIntent(-60, -SWIPE_VELOCITY)).toBe('delete')
    expect(swipeIntent(10, SWIPE_VELOCITY * 3)).toBeNull() // a flick that barely moved is not a swipe
    expect(swipeIntent(60, -SWIPE_VELOCITY)).toBeNull() // moving right but flicking back left: undecided
    expect(swipeIntent(0, 0)).toBeNull()
  })

  it('magnetic buttons lean only when the pointer is close', () => {
    expect(magnetOffset(0, 0)).toEqual({ x: 0, y: 0 })
    expect(magnetOffset(200, 0)).toEqual({ x: 0, y: 0 })
    expect(magnetOffset(60, -30, 90, 0.5)).toEqual({ x: 30, y: -15 })
  })

  it('page transitions only replay between screens, not between notes', () => {
    expect(routeKey('/w/abc')).toBe('/w/abc')
    expect(routeKey('/w/abc/notes')).toBe('/w/abc/notes')
    expect(routeKey('/w/abc/notes/note-1')).toBe('/w/abc/notes')
    expect(routeKey('/w/abc/notes/note-2')).toBe('/w/abc/notes')
    expect(routeKey('/rewards')).toBe('/rewards')
    expect(routeKey('/')).toBe('/')
  })

  it('the orb reflects the most specific thing happening', () => {
    expect(orbState({ busy: false, listening: false, speaking: false })).toBe('idle')
    expect(orbState({ busy: true, listening: false, speaking: false })).toBe('thinking')
    expect(orbState({ busy: true, listening: false, speaking: true })).toBe('speaking')
    expect(orbState({ busy: true, listening: true, speaking: true })).toBe('listening')
  })
})

describe('components', () => {
  it('SwipeRow is invisible when off, and adds the swipe layers when on', () => {
    const off = render(<SwipeRow enabled={false} onComplete={vi.fn()} onDelete={vi.fn()}><p>row</p></SwipeRow>)
    expect(off.container.textContent).toBe('row')
    expect(screen.queryByTestId('swipe-row')).toBeNull()
    off.unmount()
    render(<SwipeRow enabled onComplete={vi.fn()} onDelete={vi.fn()}><p>row</p></SwipeRow>)
    expect(screen.getByTestId('swipe-row').textContent).toContain('Done')
    expect(screen.getByTestId('swipe-row').textContent).toContain('Delete')
    expect(screen.getByText('row')).toBeTruthy()
  })

  it('PageTransition wraps pages normally and steps aside when animation is off', () => {
    const on = render(<PageTransition routeKey="/a"><p>page</p></PageTransition>)
    expect(on.container.firstElementChild?.className).toContain('h-full')
    on.unmount()
    act(() => useAppearance.getState().setEffects('off'))
    const off = render(<PageTransition routeKey="/a"><p>page</p></PageTransition>)
    expect(off.container.firstElementChild?.tagName).toBe('P')
  })

  it('EmptyState announces itself', () => {
    render(<EmptyState icon={Check} title="Nothing here yet" />)
    expect(screen.getByRole('status').textContent).toContain('Nothing here yet')
  })

  it('the orb is labelled for assistive technology', () => {
    render(<AssistantOrb state="thinking" />)
    expect(screen.getByRole('img', { name: 'Assistant is thinking' })).toBeTruthy()
    cleanup()
    render(<AssistantOrb state="listening" level={0.05} />)
    expect(screen.getByRole('img', { name: 'Assistant is listening' })).toBeTruthy()
  })

  it('the spotlight follows the cursor on marked panels only, and only at Full effects', async () => {
    function Page() {
      useSpotlight()
      return <div><div className="spotlight" data-testid="panel"><span data-testid="inner">x</span></div><div data-testid="plain" /></div>
    }
    render(<Page />)
    const panel = screen.getByTestId('panel')
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 300, height: 100 } as DOMRect)
    const move = async (target: Element) => {
      target.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 90, bubbles: true }))
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    }
    await move(screen.getByTestId('inner'))
    expect([panel.style.getPropertyValue('--mx'), panel.style.getPropertyValue('--my')]).toEqual(['60px', '40px'])
    await move(screen.getByTestId('plain'))
    expect(screen.getByTestId('plain').style.getPropertyValue('--mx')).toBe('')

    cleanup()
    act(() => useAppearance.getState().setEffects('balanced'))
    render(<Page />)
    const p2 = screen.getByTestId('panel')
    await move(p2)
    expect(p2.style.getPropertyValue('--mx')).toBe('')
  })
})

describe('unlock reveal', () => {
  const locked = (): Workspace => ({
    id: 'w1', name: 'Diary', color: '#7c5cff', icon: 'folder', position: 0, background: null, lock_state: 'locked', lock_type: 'pin',
    lock_salt: 's', lock_iterations: 600000, wrapped_key: 'k', recovery_salt: null, recovery_wrapped_key: null,
  })

  it('fades the opened workspace in once, without remounting its contents afterwards', async () => {
    vi.useFakeTimers()
    workspaces.push(locked())
    useVault.setState({ keys: {}, states: { w1: 'locked' } })
    const { WorkspacePage } = await import('@/routes/WorkspacePage')
    const qc = new QueryClient()
    const tree = (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/w/w1']}>
          <Routes><Route path="/w/:workspaceId" element={<WorkspacePage />}><Route index element={<input data-testid="draft" />} /></Route></Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
    render(tree)
    expect(screen.queryByTestId('workspace-content')).toBeNull() // lock screen is showing

    act(() => useVault.setState({ keys: { w1: {} as CryptoKey } }))
    const content = screen.getByTestId('workspace-content')
    expect(content.style.filter).toMatch(/blur/) // starts blurred and clears

    const input = screen.getByTestId('draft')
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(screen.getByTestId('workspace-content')).toBe(content) // same element: nothing was torn down
    expect(screen.getByTestId('draft')).toBe(input)
    vi.useRealTimers()
  })
})
