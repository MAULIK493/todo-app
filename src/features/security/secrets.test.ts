// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearAttempts, encodePattern, formatWait, msRemaining, readAttempts, recordFailure, throttleDelayMs, validateSecret,
} from './secrets'

describe('validateSecret', () => {
  it('accepts reasonable codes', () => {
    expect(validateSecret('pin', '482915')).toBeNull()
    expect(validateSecret('pin', '908172635412')).toBeNull()
    expect(validateSecret('pattern', encodePattern([0, 3, 6, 7, 8, 5]))).toBeNull()
    expect(validateSecret('password', 'long enough')).toBeNull()
  })

  it('rejects weak or malformed PINs', () => {
    expect(validateSecret('pin', '12345')).toMatch(/at least 6/)
    expect(validateSecret('pin', '1234567890123')).toMatch(/at most 12/)
    expect(validateSecret('pin', '12a456')).toMatch(/only contain digits/)
    expect(validateSecret('pin', '111111')).toMatch(/too easy/)
    expect(validateSecret('pin', '123456')).toMatch(/too easy/)
    expect(validateSecret('pin', '987654')).toMatch(/too easy/)
  })

  it('rejects short or invalid patterns', () => {
    expect(validateSecret('pattern', encodePattern([0, 1, 2, 5]))).toMatch(/at least 6/)
    expect(validateSecret('pattern', '0-1-2-2-5-8')).toMatch(/only be used once/)
    expect(validateSecret('pattern', '0-1-2-9-5-8')).toMatch(/Invalid/)
  })

  it('rejects short passwords', () => {
    expect(validateSecret('password', 'short')).toMatch(/at least 8/)
    expect(validateSecret('password', '         ')).toMatch(/only spaces/)
  })
})

describe('throttling', () => {
  beforeEach(() => localStorage.clear())

  it('escalates the delay with consecutive failures', () => {
    expect([0, 1, 2].map(throttleDelayMs)).toEqual([0, 0, 0])
    expect(throttleDelayMs(3)).toBe(30_000)
    expect(throttleDelayMs(5)).toBe(120_000)
    expect(throttleDelayMs(7)).toBe(600_000)
    expect(throttleDelayMs(50)).toBe(3_600_000)
    for (let f = 1; f < 20; f++) expect(throttleDelayMs(f + 1)).toBeGreaterThanOrEqual(throttleDelayMs(f))
  })

  it('persists failures per workspace and clears on success', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 3; i++) recordFailure('a', t0)
    expect(readAttempts('a').failures).toBe(3)
    expect(msRemaining(readAttempts('a'), t0)).toBe(30_000)
    expect(msRemaining(readAttempts('a'), t0 + 40_000)).toBe(0)
    expect(readAttempts('b').failures).toBe(0)
    clearAttempts('a')
    expect(readAttempts('a')).toEqual({ failures: 0, blockedUntil: 0 })
  })

  it('survives corrupt storage', () => {
    localStorage.setItem('lock-attempts:a', '{not json')
    expect(readAttempts('a')).toEqual({ failures: 0, blockedUntil: 0 })
  })

  it('formats waits', () => {
    expect([formatWait(5_000), formatWait(90_000), formatWait(7_200_000)]).toEqual(['5s', '2 min', '2 h'])
  })
})
