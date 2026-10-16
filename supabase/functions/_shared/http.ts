import type { ServerEvent } from './types.ts'

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })

export const sseEncode = (e: ServerEvent) => `data: ${JSON.stringify(e)}\n\n`

/** Streams server-sent events. `run` receives a send() and may throw; the stream always ends cleanly. */
export function sseResponse(run: (send: (e: ServerEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (e: ServerEvent) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(sseEncode(e)))
        } catch {
          closed = true // the client went away
        }
      }
      try {
        await run(send)
      } finally {
        closed = true
        try { controller.close() } catch { /* already closed */ }
      }
    },
  })
  return new Response(body, {
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}

export type ChatBody = { message: string; conversationId: string | null; privateContext: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_MESSAGE = 4000
export const MAX_PRIVATE_BODY = 20_000

export function parseChatBody(raw: unknown): { ok: true; value: ChatBody } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Send a JSON object.' }
  const b = raw as Record<string, unknown>
  if (typeof b.message !== 'string' || b.message.trim() === '') return { ok: false, error: 'Type a message first.' }
  if (b.message.length > MAX_MESSAGE) return { ok: false, error: `Messages can be up to ${MAX_MESSAGE} characters.` }
  if (b.conversationId != null && (typeof b.conversationId !== 'string' || !UUID.test(b.conversationId))) return { ok: false, error: 'Invalid conversation.' }
  if (b.privateContext != null && (typeof b.privateContext !== 'string' || b.privateContext.length > MAX_PRIVATE_BODY)) return { ok: false, error: 'Shared private content is too large.' }
  return {
    ok: true,
    value: { message: b.message.trim(), conversationId: (b.conversationId as string | null | undefined) ?? null, privateContext: (b.privateContext as string | null | undefined) ?? null },
  }
}

/** Keeps the newest messages that fit in a character budget, so a long chat can't blow up the prompt. */
export function trimHistory<T extends { content: string }>(messages: T[], maxChars: number): T[] {
  const kept: T[] = []
  let total = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    total += messages[i].content.length
    if (total > maxChars && kept.length > 0) break
    kept.unshift(messages[i])
  }
  // The conversation sent to the model must start with a user turn.
  while (kept.length > 0 && (kept[0] as unknown as { role?: string }).role === 'assistant') kept.shift()
  return kept
}
