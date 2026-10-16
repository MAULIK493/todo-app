// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '@/features/workspaces/types'
import { CreateCode } from './CreateCode'
import { createWorkspaceLock } from './crypto'
import { UnlockForm } from './UnlockForm'
import { useVault } from './vault'

// jsdom ships getRandomValues but not crypto.subtle; use Node's WebCrypto, the same API browsers expose.
beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true }) })
beforeEach(() => { localStorage.clear(); useVault.setState({ keys: {}, states: {} }) })
afterEach(cleanup)

async function privateWorkspace(id: string, secret: string, withRecovery = false) {
  const { params, recoveryKey } = await createWorkspaceLock({ type: 'pin', secret, withRecovery, iterations: 1000 })
  const workspace: Workspace = {
    id, name: 'Diary', color: '#7c5cff', icon: 'folder', position: 0, background: null, lock_state: 'locked',
    lock_type: params.lock_type, lock_salt: params.lock_salt, lock_iterations: params.lock_iterations, wrapped_key: params.wrapped_key,
    recovery_salt: params.recovery_salt, recovery_wrapped_key: params.recovery_wrapped_key,
  }
  return { workspace, recoveryKey }
}

const enterPin = (pin: string) => {
  for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d }))
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
}

describe('UnlockForm', () => {
  it('unlocks with the right PIN and puts the key in memory only', async () => {
    const { workspace } = await privateWorkspace('ws-ok', '482915')
    render(<UnlockForm workspace={workspace} />)
    enterPin('482915')
    await waitFor(() => expect(useVault.getState().keys['ws-ok']).toBeDefined())
    expect(JSON.stringify(Object.keys(localStorage))).not.toContain('482915')
  })

  it('rejects a wrong PIN, counts the failure, and stays locked', async () => {
    const { workspace } = await privateWorkspace('ws-bad', '482915')
    render(<UnlockForm workspace={workspace} />)
    enterPin('111222')
    expect((await screen.findByRole('alert')).textContent).toMatch(/Incorrect PIN/)
    expect(useVault.getState().keys['ws-bad']).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('lock-attempts:ws-bad')!).failures).toBe(1)
  })

  it('blocks input after repeated failures, even for the correct PIN', async () => {
    const { workspace } = await privateWorkspace('ws-block', '482915')
    render(<UnlockForm workspace={workspace} />)
    for (let i = 0; i < 3; i++) {
      enterPin('111222')
      await waitFor(() => expect(JSON.parse(localStorage.getItem('lock-attempts:ws-block')!).failures).toBe(i + 1))
    }
    expect((await screen.findByRole('status')).textContent).toMatch(/Locked for/)
    expect((screen.getByRole('button', { name: '4' }) as HTMLButtonElement).disabled).toBe(true)
    expect(useVault.getState().keys['ws-block']).toBeUndefined()
  })

  it('a successful unlock clears earlier failures', async () => {
    const { workspace } = await privateWorkspace('ws-clear', '482915')
    render(<UnlockForm workspace={workspace} />)
    enterPin('111222')
    await waitFor(() => expect(localStorage.getItem('lock-attempts:ws-clear')).not.toBeNull())
    enterPin('482915')
    await waitFor(() => expect(useVault.getState().keys['ws-clear']).toBeDefined())
    expect(localStorage.getItem('lock-attempts:ws-clear')).toBeNull()
  })

  it('only offers recovery when a recovery key exists, and it opens the workspace', async () => {
    const without = await privateWorkspace('ws-norec', '482915')
    const { unmount } = render(<UnlockForm workspace={without.workspace} />)
    expect(screen.queryByText('Forgot your code?')).toBeNull()
    unmount()

    const { workspace, recoveryKey } = await privateWorkspace('ws-rec', '482915', true)
    render(<UnlockForm workspace={workspace} />)
    fireEvent.click(screen.getByText('Forgot your code?'))
    fireEvent.change(screen.getByPlaceholderText(/XXXX/), { target: { value: recoveryKey!.toLowerCase() } })
    fireEvent.click(screen.getByRole('button', { name: /Unlock with recovery key/ }))
    await waitFor(() => expect(useVault.getState().keys['ws-rec']).toBeDefined())
  })

  it('rejects a wrong recovery key', async () => {
    const { workspace } = await privateWorkspace('ws-rec2', '482915', true)
    render(<UnlockForm workspace={workspace} />)
    fireEvent.click(screen.getByText('Forgot your code?'))
    fireEvent.change(screen.getByPlaceholderText(/XXXX/), { target: { value: 'AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA' } })
    fireEvent.click(screen.getByRole('button', { name: /Unlock with recovery key/ }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/does not match/)
    expect(useVault.getState().keys['ws-rec2']).toBeUndefined()
  })
})

describe('CreateCode', () => {
  const pin = (p: string, button: string) => {
    for (const d of p) fireEvent.click(screen.getByRole('button', { name: d }))
    fireEvent.click(screen.getByRole('button', { name: button }))
  }

  it('refuses a weak PIN with the reason', () => {
    const onChosen = vi.fn()
    render(<CreateCode type="pin" onChosen={onChosen} />)
    pin('111111', 'Continue')
    expect((screen.getByRole('alert')).textContent).toMatch(/too easy/)
    expect(onChosen).not.toHaveBeenCalled()
  })

  it('requires the confirmation to match', () => {
    const onChosen = vi.fn()
    render(<CreateCode type="pin" onChosen={onChosen} />)
    pin('482915', 'Continue')
    pin('482916', 'Confirm')
    expect((screen.getByRole('alert')).textContent).toMatch(/did not match/)
    expect(onChosen).not.toHaveBeenCalled()
    // and it starts over
    expect(document.body.textContent).toMatch(/Choose a PIN/)
  })

  it('accepts a matching code', () => {
    const onChosen = vi.fn()
    render(<CreateCode type="pin" onChosen={onChosen} />)
    pin('482915', 'Continue')
    pin('482915', 'Confirm')
    expect(onChosen).toHaveBeenCalledWith('482915')
  })
})
