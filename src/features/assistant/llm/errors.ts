/** Why a request to an AI provider failed, in terms the person can act on. */
export type FailureKind = 'auth' | 'rate' | 'quota' | 'bad_request' | 'network' | 'server' | 'unavailable' | 'session'

export class ProviderError extends Error {
  kind: FailureKind
  status: number
  constructor(kind: FailureKind, status: number, message: string) {
    super(message)
    this.kind = kind
    this.status = status
  }
}

/** Pulls the provider's own message out of an error body (OpenAI, Anthropic and Gemini all nest it a little differently). */
export function messageFromBody(body: unknown): string {
  // Gemini wraps its error in a one-item array.
  const b = (Array.isArray(body) ? body[0] : body) as { error?: { message?: unknown } | string; message?: unknown } | undefined | null
  const m = typeof b?.error === 'string' ? b.error : b?.error?.message ?? b?.message
  return typeof m === 'string' ? m.slice(0, 300) : ''
}

export function failureFromStatus(status: number, detail: string): ProviderError {
  const tail = detail ? ` (${detail})` : ''
  // Gemini reports a bad key as a 400, not a 401.
  const keyProblem = /api[ _-]?key|authentication|unauthorized/i.test(detail)
  if (status === 401 || status === 403 || (status === 400 && keyProblem)) return new ProviderError('auth', status, 'The provider rejected your API key. Check that you pasted the whole key and that it is for the provider you picked.')
  if (status === 402) return new ProviderError('quota', status, `Your provider account is out of credit${tail}.`)
  if (status === 429) {
    const quota = /quota|credit|billing|exceeded your current/i.test(detail)
    return quota
      ? new ProviderError('quota', status, `You have used up this key's quota for now${tail}. Wait a while, or use a different key.`)
      : new ProviderError('rate', status, 'The provider is asking you to slow down. Try again in a moment.')
  }
  if (status === 400 || status === 404 || status === 422) return new ProviderError('bad_request', status, `The provider did not accept the request${tail}. Check the model name in the assistant settings.`)
  if (status === 529 || status >= 500) return new ProviderError('server', status, 'The provider is busy or having problems. Try again in a moment.')
  return new ProviderError('server', status, `The provider returned an error${tail}.`)
}

/** Replies from our own free-assistant function carry a `code` and a message that is already safe to show. */
const OWN_CODES: Record<string, FailureKind> = { daily_limit: 'quota', busy: 'rate', free_unavailable: 'unavailable', unauthorized: 'session', bad_request: 'bad_request', server: 'server' }

export async function failureFromResponse(res: Response): Promise<ProviderError> {
  let body: unknown
  try { body = await res.json() } catch { /* body was not JSON */ }
  const code = (body as { code?: unknown } | null | undefined)?.code
  const detail = messageFromBody(body)
  if (typeof code === 'string' && code in OWN_CODES && detail) return new ProviderError(OWN_CODES[code], res.status, detail)
  return failureFromStatus(res.status, detail)
}

export const networkFailure = () => new ProviderError('network', 0, 'Could not reach the AI provider. Check your connection and try again.')
