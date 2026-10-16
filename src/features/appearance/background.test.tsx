// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BackgroundLayer } from './BackgroundLayer'
import { useAppearance } from './store'

afterEach(cleanup)

describe('background', () => {
  it('is always the starfield: one canvas behind the app, hidden from screen readers', () => {
    render(<BackgroundLayer />)
    const layer = screen.getByTestId('background')
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    expect(layer.querySelectorAll('canvas')).toHaveLength(1)
  })

  it('can only be reduced by the device, never switched off by a setting', () => {
    expect(Object.keys(useAppearance.getState()).sort()).toEqual(['effects', 'env', 'setEffects', 'setEnv'])
  })
})
