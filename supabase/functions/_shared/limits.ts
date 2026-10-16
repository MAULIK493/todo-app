// Per-person usage caps for the server-side functions that still cost the host money (speech-to-text).
// The assistant itself runs on each person's own AI key and is not limited here.

export type Usage = { requests_today: number; tokens_today: number; tokens_month: number }
export type Limits = { dailyRequests: number; dailyTokens: number; monthlyTokens: number }

const DEFAULTS: Limits = { dailyRequests: 200, dailyTokens: 600_000, monthlyTokens: 4_000_000 }

const positive = (raw: string | null | undefined, fallback: number) => {
  const n = Number(raw)
  return raw != null && raw !== '' && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/** Limits from the function's environment (AI_DAILY_REQUEST_LIMIT, AI_DAILY_TOKEN_LIMIT, AI_MONTHLY_TOKEN_LIMIT), with defaults. */
export function readLimits(get: (key: string) => string | null | undefined): Limits {
  return {
    dailyRequests: positive(get('AI_DAILY_REQUEST_LIMIT'), DEFAULTS.dailyRequests),
    dailyTokens: positive(get('AI_DAILY_TOKEN_LIMIT'), DEFAULTS.dailyTokens),
    monthlyTokens: positive(get('AI_MONTHLY_TOKEN_LIMIT'), DEFAULTS.monthlyTokens),
  }
}

/** A message to show the person if they are over a limit, or null if they may go ahead. */
export function checkUsage(u: Usage, l: Limits): string | null {
  if (u.requests_today >= l.dailyRequests) return 'You have reached today’s limit. It resets tomorrow.'
  if (u.tokens_today >= l.dailyTokens) return 'You have reached today’s limit. It resets tomorrow.'
  if (u.tokens_month >= l.monthlyTokens) return 'You have reached this month’s limit. It resets next month.'
  return null
}
