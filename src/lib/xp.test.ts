import { describe, expect, it } from 'vitest'
import { levelForXp, xpForLevel } from './xp'

describe('level curve', () => {
  it('starts each level at 50*L*(L-1) XP', () => {
    expect([1, 2, 3, 4, 5, 10].map(xpForLevel)).toEqual([0, 100, 300, 600, 1000, 4500])
  })
  it('flips to the next level exactly at the threshold', () => {
    for (let level = 1; level <= 60; level++) {
      expect(levelForXp(xpForLevel(level))).toBe(level)
      if (level > 1) expect(levelForXp(xpForLevel(level) - 1)).toBe(level - 1)
    }
  })
  it('never goes below level 1', () => {
    expect(levelForXp(0)).toBe(1)
    expect(levelForXp(99)).toBe(1)
  })
})
