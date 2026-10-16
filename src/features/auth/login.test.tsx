// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const signIn = vi.fn(), signUp = vi.fn()
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithPassword: (a: unknown) => signIn(a), signUp: (a: unknown) => signUp(a) } }, isSupabaseConfigured: true }))
const { LoginPage } = await import('./LoginPage')

beforeEach(() => { signIn.mockReset().mockResolvedValue({ error: null, data: { session: {} } }); signUp.mockReset().mockResolvedValue({ error: null, data: { session: null } }) })
afterEach(cleanup)
const open = (at = '/login') => render(<MemoryRouter initialEntries={[at]}><LoginPage /></MemoryRouter>)
const type = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

describe('login', () => {
  it('asks for the email first, then the password, then signs in', async () => {
    open()
    expect(screen.queryByLabelText('Password')).toBeNull()
    type('Email', 'me@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Email' }))
    expect(screen.getByText('me@example.com')).toBeTruthy()
    type('Password', 'correct horse')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(signIn).toHaveBeenCalledWith({ email: 'me@example.com', password: 'correct horse' }))
  })

  it('lets you go back and fix the email', () => {
    open()
    type('Email', 'typo@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Email' }))
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('typo@example.com')
  })

  it('shows the server error, and keeps the password step open', async () => {
    signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' }, data: { session: null } })
    open()
    type('Email', 'me@example.com'); fireEvent.click(screen.getByRole('button', { name: 'Continue with Email' }))
    type('Password', 'wrong-password'); fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/Invalid login credentials/)
    expect(screen.getByLabelText('Password')).toBeTruthy()
  })

  it('creates an account and tells the person to check their email', async () => {
    open('/login?mode=signup')
    type('Email', 'new@example.com'); fireEvent.click(screen.getByRole('button', { name: 'Continue with Email' }))
    type('Password', 'long-enough-1'); fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(signUp).toHaveBeenCalledWith({ email: 'new@example.com', password: 'long-enough-1' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/Check your email/)
  })

  it('switches between sign-in and sign-up, and offers no sign-in method that is not set up', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))
    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('heading', { name: 'Sign in to Todo App' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull()
  })
})
