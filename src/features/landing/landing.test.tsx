// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

// jsdom has no IntersectionObserver, which the scroll-in animations use.
vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return [] } })
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithPassword: vi.fn(), signUp: vi.fn() } }, isSupabaseConfigured: true }))
const { default: LandingPage } = await import('./LandingPage')
const { LoginPage } = await import('@/features/auth/LoginPage')

afterEach(cleanup)
const app = (at: string) => render(
  <MemoryRouter initialEntries={[at]}>
    <Routes><Route path="/" element={<LandingPage />} /><Route path="/login" element={<LoginPage />} /></Routes>
  </MemoryRouter>,
)

describe('landing page', () => {
  it('has one main heading and calls to action that lead to sign-up and sign-in', () => {
    app('/')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getAllByRole('link', { name: /get started/i }).every((l) => l.getAttribute('href') === '/login?mode=signup' || l.getAttribute('href') === '#features' || l.getAttribute('href') === '#start')).toBe(true)
    expect(screen.getAllByRole('link', { name: 'Sign in' })[0].getAttribute('href')).toBe('/login')
  })

  it('switches feature tabs and shows the matching panel', async () => {
    app('/')
    const tabs = screen.getByRole('tablist', { name: 'Features' })
    expect(within(tabs).getByRole('tab', { name: 'Todos' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Private' }))
    expect(within(tabs).getByRole('tab', { name: 'Private' }).getAttribute('aria-selected')).toBe('true')
    await vi.waitFor(() => expect(screen.getByRole('tabpanel').textContent).toMatch(/Private really means private/))
  })

  it('does not claim anything the app cannot do', () => {
    app('/')
    expect(document.body.textContent).not.toMatch(/\b(100,000|million|unlimited)\b/i)
  })
})

describe('login page entry', () => {
  it('opens on sign-up when coming from "Get started", and on sign-in otherwise', () => {
    app('/login?mode=signup')
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeTruthy()
    cleanup()
    app('/login')
    expect(screen.getByRole('heading', { name: 'Sign in to Todo App' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /back/i }).getAttribute('href')).toBe('/')
  })
})
