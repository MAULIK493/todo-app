// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { readAutoLock, shouldLock, writeAutoLock } from './autoLock'

const MIN = 60_000

describe('shouldLock', () => {
  it('locks after the idle limit and not before', () => {
    const s = { idleMinutes: 5, lockOnHide: false }
    expect(shouldLock(s, 5 * MIN - 1, null)).toBe(false)
    expect(shouldLock(s, 5 * MIN, null)).toBe(true)
  })
  it('never locks on idle when set to never', () => {
    expect(shouldLock({ idleMinutes: 0, lockOnHide: false }, 999 * MIN, null)).toBe(false)
  })
  it('locks once the tab has been hidden past the grace period', () => {
    const s = { idleMinutes: 0, lockOnHide: true }
    expect(shouldLock(s, 0, 14_000)).toBe(false)
    expect(shouldLock(s, 0, 15_000)).toBe(true)
    expect(shouldLock({ ...s, lockOnHide: false }, 0, 999_000)).toBe(false)
  })
})

describe('settings storage', () => {
  beforeEach(() => localStorage.clear())
  it('defaults, round-trips and ignores junk', () => {
    expect(readAutoLock()).toEqual({ idleMinutes: 5, lockOnHide: true })
    writeAutoLock({ idleMinutes: 15, lockOnHide: false })
    expect(readAutoLock()).toEqual({ idleMinutes: 15, lockOnHide: false })
    localStorage.setItem('auto-lock', JSON.stringify({ idleMinutes: 7, lockOnHide: 'yes' }))
    expect(readAutoLock()).toEqual({ idleMinutes: 5, lockOnHide: true })
  })
})
