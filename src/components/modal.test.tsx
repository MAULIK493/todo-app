// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

afterEach(cleanup)

describe('Modal focus handling', () => {
  const open = (onClose = vi.fn()) => render(<Modal title="Hi" onClose={onClose}><input aria-label="one" /><button>two</button></Modal>)

  it('wraps Tab from the last control to the first, and Shift+Tab back', () => {
    open()
    const close = screen.getByRole('button', { name: 'Close' }), last = screen.getByRole('button', { name: 'two' })
    last.focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })

  it('closes on Escape, and restores focus to what opened it', () => {
    const onClose = vi.fn()
    const opener = document.createElement('button'); document.body.append(opener); opener.focus()
    const { unmount } = open(onClose)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('still traps focus when it cannot be dismissed', () => {
    const onClose = vi.fn()
    render(<Modal title="Locked" onClose={onClose} dismissible={false}><button>only</button></Modal>)
    screen.getByRole('button', { name: 'only' }).focus()
    fireEvent.keyDown(window, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'only' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
