import { describe, expect, it } from 'vitest'
import { checkUsage, readLimits } from './limits.ts'

const none = { requests_today: 0, tokens_today: 0, tokens_month: 0 }

describe('limits', () => {
  it('uses sensible defaults, and ignores junk settings', () => {
    expect(readLimits(() => undefined)).toEqual({ dailyRequests: 200, dailyTokens: 600_000, monthlyTokens: 4_000_000 })
    expect(readLimits((k) => (k === 'AI_DAILY_REQUEST_LIMIT' ? 'lots' : k === 'AI_DAILY_TOKEN_LIMIT' ? '-5' : '12.9'))).toEqual({ dailyRequests: 200, dailyTokens: 600_000, monthlyTokens: 12 })
  })

  it('lets people through until a limit is reached', () => {
    const l = readLimits(() => undefined)
    expect(checkUsage(none, l)).toBeNull()
    expect(checkUsage({ ...none, requests_today: 199 }, l)).toBeNull()
    expect(checkUsage({ ...none, requests_today: 200 }, l)).toMatch(/today/)
    expect(checkUsage({ ...none, tokens_today: 600_000 }, l)).toMatch(/today/)
    expect(checkUsage({ ...none, tokens_month: 4_000_000 }, l)).toMatch(/month/)
  })
})
