import { describe, expect, it } from 'vitest'
import { matchesSearch } from './search'

describe('matchesSearch', () => {
  it('requires every word, in any order, case-insensitively', () => {
    expect(matchesSearch('buy MILK', 'Please buy some milk')).toBe(true)
    expect(matchesSearch('milk buy', 'Please buy some milk')).toBe(true)
    expect(matchesSearch('milk eggs', 'Please buy some milk')).toBe(false)
  })
  it('matches inside words and across fields; empty search matches all', () => {
    expect(matchesSearch('ilk', 'milk')).toBe(true)
    expect(matchesSearch('title body', 'title', 'the body')).toBe(true)
    expect(matchesSearch('  ', 'anything')).toBe(true)
  })
})
